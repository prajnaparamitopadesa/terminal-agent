import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createSession, connectSSH, sendInput, resizeTerminal, getScreenContent, removeSession, getSession } from "./terminal";
import { getServers, getServerById, addServer, deleteServer, getAutoApprovals, addAutoApproval, updateAutoApproval, deleteAutoApproval } from "./db";
import { createAgentTools, getPendingApprovals, resolveApproval } from "./agent";

const dashscope = createOpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || "",
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

// Map of sessionId -> set of WebSocket connections for terminal
const terminalWsMap = new Map<string, Set<any>>();
// Map of sessionId -> set of WebSocket connections for agent approvals
const agentWsMap = new Map<string, Set<any>>();

const app = new Elysia()
  .use(cors())
  
  // Server CRUD
  .get("/api/servers", () => getServers())
  .get("/api/servers/:id", ({ params }) => getServerById(Number(params.id)))
  .post("/api/servers", ({ body }) => addServer(body as any), {
    body: t.Object({
      name: t.Optional(t.String()),
      username: t.String(),
      host: t.String(),
      port: t.Optional(t.Number()),
      terminal_type: t.Optional(t.String()),
    })
  })
  .delete("/api/servers/:id", ({ params }) => {
    deleteServer(Number(params.id));
    return { success: true };
  })
  
  // Auto-approval CRUD
  .get("/api/auto-approvals", () => getAutoApprovals())
  .post("/api/auto-approvals", ({ body }) => addAutoApproval(body as any), {
    body: t.Object({
      pattern: t.String(),
      is_regex: t.Optional(t.Boolean()),
      description: t.Optional(t.String()),
      scope: t.Optional(t.String()),
      server_id: t.Optional(t.Number()),
    })
  })
  .put("/api/auto-approvals/:id", ({ params, body }) => {
    updateAutoApproval(Number(params.id), body as any);
    return { success: true };
  }, {
    body: t.Object({
      pattern: t.Optional(t.String()),
      is_regex: t.Optional(t.Boolean()),
      description: t.Optional(t.String()),
      scope: t.Optional(t.String()),
    })
  })
  .delete("/api/auto-approvals/:id", ({ params }) => {
    deleteAutoApproval(Number(params.id));
    return { success: true };
  })
  
  // Approval management
  .get("/api/approvals", () => getPendingApprovals())
  .post("/api/approvals/:id/resolve", ({ params, body }) => {
    resolveApproval(params.id, (body as any).approved);
    return { success: true };
  }, {
    body: t.Object({ approved: t.Boolean() })
  })
  
  // Convert to regex using AI
  .post("/api/convert-to-regex", async ({ body }) => {
    const { command, requirement } = body as { command: string; requirement: string };
    const result = await streamText({
      model: dashscope(process.env.DASHSCOPE_LITE_MODEL || "qwen-turbo"), // lite model for lightweight regex conversion task
      prompt: `Convert this shell command to a regex pattern based on the requirement.
Command: ${command}
Requirement: ${requirement}
Return only the regex pattern, no explanation.`,
      maxTokens: 200,
    });
    let text = "";
    for await (const chunk of result.textStream) {
      text += chunk;
    }
    return { regex: text.trim() };
  })
  
  // Terminal WebSocket
  .ws("/ws/terminal/:sessionId", {
    open(ws) {
      const { sessionId } = ws.data.params;
      if (!terminalWsMap.has(sessionId)) {
        terminalWsMap.set(sessionId, new Set());
      }
      terminalWsMap.get(sessionId)!.add(ws);
    },
    message(ws, message: any) {
      const { sessionId } = ws.data.params;
      if (message.type === "connect") {
        const { host, port, username, password, serverId } = message;
        createSession(sessionId, serverId || 0);
        connectSSH(
          sessionId,
          { host, port: port || 22, username, password },
          (data) => {
            const connections = terminalWsMap.get(sessionId);
            if (connections) {
              for (const conn of connections) {
                try { conn.send({ type: "data", data }); } catch (e) { console.error("WS send error:", e); }
              }
            }
          },
          () => {
            const connections = terminalWsMap.get(sessionId);
            if (connections) {
              for (const conn of connections) {
                try { conn.send({ type: "close" }); } catch (e) { console.error("WS send error:", e); }
              }
            }
          }
        ).catch((err) => {
          ws.send({ type: "error", error: err.message });
        });
      } else if (message.type === "input") {
        sendInput(sessionId, message.data);
      } else if (message.type === "resize") {
        resizeTerminal(sessionId, message.cols, message.rows);
      }
    },
    close(ws) {
      const { sessionId } = ws.data.params;
      const connections = terminalWsMap.get(sessionId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          terminalWsMap.delete(sessionId);
          removeSession(sessionId);
        }
      }
    }
  })
  
  // Agent chat endpoint
  .post("/api/agent/:sessionId/chat", async ({ params, body, set }) => {
    const { sessionId } = params;
    const { messages, serverId, sessionApprovals, sudoPassword } = body as { 
      messages: any[]; 
      serverId?: number;
      sessionApprovals?: string[];
      sudoPassword?: string;
    };
    
    const tools = createAgentTools(
      sessionId,
      serverId || 0,
      (approval) => {
        const connections = agentWsMap.get(sessionId);
        if (connections) {
          for (const conn of connections) {
            try { conn.send({ type: "approval_needed", ...approval }); } catch (e) { console.error("WS send error:", e); }
          }
        }
      }
    );
    
    const result = streamText({
      model: dashscope(process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus"),
      system: `You are a server diagnostic agent. You help users diagnose and fix server issues through terminal commands.
You have access to tools to run commands, send input, and view the terminal screen.
When running sudo commands, use run_command first, then use send_input to provide the password when prompted.${sudoPassword ? `\nThe sudo/su password for this server is: ${sudoPassword}` : ""}
For MySQL REPL, run the mysql command, then use send_input for subsequent SQL commands.
Always explain what you're doing before running commands.
You must always request approval before running commands - this is handled automatically by the tools.`,
      messages,
      tools,
      maxSteps: 20,
    });
    
    set.headers["Content-Type"] = "text/event-stream";
    set.headers["Cache-Control"] = "no-cache";
    set.headers["Connection"] = "keep-alive";
    
    return result.toDataStreamResponse();
  }, {
    body: t.Object({
      messages: t.Array(t.Any()),
      serverId: t.Optional(t.Number()),
      sessionApprovals: t.Optional(t.Array(t.String())),
      sudoPassword: t.Optional(t.String()),
    })
  })
  
  // Agent WebSocket for real-time approval notifications
  .ws("/ws/agent/:sessionId", {
    open(ws) {
      const { sessionId } = ws.data.params;
      if (!agentWsMap.has(sessionId)) {
        agentWsMap.set(sessionId, new Set());
      }
      agentWsMap.get(sessionId)!.add(ws);
    },
    message(ws, message: any) {
      // Handle approval responses
      if (message.type === "approve") {
        resolveApproval(message.id, true);
      } else if (message.type === "reject") {
        resolveApproval(message.id, false);
      }
    },
    close(ws) {
      const { sessionId } = ws.data.params;
      const connections = agentWsMap.get(sessionId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          agentWsMap.delete(sessionId);
        }
      }
    }
  })
  
  .listen(3001);

console.log("Backend running on http://localhost:3001");

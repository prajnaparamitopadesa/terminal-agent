import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { generateText, createAgentUIStreamResponse, createIdGenerator } from "ai";
import { createSession, connectSSH, sendInput, resizeTerminal, removeSession } from "./terminal";
import { getServers, getServerById, addServer, deleteServer, getAutoApprovals, addAutoApproval, updateAutoApproval, deleteAutoApproval, getServerPassword, updateServerPassword, getConversations, getConversation, createConversation, updateConversation, deleteConversation, getRecentPrompts } from "./db";
import { createTerminalAgent, getPendingUserInputs, resolveUserInput } from "./agent";
import dashscope from "./dashscope-model";

// Map of sessionId -> set of WebSocket connections for terminal
const terminalWsMap = new Map<string, Set<any>>();
// Map of sessionId -> set of WebSocket connections for agent events (user input requests)
const agentWsMap = new Map<string, Set<any>>();

const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });

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
  .put("/api/servers/:id/password", ({ params, body }) => {
    const { password } = body as { password: string | null };
    updateServerPassword(Number(params.id), password);
    return { success: true };
  }, {
    body: t.Object({
      password: t.Union([t.String(), t.Null()]),
    })
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
  
  // Conversation history
  .get("/api/conversations", ({ query }) => {
    return getConversations({
      search: query.search as string | undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
      server_id: query.server_id ? Number(query.server_id) : undefined,
    });
  })
  .get("/api/conversations/:id", ({ params }) => {
    const conv = getConversation(Number(params.id));
    if (!conv) return new Response("Not found", { status: 404 });
    return conv;
  })
  .post("/api/conversations", ({ body }) => {
    const { server_id, title, messages } = body as { server_id?: number; title: string; messages: string };
    return createConversation({ server_id, title, messages });
  }, {
    body: t.Object({
      server_id: t.Optional(t.Number()),
      title: t.String(),
      messages: t.String(),
    })
  })
  .put("/api/conversations/:id", ({ params, body }) => {
    const { title, messages } = body as { title?: string; messages?: string };
    updateConversation(Number(params.id), { title, messages });
    return { success: true };
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      messages: t.Optional(t.String()),
    })
  })
  .delete("/api/conversations/:id", ({ params }) => {
    deleteConversation(Number(params.id));
    return { success: true };
  })
  .get("/api/prompts/recent", ({ query }) => {
    return getRecentPrompts({
      server_id: query.server_id ? Number(query.server_id) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  })
  
  // User input management (for request-user-input tool)
  .get("/api/user-inputs", () => getPendingUserInputs())
  .post("/api/user-inputs/:id/resolve", ({ params, body }) => {
    resolveUserInput(params.id, (body as any).input);
    return { success: true };
  }, {
    body: t.Object({ input: t.String() })
  })
  
  // Convert to regex using AI
  .post("/api/convert-to-regex", async ({ body }) => {
    const { command, requirement } = body as { command: string; requirement?: string };
    const requirementClause = requirement?.trim()
      ? ` based on the requirement: ${requirement.trim()}`
      : "";
    const result = await generateText({
      model: dashscope(process.env.DASHSCOPE_LITE_MODEL || "qwen-turbo"),
      prompt: `Convert this shell command to a regex pattern${requirementClause}.
Command: ${command}
Return only the regex pattern, no explanation.`,
      maxOutputTokens: 200,
    });
    return { regex: result.text.trim() };
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
        // Use provided password or fall back to saved password
        const effectivePassword = password || (serverId ? getServerPassword(serverId) : null);
        createSession(sessionId, serverId || 0);
        connectSSH(
          sessionId,
          { host, port: port || 22, username, password: effectivePassword || undefined },
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
  .post("/api/agent/:sessionId/chat", async ({ params, body }) => {
    const { sessionId } = params;
    const { messages, serverId } = body as {
      messages: any[];
      serverId?: number;
    };

    const model = dashscope(process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus");
    const agent = createTerminalAgent(model, {
      sessionId,
      serverId: serverId || 0,
    });

    return createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      generateMessageId,
    });
  }, {
    body: t.Object({
      messages: t.Array(t.Any()),
      serverId: t.Optional(t.Number()),
    })
  })
  
  // Agent WebSocket for real-time user input notifications
  .ws("/ws/agent/:sessionId", {
    open(ws) {
      const { sessionId } = ws.data.params;
      if (!agentWsMap.has(sessionId)) {
        agentWsMap.set(sessionId, new Set());
      }
      agentWsMap.get(sessionId)!.add(ws);
    },
    message(ws, message: any) {
      // Handle user input responses
      if (message.type === "user-input") {
        resolveUserInput(message.id, message.input);
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
  
  .listen(3101);

console.log("Backend running on http://localhost:3101");

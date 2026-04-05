import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { existsSync, readFileSync } from "fs";
import pathModule from "path";
import { fileURLToPath } from "url";
import { generateText, createAgentUIStreamResponse, createIdGenerator } from "ai";
import { createSession, connectSSH, sendInput, resizeTerminal, removeSession } from "./terminal";
import { getServers, getServerById, addServer, deleteServer, getAutoApprovals, addAutoApproval, updateAutoApproval, deleteAutoApproval, getServerPassword, updateServerPassword, getConversations, getConversation, createConversation, updateConversation, deleteConversation, clearConversations, getRecentPrompts, getAiModels, getAiModelById, createAiModel, updateAiModel, deleteAiModel, seedModelsFromJson, getProviders, getProviderByName, createProvider, updateProvider, deleteProvider, seedProvidersFromJson } from "./db";
import { createTerminalAgent, getPendingUserInputs, resolveUserInput } from "./agent";
import dashscope, { createModelClient } from "./dashscope-model";
import { frontendAssets } from "./frontend-assets";
// Inline example data — bundled by bun so it is always available in the compiled exe
import exampleProviderData from "../model-provider.example.json";
import exampleModelData from "../models.example.json";

// ── Startup initialization ──────────────────────────────────────────────────
function getBackendDir(): string {
  try {
    return pathModule.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

const backendDir = getBackendDir();
// In dev mode import.meta.url points to src/index.ts, so backendRoot is backend/.
// In exe mode import.meta.url points to the exe itself, so backendDir IS the app dir.
const isExeMode = frontendAssets !== null;
const backendRoot = isExeMode ? backendDir : pathModule.join(backendDir, '..');

// Migrate model-provider.json to DB if it exists next to the entry-point
const modelProviderPath = pathModule.join(backendRoot, 'model-provider.json');
if (existsSync(modelProviderPath)) {
  try {
    seedProvidersFromJson(readFileSync(modelProviderPath, 'utf-8'));
  } catch (e) {
    console.warn('Failed to migrate model-provider.json to DB:', e);
  }
}

// Seed providers and models from built-in example data if both tables are empty.
// Using inline imports ensures the data is available in the compiled exe without
// needing any external files on the user's machine.
{
  const providerCount = getProviders().length;
  const modelCount = getAiModels().length;
  if (providerCount === 0 && modelCount === 0) {
    try {
      seedProvidersFromJson(exampleProviderData);
    } catch (e) {
      console.warn('Failed to seed providers from example:', e);
    }
    try {
      seedModelsFromJson(exampleModelData);
    } catch (e) {
      console.warn('Failed to seed models from example:', e);
    }
  }
}

// ── Static frontend serving (production / exe mode) ─────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};

function getMimeType(filePath: string): string {
  const ext = pathModule.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// Look for frontend dist folder relative to backend dir (dev & production layout)
function findFrontendDistDir(): string | null {
  const candidates = [
    pathModule.join(backendRoot, '..', 'frontend', 'dist'),
    pathModule.join(backendRoot, 'public'),
    pathModule.join(process.cwd(), 'public'),
  ];
  for (const c of candidates) {
    if (existsSync(pathModule.join(c, 'index.html'))) return c;
  }
  return null;
}

const embeddedAssets = frontendAssets;
const frontendDistDir = embeddedAssets ? null : findFrontendDistDir();

// Map of sessionId -> set of WebSocket connections for terminal
const terminalWsMap = new Map<string, Set<any>>();
// Map of sessionId -> set of WebSocket connections for agent events (user input requests)
const agentWsMap = new Map<string, Set<any>>();

const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });

const app = new Elysia()
  .use(cors())
  
  // ── Provider management (database) ──────────────────────────────────────────
  .get("/api/providers", () => getProviders())
  .post("/api/providers", ({ body }) => {
    const b = body as { name: string; label?: string; base_url: string; api_key: string };
    if (getProviderByName(b.name)) {
      return new Response(JSON.stringify({ error: 'Provider name already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    return createProvider(b);
  }, {
    body: t.Object({
      name: t.String(),
      label: t.Optional(t.String()),
      base_url: t.String(),
      api_key: t.String(),
    })
  })
  .put("/api/providers/:name", ({ params, body }) => {
    const b = body as { name?: string; label?: string; base_url?: string; api_key?: string };
    if (!getProviderByName(params.name)) return new Response('Not found', { status: 404 });
    updateProvider(params.name, b);
    return getProviderByName(b.name ?? params.name);
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      label: t.Optional(t.String()),
      base_url: t.Optional(t.String()),
      api_key: t.Optional(t.String()),
    })
  })
  .delete("/api/providers/:name", ({ params }) => {
    deleteProvider(params.name);
    return { success: true };
  })

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
  .delete("/api/conversations", ({ query }) => {
    const server_id = query.server_id ? Number(query.server_id) : undefined;
    clearConversations(server_id);
    return { success: true };
  })
  .get("/api/prompts/recent", ({ query }) => {
    return getRecentPrompts({
      server_id: query.server_id ? Number(query.server_id) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  })
  
  // AI Models CRUD
  .get("/api/ai-models", ({ query }) => {
    const enabledOnly = query.enabled === 'true';
    return getAiModels(enabledOnly);
  })
  .get("/api/ai-models/:id", ({ params }) => {
    const model = getAiModelById(Number(params.id));
    if (!model) return new Response("Not found", { status: 404 });
    return model;
  })
  .post("/api/ai-models", ({ body }) => {
    const { model_name, display_name, provider, capabilities, enabled } = body as any;
    return createAiModel({ model_name, display_name, provider, capabilities, enabled });
  }, {
    body: t.Object({
      model_name: t.String(),
      display_name: t.Optional(t.String()),
      provider: t.String(),
      capabilities: t.Optional(t.Record(t.String(), t.Boolean())),
      enabled: t.Optional(t.String()),
    })
  })
  .put("/api/ai-models/:id", ({ params, body }) => {
    updateAiModel(Number(params.id), body as any);
    return { success: true };
  }, {
    body: t.Object({
      model_name: t.Optional(t.String()),
      display_name: t.Optional(t.String()),
      provider: t.Optional(t.String()),
      capabilities: t.Optional(t.Record(t.String(), t.Boolean())),
      enabled: t.Optional(t.String()),
    })
  })
  .delete("/api/ai-models/:id", ({ params }) => {
    deleteAiModel(Number(params.id));
    return { success: true };
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
    const { command, requirement, history } = body as {
      command: string;
      requirement?: string;
      history?: Array<{ requirement: string; regex: string }>;
    };

    const systemMessage = `You are a shell command pattern analyzer. Convert a specific shell command into a regex pattern that matches the command's STRUCTURE — the command name and the types of arguments — without including actual argument values.

Rules:
- Keep the command name literal (e.g., ls, grep, docker, ssh)
- Replace specific file paths, hostnames, IP addresses, usernames, and other concrete values with generic patterns like \\S+, .+, [\\w.-]+, etc.
- Keep flag/option names literal when they are part of the structure, or use (\\s+-\\S+)* to match any flags
- Return ONLY the regex pattern, no explanation

Examples:
User: Command: ls -la /home/user
Assistant: ^ls(\\s+-[\\w]+)*(\\s+\\S+)*$

User: Command: grep -r "error message" /var/log/syslog
Assistant: ^grep(\\s+-[\\w]+)*\\s+\\S+(\\s+\\S+)*$

User: Command: docker run -p 8080:80 --name myapp nginx:latest
Assistant: ^docker\\s+run(\\s+-\\S+)*(\\s+\\S+)+$

User: Command: ssh -i /home/user/.ssh/id_rsa user@192.168.1.1
Assistant: ^ssh(\\s+-\\S+)*\\s+\\S+@\\S+$`;

    // Build conversation-style messages array
    type Message = { role: "system" | "user" | "assistant"; content: string };
    const messages: Message[] = [{ role: "system", content: systemMessage }];

    // Add history as conversation turns (user requirement → rejected regex)
    if (history && history.length > 0) {
      for (const h of history) {
        // Escape newlines to prevent prompt injection
        const req = h.requirement.replace(/\n/g, ' ').slice(0, 200);
        const rx = h.regex.replace(/\n/g, ' ').slice(0, 200);
        const userContent = req
          ? `Command: ${command.replace(/\n/g, ' ')}\nRequirement: ${req}`
          : `Command: ${command.replace(/\n/g, ' ')}`;
        messages.push({ role: "user", content: userContent });
        messages.push({ role: "assistant", content: rx });
      }
    }

    // Add current request
    const currentContent = requirement?.trim()
      ? `Command: ${command.replace(/\n/g, ' ')}\nRequirement: ${requirement.trim().replace(/\n/g, ' ').slice(0, 200)}`
      : `Command: ${command.replace(/\n/g, ' ')}`;
    messages.push({ role: "user", content: currentContent });

    const result = await generateText({
      model: dashscope(process.env.DASHSCOPE_LITE_MODEL || "qwen-turbo"),
      messages,
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
    const { messages, serverId, modelId } = body as {
      messages: any[];
      serverId?: number;
      modelId?: number;
    };

    // Resolve model: use DB model if modelId provided, else fall back to env config
    let modelName = process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus";
    let modelProvider = '阿里云';
    if (modelId) {
      const dbModel = getAiModelById(modelId);
      if (dbModel && dbModel.enabled === 'Y') {
        modelName = dbModel.model_name;
        modelProvider = dbModel.provider;
      }
    }

    const model = createModelClient(modelName, modelProvider);
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
      modelId: t.Optional(t.Number()),
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

  // Static frontend file serving (production / exe mode)
  .get("/*", ({ request }) => {
    const url = new URL(request.url);
    let reqPath = url.pathname;

    // Serve from embedded assets (built into exe)
    if (embeddedAssets) {
      const asset = embeddedAssets.get(reqPath) || embeddedAssets.get('/index.html');
      if (asset) {
        return new Response(asset.content, {
          headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'no-cache' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }

    // Serve from frontend dist directory (filesystem)
    if (frontendDistDir) {
      // Remove leading slash, treat '' as index.html
      let filePath = reqPath.startsWith('/') ? reqPath.slice(1) : reqPath;
      if (!filePath) filePath = 'index.html';
      const fullPath = pathModule.join(frontendDistDir, filePath);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath);
        return new Response(content, {
          headers: { 'Content-Type': getMimeType(fullPath), 'Cache-Control': 'no-cache' },
        });
      }
      // SPA fallback: return index.html for unknown paths
      const indexPath = pathModule.join(frontendDistDir, 'index.html');
      if (existsSync(indexPath)) {
        return new Response(readFileSync(indexPath), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  })
  
  .listen(3100);

console.log("Backend running on http://localhost:3100");

// Auto-open browser when running as compiled exe (embedded assets are present)
if (embeddedAssets) {
  const url = "http://localhost:3100";
  try {
    const platform = process.platform;
    if (platform === 'win32') {
      Bun.spawn(['cmd', '/c', 'start', url]);
    } else if (platform === 'darwin') {
      Bun.spawn(['open', url]);
    } else {
      Bun.spawn(['xdg-open', url]);
    }
  } catch (e) {
    console.warn('Failed to open browser:', e);
  }
}

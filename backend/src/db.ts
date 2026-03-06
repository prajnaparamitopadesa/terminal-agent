import { Database } from "bun:sqlite";

const db = new Database("terminal-agent.db", { create: true });

db.run(`
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    username TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    terminal_type TEXT DEFAULT 'bash',
    saved_password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration: add saved_password column if not exists
try {
  db.run(`ALTER TABLE servers ADD COLUMN saved_password TEXT`);
} catch (e: any) {
  if (!String(e?.message || e).includes('duplicate column')) {
    console.error('Migration error:', e);
  }
}

db.run(`
  CREATE TABLE IF NOT EXISTS auto_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    is_regex INTEGER DEFAULT 0,
    description TEXT,
    scope TEXT DEFAULT 'global',
    server_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER,
    title TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS ai_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name VARCHAR NOT NULL,
    display_name VARCHAR,
    provider VARCHAR NOT NULL,
    capabilities TEXT NOT NULL DEFAULT '{}',
    enabled VARCHAR(1) NOT NULL DEFAULT 'Y'
  )
`);

// Migration: add display_name column if not exists
try {
  db.run(`ALTER TABLE ai_models ADD COLUMN display_name VARCHAR`);
} catch (e: any) {
  if (!String(e?.message || e).includes('duplicate column')) {
    console.error('Migration error:', e);
  }
}

export { db };

export function getServers() {
  const servers = db.query("SELECT * FROM servers ORDER BY created_at DESC").all() as any[];
  return servers.map(({ saved_password, ...rest }) => ({ ...rest, has_password: !!saved_password }));
}

export function getServerById(id: number) {
  const server = db.query("SELECT * FROM servers WHERE id = ?").get(id) as any;
  if (!server) return null;
  const { saved_password, ...rest } = server;
  return { ...rest, has_password: !!saved_password };
}

export function getServerPassword(id: number): string | null {
  const row = db.query("SELECT saved_password FROM servers WHERE id = ?").get(id) as any;
  return row?.saved_password || null;
}

export function updateServerPassword(id: number, password: string | null) {
  db.run("UPDATE servers SET saved_password = ? WHERE id = ?", [password, id]);
}

export function addServer(data: { name?: string; username: string; host: string; port?: number; terminal_type?: string }) {
  const stmt = db.prepare("INSERT INTO servers (name, username, host, port, terminal_type) VALUES (?, ?, ?, ?, ?)");
  const result = stmt.run(data.name || null, data.username, data.host, data.port || 22, data.terminal_type || 'bash');
  return { id: result.lastInsertRowid, ...data };
}

export function deleteServer(id: number) {
  db.run("DELETE FROM servers WHERE id = ?", [id]);
}

export function getAutoApprovals() {
  return db.query("SELECT * FROM auto_approvals ORDER BY created_at DESC").all();
}

export function addAutoApproval(data: { pattern: string; is_regex?: boolean; description?: string; scope?: string; server_id?: number }) {
  const stmt = db.prepare("INSERT INTO auto_approvals (pattern, is_regex, description, scope, server_id) VALUES (?, ?, ?, ?, ?)");
  const result = stmt.run(data.pattern, data.is_regex ? 1 : 0, data.description || null, data.scope || 'global', data.server_id || null);
  return { id: result.lastInsertRowid, ...data };
}

export function updateAutoApproval(id: number, data: { pattern?: string; is_regex?: boolean; description?: string; scope?: string }) {
  const stmt = db.prepare("UPDATE auto_approvals SET pattern = COALESCE(?, pattern), is_regex = COALESCE(?, is_regex), description = COALESCE(?, description), scope = COALESCE(?, scope) WHERE id = ?");
  stmt.run(data.pattern || null, data.is_regex !== undefined ? (data.is_regex ? 1 : 0) : null, data.description || null, data.scope || null, id);
}

export function deleteAutoApproval(id: number) {
  db.run("DELETE FROM auto_approvals WHERE id = ?", [id]);
}

// Conversation CRUD
export function getConversations(options: { search?: string; limit?: number; offset?: number; server_id?: number } = {}) {
  const { search, limit = 20, offset = 0, server_id } = options;
  const conditions: string[] = [];
  const params: any[] = [];

  if (server_id !== undefined) {
    conditions.push("server_id = ?");
    params.push(server_id);
  }

  if (search && search.trim()) {
    conditions.push("title LIKE ?");
    params.push(`%${search.trim()}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);

  const rows = db.query(`SELECT id, server_id, title, created_at, updated_at FROM conversations ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params) as any[];
  return rows;
}

export function getConversation(id: number) {
  return db.query("SELECT * FROM conversations WHERE id = ?").get(id) as any;
}

export function createConversation(data: { server_id?: number; title: string; messages: string }) {
  const stmt = db.prepare("INSERT INTO conversations (server_id, title, messages) VALUES (?, ?, ?)");
  const result = stmt.run(data.server_id || null, data.title, data.messages);
  return { id: result.lastInsertRowid, ...data };
}

export function updateConversation(id: number, data: { title?: string; messages?: string }) {
  const stmt = db.prepare("UPDATE conversations SET title = COALESCE(?, title), messages = COALESCE(?, messages), updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  stmt.run(data.title || null, data.messages || null, id);
}

export function deleteConversation(id: number) {
  db.run("DELETE FROM conversations WHERE id = ?", [id]);
}

export function getRecentPrompts(options: { server_id?: number; limit?: number } = {}) {
  const { server_id, limit = 50 } = options;
  const conditions: string[] = [];
  const params: any[] = [];

  if (server_id !== undefined) {
    conditions.push("server_id = ?");
    params.push(server_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = db.query(`SELECT messages FROM conversations ${where} ORDER BY updated_at DESC LIMIT ?`).all(...params) as any[];

  // Extract the first user message from each conversation
  const prompts: string[] = [];
  for (const row of rows) {
    try {
      const messages = JSON.parse(row.messages);
      for (const msg of messages) {
        if (msg.role === 'user') {
          // Extract text content from parts
          const text = msg.parts
            ?.filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('') || msg.content || '';
          if (text.trim()) {
            prompts.push(text.trim());
          }
          break; // Only first user message per conversation
        }
      }
    } catch (e) {
      console.error('Failed to parse conversation messages:', e);
    }
  }
  return prompts;
}

export function checkAutoApproval(command: string, serverId?: number): boolean {
  const rules = db.query("SELECT * FROM auto_approvals").all() as any[];
  for (const rule of rules) {
    if (rule.scope === 'server' && rule.server_id !== serverId) continue;
    if (rule.is_regex) {
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(command)) return true;
      } catch {}
    } else {
      if (rule.pattern === command) return true;
    }
  }
  return false;
}

// AI Model CRUD
export interface AiModelCapabilities {
  multimodal?: boolean;
  deep_thinking?: boolean;
  tool_calling?: boolean;
  function_calling?: boolean;
  [key: string]: boolean | undefined;
}

export interface AiModel {
  id: number;
  model_name: string;
  display_name: string;
  provider: string;
  capabilities: AiModelCapabilities;
  enabled: 'Y' | 'N';
}

function parseAiModel(row: any): AiModel {
  return {
    ...row,
    capabilities: typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities,
  };
}

export function getAiModels(enabledOnly = false): AiModel[] {
  const rows = enabledOnly
    ? db.query("SELECT * FROM ai_models WHERE enabled = 'Y' ORDER BY id").all() as any[]
    : db.query("SELECT * FROM ai_models ORDER BY id").all() as any[];
  return rows.map(parseAiModel);
}

export function getAiModelById(id: number): AiModel | null {
  const row = db.query("SELECT * FROM ai_models WHERE id = ?").get(id) as any;
  return row ? parseAiModel(row) : null;
}

export function getAiModelByName(modelName: string): AiModel | null {
  const row = db.query("SELECT * FROM ai_models WHERE model_name = ?").get(modelName) as any;
  return row ? parseAiModel(row) : null;
}

export function createAiModel(data: { model_name: string; display_name?: string; provider: string; capabilities?: AiModelCapabilities; enabled?: 'Y' | 'N' }): AiModel {
  const display_name = data.display_name ?? data.model_name;
  const capabilities = JSON.stringify(data.capabilities || {});
  const enabled = data.enabled ?? 'Y';
  const stmt = db.prepare("INSERT INTO ai_models (model_name, display_name, provider, capabilities, enabled) VALUES (?, ?, ?, ?, ?)");
  const result = stmt.run(data.model_name, display_name, data.provider, capabilities, enabled);
  return { id: Number(result.lastInsertRowid), model_name: data.model_name, display_name, provider: data.provider, capabilities: data.capabilities || {}, enabled };
}

export function updateAiModel(id: number, data: { model_name?: string; display_name?: string; provider?: string; capabilities?: AiModelCapabilities; enabled?: 'Y' | 'N' }): void {
  const current = getAiModelById(id);
  if (!current) return;
  const model_name = data.model_name ?? current.model_name;
  const display_name = data.display_name ?? current.display_name;
  const provider = data.provider ?? current.provider;
  const capabilities = JSON.stringify(data.capabilities ?? current.capabilities);
  const enabled = data.enabled ?? current.enabled;
  db.run("UPDATE ai_models SET model_name = ?, display_name = ?, provider = ?, capabilities = ?, enabled = ? WHERE id = ?", [model_name, display_name, provider, capabilities, enabled, id]);
}

export function deleteAiModel(id: number): void {
  db.run("DELETE FROM ai_models WHERE id = ?", [id]);
}

export function seedModelsFromJson(jsonContent: string): void {
  const count = db.query("SELECT COUNT(*) as n FROM ai_models").get() as any;
  if (count?.n > 0) return; // Only seed if empty

  const data = JSON.parse(jsonContent);
  const providers: Array<{ name: string; label?: string; models?: any[] }> = data.providers || [];
  for (const provider of providers) {
    for (const model of provider.models || []) {
      createAiModel({
        model_name: model.model_name,
        display_name: model.display_name,
        provider: provider.name,
        capabilities: model.capabilities || {},
        enabled: model.enabled ?? 'Y',
      });
    }
  }
}

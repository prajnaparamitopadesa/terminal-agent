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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

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

export { db };

export function getServers() {
  return db.query("SELECT * FROM servers ORDER BY created_at DESC").all();
}

export function getServerById(id: number) {
  return db.query("SELECT * FROM servers WHERE id = ?").get(id);
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

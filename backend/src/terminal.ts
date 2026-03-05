import { Client } from "ssh2";

interface TerminalSession {
  client: Client;
  stream: any;
  serverId: number;
  screenBuffer: string[];
  pendingInput: string;
}

const sessions = new Map<string, TerminalSession>();

export function createSession(sessionId: string, serverId: number): TerminalSession {
  const session: TerminalSession = {
    client: new Client(),
    stream: null,
    serverId,
    screenBuffer: [],
    pendingInput: ''
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): TerminalSession | undefined {
  return sessions.get(sessionId);
}

export function removeSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) {
    try { session.client.end(); } catch { /* ignore errors during cleanup */ }
    sessions.delete(sessionId);
  }
}

export async function connectSSH(
  sessionId: string,
  config: { host: string; port: number; username: string; password?: string; privateKey?: string },
  onData: (data: string) => void,
  onClose: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const session = sessions.get(sessionId);
    if (!session) return reject(new Error("Session not found"));

    session.client
      .on("ready", () => {
        session.client.shell({ term: "xterm-256color", cols: 220, rows: 50 }, (err, stream) => {
          if (err) return reject(err);
          session.stream = stream;
          stream.on("data", (data: Buffer) => {
            const text = data.toString();
            session.screenBuffer.push(text);
            if (session.screenBuffer.length > 1000) session.screenBuffer.shift();
            onData(text);
          });
          stream.on("close", onClose);
          resolve();
        });
      })
      .on("error", reject)
      .connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey,
        readyTimeout: 10000,
      });
  });
}

export function sendInput(sessionId: string, input: string) {
  const session = sessions.get(sessionId);
  if (session?.stream) {
    session.stream.write(input);
  }
}

export function resizeTerminal(sessionId: string, cols: number, rows: number) {
  const session = sessions.get(sessionId);
  if (session?.stream) {
    session.stream.setWindow(rows, cols, 0, 0);
  }
}

// ==========================================
// Agent SSH connections (independent of terminal)
// ==========================================

const agentClients = new Map<string, Client>();

export async function ensureAgentConnection(
  sessionId: string,
  config: { host: string; port: number; username: string; password?: string }
): Promise<void> {
  const existing = agentClients.get(sessionId);
  if (existing) return;

  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    client
      .on("ready", () => {
        agentClients.set(sessionId, client);
        resolve();
      })
      .on("error", (err) => {
        reject(err);
      })
      .on("close", () => {
        agentClients.delete(sessionId);
      })
      .connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: 10000,
      });
  });
}

export function removeAgentConnection(sessionId: string) {
  const client = agentClients.get(sessionId);
  if (client) {
    try { client.end(); } catch { /* ignore */ }
    agentClients.delete(sessionId);
  }
}

// ==========================================
// Exec stream management
// ==========================================

interface ExecStream {
  stream: any;
  output: string;
  closed: boolean;
  exitCode: number | null;
  lastOutputTime: number;
  pendingResolves: Array<(data: string | null) => void>;
  buffer: string[];
  sessionId: string;
}

const execStreams = new Map<string, ExecStream>();

export async function execCommand(sessionId: string, command: string): Promise<string> {
  const client = agentClients.get(sessionId);
  if (!client) throw new Error("Agent not connected");

  const streamId = `exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    client.exec(command, { pty: true }, (err: Error | undefined, stream: any) => {
      if (err) return reject(err);

      const execStream: ExecStream = {
        stream,
        output: '',
        closed: false,
        exitCode: null,
        lastOutputTime: Date.now(),
        pendingResolves: [],
        buffer: [],
        sessionId,
      };

      stream.on('data', (data: Buffer) => {
        const text = data.toString();
        execStream.output += text;
        execStream.lastOutputTime = Date.now();

        if (execStream.pendingResolves.length > 0) {
          const res = execStream.pendingResolves.shift()!;
          res(text);
        } else {
          execStream.buffer.push(text);
        }
      });

      stream.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        execStream.output += text;
        execStream.lastOutputTime = Date.now();

        if (execStream.pendingResolves.length > 0) {
          const res = execStream.pendingResolves.shift()!;
          res(text);
        } else {
          execStream.buffer.push(text);
        }
      });

      stream.on('close', (code: number) => {
        execStream.closed = true;
        execStream.exitCode = code;
        for (const res of execStream.pendingResolves) {
          res(null);
        }
        execStream.pendingResolves = [];
      });

      execStreams.set(streamId, execStream);
      resolve(streamId);
    });
  });
}

/**
 * Read the next chunk of output from an exec stream.
 * Returns null on timeout or stream close.
 */
export function readNextChunk(streamId: string, timeoutMs: number): Promise<string | null> {
  const execStream = execStreams.get(streamId);
  if (!execStream) return Promise.resolve(null);

  if (execStream.buffer.length > 0) {
    return Promise.resolve(execStream.buffer.shift()!);
  }

  if (execStream.closed) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = execStream.pendingResolves.indexOf(wrappedResolve);
      if (idx >= 0) execStream.pendingResolves.splice(idx, 1);
      resolve(null);
    }, timeoutMs);

    const wrappedResolve = (data: string | null) => {
      clearTimeout(timer);
      resolve(data);
    };

    execStream.pendingResolves.push(wrappedResolve);
  });
}

export function getExecStreamInfo(streamId: string): { output: string; closed: boolean; exitCode: number | null } | null {
  const execStream = execStreams.get(streamId);
  if (!execStream) return null;
  return {
    output: execStream.output,
    closed: execStream.closed,
    exitCode: execStream.exitCode,
  };
}

export function sendExecInput(streamId: string, input: string): boolean {
  const execStream = execStreams.get(streamId);
  if (execStream?.stream && !execStream.closed) {
    execStream.stream.write(input);
    return true;
  }
  return false;
}

export function closeExecStream(streamId: string): void {
  const execStream = execStreams.get(streamId);
  if (execStream) {
    if (!execStream.closed) {
      try { execStream.stream.close(); } catch { /* ignore */ }
    }
    execStreams.delete(streamId);
  }
}

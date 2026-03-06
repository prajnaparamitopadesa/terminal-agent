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
        // Use the server's default shell via shell() rather than forcing bash
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
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
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
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
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
  /** Raw SSH output including ANSI escape sequences */
  rawOutput: string;
  closed: boolean;
  exitCode: number | null;
  lastOutputTime: number;
  pendingResolves: Array<(data: string | null) => void>;
  buffer: string[];
  sessionId: string;
}

const execStreams = new Map<string, ExecStream>();

const DEBUG_EXEC = process.env.DEBUG_AGENT === '1';

function debugLog(...args: unknown[]) {
  if (DEBUG_EXEC) console.log('[DEBUG_AGENT]', ...args);
}

export async function execCommand(sessionId: string, command: string): Promise<string> {
  const client = agentClients.get(sessionId);
  if (!client) throw new Error("Agent not connected");

  const streamId = `exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  debugLog(`execCommand start: streamId=${streamId} command=${command}`);

  // Encode the command as base64 and pass it as a positional parameter ($1) to
  // avoid all shell-escaping issues. base64 output only contains the characters
  // [A-Za-z0-9+/=] so the value is safe to embed unquoted. The inner bash
  // decodes and runs the original command.
  const b64 = Buffer.from(command).toString('base64');
  const wrappedCommand = `/bin/bash -c 'echo "$1" | base64 -d | /bin/bash' -- ${b64}`;

  return new Promise((resolve, reject) => {
    // Do NOT use pty:true — PTY causes programs like systemctl to invoke a pager
    // (e.g. `less`) that waits for user input, stalling the stream indefinitely.
    // Without PTY, commands run non-interactively and exit cleanly.
    // Both stdout AND stderr must be consumed to prevent backpressure stalls.
    client.exec(wrappedCommand, (err: Error | undefined, stream: any) => {
      if (err) {
        debugLog(`execCommand error: streamId=${streamId}`, err.message);
        return reject(err);
      }

      const execStream: ExecStream = {
        stream,
        rawOutput: '',
        closed: false,
        exitCode: null,
        lastOutputTime: Date.now(),
        pendingResolves: [],
        buffer: [],
        sessionId,
      };

      const onData = (data: Buffer) => {
        const text = data.toString();
        debugLog(`exec data: streamId=${streamId} len=${text.length}`);
        execStream.rawOutput += text;
        execStream.lastOutputTime = Date.now();

        if (execStream.pendingResolves.length > 0) {
          const res = execStream.pendingResolves.shift()!;
          res(text);
        } else {
          execStream.buffer.push(text);
        }
      };

      stream.on('data', onData);
      // Consume stderr to prevent backpressure stalls on non-PTY exec channels.
      // stderr always exists on exec channels but use optional chaining for safety.
      if (stream.stderr) {
        stream.stderr.on('data', onData);
      }

      // Capture exit code before 'close' fires (ssh2 exec channels)
      stream.on('exit', (code: number | null, signal?: string) => {
        debugLog(`exec exit: streamId=${streamId} code=${code} signal=${signal}`);
        execStream.exitCode = code ?? (signal ? -1 : 0);
      });

      stream.on('close', () => {
        debugLog(`exec close: streamId=${streamId} exitCode=${execStream.exitCode} outputLen=${execStream.rawOutput.length}`);
        execStream.closed = true;
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
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      const idx = execStream.pendingResolves.indexOf(wrappedResolve);
      if (idx >= 0) execStream.pendingResolves.splice(idx, 1);
      resolve(null);
    }, timeoutMs);

    const wrappedResolve = (data: string | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(data);
    };

    execStream.pendingResolves.push(wrappedResolve);
  });
}

export function getExecStreamInfo(streamId: string): { rawOutput: string; closed: boolean; exitCode: number | null } | null {
  const execStream = execStreams.get(streamId);
  if (!execStream) return null;
  return {
    rawOutput: execStream.rawOutput,
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

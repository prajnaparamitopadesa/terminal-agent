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

export function getScreenContent(sessionId: string): string {
  const session = sessions.get(sessionId);
  if (!session) return "";
  return session.screenBuffer.slice(-50).join("");
}

export async function runCommandAndWait(
  sessionId: string,
  command: string,
  timeout = 30000
): Promise<string> {
  const session = sessions.get(sessionId);
  if (!session?.stream) throw new Error("No active terminal session");
  
  const marker = `__CMD_DONE_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
  const output: string[] = [];
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(output.join(""));
    }, timeout);
    
    const handler = (data: Buffer) => {
      const text = data.toString();
      output.push(text);
      if (text.includes(marker)) {
        clearTimeout(timer);
        session.stream.removeListener("data", handler);
        resolve(output.join(""));
      }
    };
    
    session.stream.on("data", handler);
    session.stream.write(`${command}; echo "${marker}"\n`);
  });
}

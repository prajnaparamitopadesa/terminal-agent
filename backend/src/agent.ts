import { ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import {
  ensureAgentConnection,
  execCommand,
  readNextChunk,
  getExecStreamInfo,
  sendExecInput,
  closeExecStream,
} from "./terminal";
import { checkAutoApproval, getServerById, getServerPassword } from "./db";
import type { LanguageModel } from "ai";

// Pending user input requests (for request-user-input tool)
interface PendingUserInput {
  resolve: (input: string) => void;
  streamId: string;
  prompt: string;
  isPassword: boolean;
}
const pendingUserInputs = new Map<string, PendingUserInput>();

export function getPendingUserInputs() {
  return Array.from(pendingUserInputs.entries()).map(([id, { streamId, prompt, isPassword }]) => ({
    id, streamId, prompt, isPassword,
  }));
}

export function resolveUserInput(id: string, input: string) {
  const pending = pendingUserInputs.get(id);
  if (pending) {
    pendingUserInputs.delete(id);
    pending.resolve(input);
  }
}

export interface AgentContext {
  sessionId: string;
  serverId: number;
}

async function collectExecOutput(
  streamId: string,
  options: {
    timeout: number;
    handleInput?: boolean;
    promptTimeout?: number;
    promptRegex?: string;
    onChunk?: (totalOutput: string) => void;
  }
): Promise<{ output: string; closed: boolean; exitCode: number | null; streamId?: string }> {
  const { timeout, handleInput = false, promptTimeout = 3000, promptRegex, onChunk } = options;
  const startTime = Date.now();
  let lastDataTime = Date.now();

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeout) break;

    const idleDuration = handleInput ? promptTimeout : timeout - elapsed;
    const waitTime = Math.min(idleDuration, timeout - elapsed);
    const chunk = await readNextChunk(streamId, waitTime);

    const info = getExecStreamInfo(streamId);
    if (!info) break;

    if (chunk !== null) {
      lastDataTime = Date.now();
      onChunk?.(info.output);

      // Check prompt regex on new data
      if (handleInput && promptRegex) {
        try {
          if (new RegExp(promptRegex).test(info.output.slice(-500))) {
            return { output: info.output, closed: info.closed, exitCode: info.exitCode, streamId: info.closed ? undefined : streamId };
          }
        } catch { /* invalid regex, ignore */ }
      }
    } else {
      // No data received within wait time
      if (info.closed) break;

      // Idle timeout
      const idleTime = Date.now() - lastDataTime;
      if (handleInput && idleTime >= promptTimeout) {
        // Check prompt regex one more time
        if (promptRegex) {
          try {
            if (new RegExp(promptRegex).test(info.output.slice(-500))) {
              return { output: info.output, closed: info.closed, exitCode: info.exitCode, streamId: info.closed ? undefined : streamId };
            }
          } catch { /* invalid regex */ }
        }
        // Return on idle timeout regardless
        return { output: info.output, closed: info.closed, exitCode: info.exitCode, streamId: info.closed ? undefined : streamId };
      }
    }
  }

  const finalInfo = getExecStreamInfo(streamId);
  if (!finalInfo) return { output: '', closed: true, exitCode: null };
  return {
    output: finalInfo.output,
    closed: finalInfo.closed,
    exitCode: finalInfo.exitCode,
    streamId: finalInfo.closed ? undefined : streamId,
  };
}

function createTools(ctx: AgentContext) {
  return {
    "exec": tool({
      description: `执行命令并获取输出。通过独立的 SSH exec 通道运行命令。
参数说明：
- command: 要执行的命令
- timeout: 总超时时间（毫秒），默认 30000
- handleInput: 是否预期命令需要交互输入（如密码提示等）
- promptTimeout: 当 handleInput=true 时，流空闲多久后认为出现了输入提示（毫秒），默认 3000
- promptRegex: 当 handleInput=true 时，用于检测输入提示的正则表达式

返回结果包含：
- output: 命令输出内容
- closed: 流是否已关闭
- exitCode: 退出码（仅在 closed=true 时有效）
- streamId: 流ID（仅在 closed=false 时返回，可用于后续 send-input/wait-output/close-stream 操作）`,
      inputSchema: z.object({
        command: z.string().describe("要执行的命令"),
        timeout: z.number().optional().describe("总超时时间（毫秒），默认 30000"),
        handleInput: z.boolean().optional().describe("是否预期命令需要交互输入"),
        promptTimeout: z.number().optional().describe("流空闲多久后判定为输入提示（毫秒），默认 3000"),
        promptRegex: z.string().optional().describe("检测输入提示的正则表达式"),
      }),
      needsApproval: (input: { command: string }) => {
        return !checkAutoApproval(input.command, ctx.serverId);
      },
      async *execute({ command, timeout = 30000, handleInput = false, promptTimeout = 3000, promptRegex }) {
        yield { output: '', closed: false, exitCode: null as number | null, streamId: undefined as string | undefined, command };

        try {
          // Ensure agent SSH connection
          const server = getServerById(ctx.serverId);
          if (!server) throw new Error("Server not found");
          const password = getServerPassword(ctx.serverId);
          await ensureAgentConnection(ctx.sessionId, {
            host: server.host,
            port: server.port || 22,
            username: server.username,
            password: password || undefined,
          });

          const streamId = await execCommand(ctx.sessionId, command);

          const result = await collectExecOutput(streamId, {
            timeout,
            handleInput,
            promptTimeout,
            promptRegex,
            onChunk: (totalOutput) => {
              // Note: Can't yield from callback; streaming is handled by polling in collectExecOutput
            },
          });

          yield {
            output: result.output,
            closed: result.closed,
            exitCode: result.exitCode,
            streamId: result.streamId,
            command,
          };
        } catch (e: unknown) {
          const error = e instanceof Error ? e.message : String(e);
          yield { output: `Error: ${error}`, closed: true, exitCode: -1, streamId: undefined, command };
        }
      },
    }),

    "send-input": tool({
      description: `向一个打开的 exec 流发送输入。用于交互式命令（如回答提示、输入命令等）。
发送后会等待输出。
注意：不要用此工具发送密码，使用 send-password 或 request-user-input 代替。`,
      inputSchema: z.object({
        streamId: z.string().describe("exec 流 ID"),
        input: z.string().describe("要发送的输入内容"),
        pressEnter: z.boolean().optional().describe("是否在输入后按回车，默认 true"),
        waitTimeout: z.number().optional().describe("发送后等待输出的超时时间（毫秒），默认 5000"),
        promptRegex: z.string().optional().describe("检测下一个输入提示的正则表达式"),
      }),
      async *execute({ streamId, input, pressEnter = true, waitTimeout = 5000, promptRegex }) {
        yield { output: '', closed: false, exitCode: null as number | null, streamId, sent: false };

        const sent = sendExecInput(streamId, input + (pressEnter ? "\n" : ""));
        if (!sent) {
          yield { output: 'Error: Stream not found or already closed', closed: true, exitCode: null, streamId: undefined as string | undefined, sent: false };
          return;
        }

        const result = await collectExecOutput(streamId, {
          timeout: waitTimeout,
          handleInput: true,
          promptTimeout: waitTimeout,
          promptRegex,
        });

        yield {
          output: result.output,
          closed: result.closed,
          exitCode: result.exitCode,
          streamId: result.streamId,
          sent: true,
        };
      },
    }),

    "wait-output": tool({
      description: "继续等待一个已打开的 exec 流的输出。用于需要更多时间完成的命令。",
      inputSchema: z.object({
        streamId: z.string().describe("exec 流 ID"),
        timeout: z.number().optional().describe("等待超时时间（毫秒），默认 15000"),
        promptRegex: z.string().optional().describe("检测输入提示的正则表达式"),
      }),
      async *execute({ streamId, timeout = 15000, promptRegex }) {
        yield { output: '', closed: false, exitCode: null as number | null, streamId };

        const result = await collectExecOutput(streamId, {
          timeout,
          handleInput: !!promptRegex,
          promptTimeout: timeout,
          promptRegex,
        });

        yield {
          output: result.output,
          closed: result.closed,
          exitCode: result.exitCode,
          streamId: result.streamId,
        };
      },
    }),

    "send-password": tool({
      description: "向一个打开的 exec 流发送服务器保存的密码（密码不会出现在对话中）。用于 sudo 提示等需要密码的场景。",
      inputSchema: z.object({
        streamId: z.string().describe("exec 流 ID"),
        waitTimeout: z.number().optional().describe("发送后等待输出的超时时间（毫秒），默认 5000"),
        promptRegex: z.string().optional().describe("检测下一个输入提示的正则表达式"),
      }),
      async *execute({ streamId, waitTimeout = 5000, promptRegex }) {
        yield { output: '', closed: false, exitCode: null as number | null, streamId, sent: false };

        const password = getServerPassword(ctx.serverId);
        if (!password) {
          yield { output: 'Error: No saved password for this server', closed: false, exitCode: null, streamId, sent: false };
          return;
        }

        const sent = sendExecInput(streamId, password + "\n");
        if (!sent) {
          yield { output: 'Error: Stream not found or already closed', closed: true, exitCode: null, streamId: undefined as string | undefined, sent: false };
          return;
        }

        const result = await collectExecOutput(streamId, {
          timeout: waitTimeout,
          handleInput: true,
          promptTimeout: waitTimeout,
          promptRegex,
        });

        yield {
          output: result.output,
          closed: result.closed,
          exitCode: result.exitCode,
          streamId: result.streamId,
          sent: true,
        };
      },
    }),

    "request-user-input": tool({
      description: `请求用户提供输入（如密码等敏感信息），输入内容不会暴露在 AI 上下文中。
用于需要用户手动输入密码或其他敏感信息的场景。
工具会等待用户在界面中输入内容后自动发送到流中。`,
      inputSchema: z.object({
        streamId: z.string().describe("exec 流 ID"),
        prompt: z.string().describe("显示给用户的提示文字"),
        isPassword: z.boolean().optional().describe("是否为密码输入（UI 会隐藏输入内容），默认 false"),
        waitTimeout: z.number().optional().describe("发送后等待输出的超时时间（毫秒），默认 10000"),
        promptRegex: z.string().optional().describe("检测下一个输入提示的正则表达式"),
      }),
      async *execute({ streamId, prompt, isPassword = false, waitTimeout = 10000, promptRegex }) {
        yield { status: "waiting-for-user-input" as const, prompt, isPassword, streamId };

        const requestId = `input_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // Wait for user to provide input
        const userInput = await new Promise<string>((resolve) => {
          pendingUserInputs.set(requestId, { resolve, streamId, prompt, isPassword });
        });

        const sent = sendExecInput(streamId, userInput + "\n");
        if (!sent) {
          yield { status: "done" as const, prompt, isPassword, streamId: undefined as string | undefined, output: 'Error: Stream closed', closed: true, exitCode: null as number | null, sent: false };
          return;
        }

        const result = await collectExecOutput(streamId, {
          timeout: waitTimeout,
          handleInput: true,
          promptTimeout: waitTimeout,
          promptRegex,
        });

        yield {
          status: "done" as const,
          prompt,
          isPassword,
          streamId: result.streamId,
          output: result.output,
          closed: result.closed,
          exitCode: result.exitCode,
          sent: true,
        };
      },
    }),

    "close-stream": tool({
      description: "关闭一个打开的 exec 流。",
      inputSchema: z.object({
        streamId: z.string().describe("exec 流 ID"),
      }),
      async *execute({ streamId }) {
        closeExecStream(streamId);
        yield { closed: true, streamId };
      },
    }),
  };
}

export function createTerminalAgent(model: LanguageModel, ctx: AgentContext) {
  const instructions = `你是一个服务器诊断 agent。你帮助用户通过终端命令诊断和修复服务器问题。

你可以使用以下工具：
- exec: 执行命令。所有命令在执行前需要用户审批（由工具自动处理）。
  - 对于可能需要输入的命令（如 sudo），设置 handleInput=true 和 promptRegex 来检测输入提示
  - 命令完成后会返回 output、closed、exitCode 和 streamId
  - 如果 streamId 存在（流未关闭），可以用后续工具继续操作

- send-input: 向打开的流发送文本输入（不要用于密码）
- wait-output: 继续等待流的输出
- send-password: 发送服务器保存的密码到流中（密码不会出现在对话中）
- request-user-input: 请求用户在界面中输入内容（如密码），内容不会暴露在 AI 上下文中
- close-stream: 关闭流

工作流程示例：
1. 普通命令：exec("ls -la") → 获取输出
2. sudo 命令：exec("sudo apt update", handleInput=true, promptRegex="\\\\[sudo\\\\]|password") → 检测到密码提示 → send-password(streamId) → 获取输出
3. 需要用户输入密码：exec(...) → 检测到提示 → request-user-input(streamId, "请输入密码", isPassword=true)

在运行命令之前，请先解释你要做什么。`;

  return new ToolLoopAgent({
    model,
    instructions,
    tools: createTools(ctx),
    stopWhen: [(p) => (p.steps?.length ?? 0) >= 20],
  });
}

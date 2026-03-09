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
import path from "path";
import { mkdirSync, writeFileSync, readFileSync } from "fs";

const DEBUG_AGENT = process.env.DEBUG_AGENT === '1';

// Directory to store full exec output when output is too long
const execOutputDir = path.join(process.cwd(), 'exec-output');
mkdirSync(execOutputDir, { recursive: true });

const MAX_OUTPUT_LINES = 60;
const CONTEXT_LINES = 20;

/**
 * If rawOutput exceeds MAX_OUTPUT_LINES, persist the full stripped content to
 * a log file and return a truncated display string with first/last CONTEXT_LINES.
 */
function processLongOutput(rawOutput: string, outputId: string): {
  displayOutput: string;
  outputId: string | undefined;
  totalLines: number;
} {
  const lines = rawOutput.split('\n');
  if (lines.length <= MAX_OUTPUT_LINES) {
    return { displayOutput: rawOutput, outputId: undefined, totalLines: lines.length };
  }

  // Save stripped output (no ANSI) to file for easy reading
  const filePath = path.join(execOutputDir, `${outputId}.log`);
  try {
    writeFileSync(filePath, stripAnsi(rawOutput));
  } catch (e) {
    console.error('Failed to save exec output:', e);
  }

  const firstLines = lines.slice(0, CONTEXT_LINES);
  const lastLines = lines.slice(-CONTEXT_LINES);
  const omittedCount = lines.length - CONTEXT_LINES * 2;

  const displayOutput = [
    ...firstLines,
    '',
    `... [已省略 ${omittedCount} 行，完整内容已保存。可使用 read-output 工具（outputId="${outputId}"）查看完整内容] ...`,
    '',
    ...lastLines,
  ].join('\n');

  return { displayOutput, outputId, totalLines: lines.length };
}

/** Remove ANSI escape sequences so plain text can be sent to the AI model */
const ansiEscapePattern = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;
function stripAnsi(str: string): string {
  return str.replace(ansiEscapePattern, '');
}

/**
 * Returns a toModelOutput callback that strips ANSI codes from the `output`
 * field so colorized terminal output does not interfere with the AI model.
 * The raw ANSI output is still sent to the frontend for colorized rendering.
 */
function toModelOutputStrippedAnsi(output: unknown): { type: 'json'; value: any } {
  const result = output as Record<string, any>;
  return {
    type: 'json',
    value: { ...result, output: stripAnsi(String(result.output ?? '')) },
  };
}

function agentDebug(...args: unknown[]) {
  if (DEBUG_AGENT) console.log('[DEBUG_AGENT agent]', ...args);
}

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
    onChunk?: (totalRawOutput: string) => void;
  }
): Promise<{ rawOutput: string; closed: boolean; exitCode: number | null; streamId?: string }> {
  const { timeout, handleInput = false, promptTimeout = 3000, promptRegex, onChunk } = options;
  const startTime = Date.now();
  let lastDataTime = Date.now();

  // Pre-compile prompt regex once
  let compiledPromptRegex: RegExp | null = null;
  if (promptRegex) {
    try { compiledPromptRegex = new RegExp(promptRegex); } catch { /* invalid regex */ }
  }

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeout) {
      agentDebug(`collectExecOutput timeout: streamId=${streamId} elapsed=${elapsed}`);
      break;
    }

    const idleDuration = handleInput ? promptTimeout : timeout - elapsed;
    const waitTime = Math.min(idleDuration, timeout - elapsed);
    agentDebug(`collectExecOutput waiting: streamId=${streamId} waitTime=${waitTime}`);
    const chunk = await readNextChunk(streamId, waitTime);

    const info = getExecStreamInfo(streamId);
    if (!info) {
      agentDebug(`collectExecOutput: streamId=${streamId} no info, breaking`);
      break;
    }

    if (chunk !== null) {
      lastDataTime = Date.now();
      onChunk?.(info.rawOutput);
      agentDebug(`collectExecOutput chunk received: streamId=${streamId} chunkLen=${chunk.length} closed=${info.closed}`);

      // Check prompt regex on new data
      if (handleInput && compiledPromptRegex) {
        if (compiledPromptRegex.test(info.rawOutput.slice(-500))) {
          return { rawOutput: info.rawOutput, closed: info.closed, exitCode: info.exitCode, streamId: info.closed ? undefined : streamId };
        }
      }
    } else {
      // No data received within wait time
      if (info.closed) {
        agentDebug(`collectExecOutput: streamId=${streamId} stream closed, breaking`);
        break;
      }

      // Idle timeout
      const idleTime = Date.now() - lastDataTime;
      if (handleInput && idleTime >= promptTimeout) {
        // Check prompt regex one more time
        if (compiledPromptRegex) {
          if (compiledPromptRegex.test(info.rawOutput.slice(-500))) {
            return { rawOutput: info.rawOutput, closed: info.closed, exitCode: info.exitCode, streamId: info.closed ? undefined : streamId };
          }
        }
        agentDebug(`collectExecOutput idle timeout: streamId=${streamId} idleTime=${idleTime}`);
        // Return on idle timeout regardless
        return { rawOutput: info.rawOutput, closed: info.closed, exitCode: info.exitCode, streamId: info.closed ? undefined : streamId };
      }
    }
  }

  const finalInfo = getExecStreamInfo(streamId);
  if (!finalInfo) return { rawOutput: '', closed: true, exitCode: null };
  return {
    rawOutput: finalInfo.rawOutput,
    closed: finalInfo.closed,
    exitCode: finalInfo.exitCode,
    streamId: finalInfo.closed ? undefined : streamId,
  };
}

const COMPACT_RUN_THRESHOLD = 5;

/**
 * Format a list of 1-based line numbers from a file into a compact string.
 * Consecutive runs of COMPACT_RUN_THRESHOLD or more lines only show the first
 * and last line with their numbers; shorter runs show every line with its number.
 */
function formatLinesCompact(allLines: string[], lineNums: number[]): string {
  if (lineNums.length === 0) return '';

  // Split into consecutive runs
  const runs: number[][] = [];
  let run: number[] = [lineNums[0]];
  for (let i = 1; i < lineNums.length; i++) {
    if (lineNums[i] === lineNums[i - 1] + 1) {
      run.push(lineNums[i]);
    } else {
      runs.push(run);
      run = [lineNums[i]];
    }
  }
  runs.push(run);

  const parts: string[] = [];
  for (const r of runs) {
    if (r.length >= COMPACT_RUN_THRESHOLD) {
      const first = r[0];
      const last = r[r.length - 1];
      const firstLine = allLines[first - 1] ?? '';
      const lastLine = allLines[last - 1] ?? '';
      const omitted = r.length - 2;
      parts.push(`${first}: ${firstLine}`);
      parts.push(`... [${omitted} 行省略] ...`);
      parts.push(`${last}: ${lastLine}`);
    } else {
      for (const n of r) {
        parts.push(`${n}: ${allLines[n - 1] ?? ''}`);
      }
    }
  }
  return parts.join('\n');
}

function createTools(ctx: AgentContext) {
  return {
    "exec": tool({
      description: `执行命令并获取完整输出。通过独立的 SSH exec 通道运行命令，等待命令结束后返回结果。
仅用于不需要交互输入的命令。如需交互输入，请使用 exec-stream。

参数说明：
- command: 要执行的命令
- timeout: 总超时时间（毫秒），默认 30000

返回结果包含：
- output: 命令输出内容（过长时自动截断，并返回 outputId 供 read-output 使用）
- exitCode: 退出码`,
      inputSchema: z.object({
        command: z.string().describe("要执行的命令"),
        timeout: z.number().optional().describe("总超时时间（毫秒），默认 30000"),
      }),
      needsApproval: (input: { command: string }) => {
        return !checkAutoApproval(input.command, ctx.serverId);
      },
      toModelOutput: ({ output }) => toModelOutputStrippedAnsi(output),
      async *execute({ command, timeout = 30000 }) {
        yield { output: '', exitCode: null as number | null, command };

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

          const result = await collectExecOutput(streamId, { timeout });

          const { displayOutput, outputId, totalLines } = processLongOutput(result.rawOutput, streamId);

          yield {
            output: displayOutput,
            exitCode: result.exitCode,
            command,
            outputId,
            totalLines,
          };
        } catch (e: unknown) {
          const error = e instanceof Error ? e.message : String(e);
          yield { output: `Error: ${error}`, exitCode: -1, command };
        }
      },
    }),

    "exec-stream": tool({
      description: `执行命令并以流式方式获取输出，用于需要交互输入的命令（如 sudo、ssh、交互式程序等）。
通过独立的 SSH exec 通道运行命令，返回流 ID 供后续 send-input/send-password/wait-output/close-stream 使用。

参数说明：
- command: 要执行的命令
- timeout: 总超时时间（毫秒），默认 30000
- handleInput: 是否预期命令需要交互输入（如密码提示等），设为 true 时遇到输入提示后立即返回
- promptTimeout: 当 handleInput=true 时，流空闲多久后认为出现了输入提示（毫秒），默认 3000
- promptRegex: 当 handleInput=true 时，用于检测输入提示的正则表达式

返回结果包含：
- output: 当前已输出的内容
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
      toModelOutput: ({ output }) => toModelOutputStrippedAnsi(output),
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
          });

          yield {
            output: result.rawOutput,
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
      toModelOutput: ({ output }) => toModelOutputStrippedAnsi(output),
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
          output: result.rawOutput,
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
      toModelOutput: ({ output }) => toModelOutputStrippedAnsi(output),
      async *execute({ streamId, timeout = 15000, promptRegex }) {
        yield { output: '', closed: false, exitCode: null as number | null, streamId };

        const result = await collectExecOutput(streamId, {
          timeout,
          handleInput: !!promptRegex,
          promptTimeout: timeout,
          promptRegex,
        });

        yield {
          output: result.rawOutput,
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
      toModelOutput: ({ output }) => toModelOutputStrippedAnsi(output),
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
          output: result.rawOutput,
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
      toModelOutput: ({ output }) => toModelOutputStrippedAnsi(output),
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
          output: result.rawOutput,
          closed: result.closed,
          exitCode: result.exitCode,
          sent: true,
        };
      },
    }),

    "read-output": tool({
      description: `读取命令执行的完整输出文件。当 exec 工具输出过长被截断时使用（exec 会返回 outputId）。
支持两种模式：
- 按行号范围读取：指定 startLine 和/或 endLine
- 按关键词或正则搜索：指定 keyword 或 regex，返回所有匹配行及其行号。可用 contextBefore/contextAfter 指定匹配行的上下文行数

返回格式：紧凑的文本，连续5行以上只显示首尾行号。搜索结果自动排重。`,
      inputSchema: z.object({
        outputId: z.string().describe("exec 工具返回的 outputId"),
        startLine: z.number().optional().describe("起始行号（从 1 开始），不指定则从第 1 行开始"),
        endLine: z.number().optional().describe("结束行号，不指定则读到最后一行"),
        keyword: z.string().optional().describe("搜索关键词（大小写不敏感）"),
        regex: z.string().optional().describe("搜索正则表达式"),
        contextBefore: z.number().optional().describe("搜索模式下：每个匹配行前面的上下文行数，默认 0"),
        contextAfter: z.number().optional().describe("搜索模式下：每个匹配行后面的上下文行数，默认 0"),
      }),
      async *execute({ outputId, startLine, endLine, keyword, regex, contextBefore = 0, contextAfter = 0 }) {
        const filePath = path.join(execOutputDir, `${outputId}.log`);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          const totalLines = lines.length;

          let matchedLineNums: number[]; // 1-based

          if (keyword || regex) {
            let pattern: RegExp;
            try {
              pattern = regex ? new RegExp(regex) : new RegExp(keyword!, 'i');
            } catch (e) {
              yield { error: `正则表达式无效: ${e}`, totalLines };
              return;
            }
            matchedLineNums = lines
              .map((line, i) => ({ lineNum: i + 1, line }))
              .filter(({ line }) => pattern.test(line))
              .map(({ lineNum }) => lineNum);

            // Expand with context and deduplicate
            const lineNumSet = new Set<number>();
            for (const n of matchedLineNums) {
              const lo = Math.max(1, n - contextBefore);
              const hi = Math.min(totalLines, n + contextAfter);
              for (let i = lo; i <= hi; i++) lineNumSet.add(i);
            }
            matchedLineNums = Array.from(lineNumSet).sort((a, b) => a - b);
          } else {
            const start = Math.max(1, startLine ?? 1);
            const end = Math.min(totalLines, endLine ?? totalLines);
            matchedLineNums = [];
            for (let i = start; i <= end; i++) matchedLineNums.push(i);
          }

          // Format lines compactly: consecutive runs of 5+ lines show only first/last line number
          const formatted = formatLinesCompact(lines, matchedLineNums);

          yield { lines: formatted, totalLines, outputId };
        } catch {
          yield { error: `文件不存在或无法读取: exec-output/${outputId}.log`, outputId };
        }
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
- exec: 执行简单命令并获取完整输出。等待命令结束后返回 output 和 exitCode。
  - 仅用于不需要交互输入的命令
  - 如果输出过长，会自动截断并返回 outputId，可用 read-output 工具查看完整内容

- exec-stream: 执行需要交互输入的命令（如 sudo、ssh、交互式程序等）。
  - 设置 handleInput=true 和 promptRegex 来检测输入提示
  - 命令开始后会返回 output、closed、exitCode 和 streamId
  - 如果 streamId 存在（流未关闭），可以用后续工具继续操作

- send-input: 向打开的流发送文本输入（不要用于密码）
- wait-output: 继续等待流的输出
- send-password: 发送服务器保存的密码到流中（密码不会出现在对话中）
- request-user-input: 请求用户在界面中输入内容（如密码），内容不会暴露在 AI 上下文中
- close-stream: 关闭流
- read-output: 读取被截断的命令完整输出（按行号范围或关键词/正则搜索）

工作流程示例：
1. 普通命令：exec("ls -la") → 获取输出和 exitCode
2. sudo 命令（使用 -S 从 stdin 读取密码）：exec-stream("sudo -S apt update", handleInput=true, promptRegex="\\[sudo\\]|password") → 检测到密码提示 → send-password(streamId) → 获取输出
3. 需要用户输入密码：exec-stream(...) → 检测到提示 → request-user-input(streamId, "请输入密码", isPassword=true)
4. 输出过长：exec(...) 返回 outputId → read-output(outputId, keyword="error") 搜索错误信息

在运行命令之前，请先解释你要做什么。`;

  return new ToolLoopAgent({
    model,
    instructions,
    tools: createTools(ctx),
    stopWhen: [(p) => (p.steps?.length ?? 0) >= 20],
  });
}

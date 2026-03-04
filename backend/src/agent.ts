import { generateText, streamText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { sendInput, getScreenContent, runCommandAndWait } from "./terminal";
import { checkAutoApproval } from "./db";

const dashscope = createOpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || "",
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

export interface ApprovalRequest {
  id: string;
  command: string;
  sessionId: string;
  resolve: (approved: boolean) => void;
}

const pendingApprovals = new Map<string, ApprovalRequest>();

export function getPendingApprovals() {
  return Array.from(pendingApprovals.values()).map(({ id, command, sessionId }) => ({ id, command, sessionId }));
}

export function resolveApproval(id: string, approved: boolean) {
  const approval = pendingApprovals.get(id);
  if (approval) {
    pendingApprovals.delete(id);
    approval.resolve(approved);
  }
}

async function requestApproval(command: string, sessionId: string, serverId?: number): Promise<boolean> {
  if (checkAutoApproval(command, serverId)) return true;
  
  return new Promise((resolve) => {
    const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    pendingApprovals.set(id, { id, command, sessionId, resolve });
  });
}

export function createAgentTools(sessionId: string, serverId: number, onApprovalNeeded: (approval: { id: string; command: string }) => void) {
  return {
    run_command: tool({
      description: "Run a command in the terminal and get the output. Use this for standard commands that don't require interactive input.",
      parameters: z.object({
        command: z.string().describe("The command to run"),
        timeout: z.number().optional().describe("Timeout in milliseconds, default 30000"),
      }),
      execute: async ({ command, timeout }) => {
        const approved = await (async () => {
          if (checkAutoApproval(command, serverId)) return true;
          return new Promise<boolean>((resolve) => {
            const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            pendingApprovals.set(id, { id, command, sessionId, resolve });
            onApprovalNeeded({ id, command });
          });
        })();
        
        if (!approved) return { error: "Command was rejected by user" };
        
        try {
          const output = await runCommandAndWait(sessionId, command, timeout || 30000);
          return { output, success: true };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    send_input: tool({
      description: "Send input to the terminal (e.g. password for sudo or mysql, or commands in REPL mode). Use after run_command when the command is waiting for input.",
      parameters: z.object({
        input: z.string().describe("The input to send (e.g. password, command)"),
        press_enter: z.boolean().optional().describe("Whether to press enter after input, default true"),
      }),
      execute: async ({ input, press_enter = true }) => {
        sendInput(sessionId, input + (press_enter ? "\n" : ""));
        await new Promise(r => setTimeout(r, 1000));
        const screen = getScreenContent(sessionId);
        return { screen: screen.slice(-2000), sent: input };
      },
    }),

    get_screen: tool({
      description: "Get the current terminal screen content to see what is displayed.",
      parameters: z.object({}),
      execute: async () => {
        const content = getScreenContent(sessionId);
        return { content: content.slice(-3000) };
      },
    }),

    wait_for_output: tool({
      description: "Wait for a specific pattern to appear in the terminal output.",
      parameters: z.object({
        pattern: z.string().describe("String or regex pattern to wait for"),
        timeout: z.number().optional().describe("Timeout in milliseconds, default 15000"),
      }),
      execute: async ({ pattern, timeout = 15000 }) => {
        await new Promise(r => setTimeout(r, timeout / 2));
        const content = getScreenContent(sessionId);
        return { content: content.slice(-3000), matched: content.includes(pattern) };
      },
    }),
  };
}

import { createOpenAI } from "@ai-sdk/openai";

const client = createOpenAI({
  baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: process.env.DASHSCOPE_API_KEY || "",
});

export default function dashscope(modelId: string) {
  return client(modelId);
}

import { createOpenAI } from "@ai-sdk/openai";

const dashscope = createOpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY || "",
  baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

export default dashscope;

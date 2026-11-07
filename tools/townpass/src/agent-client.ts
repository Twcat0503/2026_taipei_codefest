/**
 * 瀏覽器版工具入口：讓 frontend/agent-mvp 的 AgentRunner 直接查資料，不需要另外架 server。
 * 格式依它的 ToolClient 契約。這個檔案和它的 import 不可依賴 Node API。
 */

import { z } from "zod";

import { TownPassClient } from "./adapters/client.js";
import { createServices } from "./services/index.js";
import { toPublicError } from "./shared/errors.js";
import { toolsFor, type ToolContext } from "./tools.js";

const DEFAULT_BASE_URL = "https://taipei-pass-service.vercel.app";

export interface AgentToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface AgentClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  /** 由呼叫端取得裝置位置；座標不經過模型。 */
  getLocation?: ToolContext["getLocation"];
  /** 是否提供示範站模擬資料的工具。預設 true 以相容既有測試；App 正式流程必須傳 false。 */
  includeDemo?: boolean;
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

const inputSchema = (input: z.ZodObject) => {
  const { $schema: _omitted, ...schema } = z.toJSONSchema(input, { io: "input" });
  return schema as Record<string, unknown>;
};

export function createAgentToolClient(options: AgentClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const services = createServices(
    new TownPassClient({ baseUrl, timeoutMs: options.timeoutMs ?? 30_000, fetchFn: options.fetchFn }),
  );
  const offered = toolsFor(options.includeDemo ?? true);
  const tools = offered.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: inputSchema(tool.input) }));

  return {
    async listTools({ signal }: { signal: AbortSignal }) {
      signal.throwIfAborted();
      return { tools };
    },

    async callTool(
      params: { name: string; arguments: Record<string, unknown> },
      { signal }: { signal: AbortSignal },
    ): Promise<AgentToolResult> {
      signal.throwIfAborted();
      const fail = (error: unknown): AgentToolResult => ({
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error }) }],
      });
      const tool = offered.find((item) => item.name === params.name);
      if (!tool) return fail({ code: "TOOL_NOT_FOUND", message: `沒有工具 ${params.name}` });
      const args = tool.input.safeParse(params.arguments);
      if (!args.success) return fail({ code: "INVALID_ARGUMENTS", message: `${params.name} 的參數不正確` });
      try {
        const result = await untilAborted(
          tool.run(args.data, { services, baseUrl, signal, getLocation: options.getLocation }),
          signal,
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        if (signal.aborted) throw err;
        return fail(toPublicError(err));
      }
    },
  };
}

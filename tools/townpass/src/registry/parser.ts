import { z } from "zod";
import { inspectService, type ServiceObservation } from "./inspect.js";
import { planWithSteps, type Ask } from "./steps.js";
import type { Binding, ServiceDefinition, ServiceParser } from "./types.js";

function checkReferences(service: ServiceDefinition) {
  for (const tool of service.tools) {
    // 與客戶端使用相同的 schema 編譯器，未定義的 $ref 不得等到執行時才發現。
    z.fromJSONSchema(tool.inputSchema);
    const names = new Set(Object.keys(tool.inputSchema.properties));
    const requireName = (name: string) => {
      if (!names.has(name)) throw new Error(`工具 ${tool.name} 引用了未宣告參數：${name}`);
    };
    for (const name of tool.inputSchema.required ?? []) requireName(name);
    const execution = tool.execution;
    let bindings: Binding[];
    if (execution.kind === "browser") {
      bindings = execution.steps.flatMap(step => step.value ? [step.value] : []);
    } else {
      bindings = [execution.query, execution.headers, execution.body].flatMap(fields => Object.values(fields ?? {}));
      for (const match of execution.url.matchAll(/\{([^{}]+)\}/g)) requireName(match[1]!);
    }
    for (const binding of bindings) if ("argument" in binding) requireName(binding.argument);
  }
}

export function createServiceParser(options: {
  endpoint: string;
  model: string;
  inspect?: (url: string) => Promise<ServiceObservation>;
  fetchFn?: typeof fetch;
}): ServiceParser {
  const inspect = options.inspect ?? inspectService;
  const fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
  return async (url) => {
    const observation = await inspect(url);
    // 每個步驟各自一次模型呼叫，依序執行；任一步失敗即停止，不重試。
    const ask: Ask = async (step) => {
      const response = await fetchFn(`${options.endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 模型服務若卡住，同網址的解析請求會一起等待；設定上限後失敗即回報。
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: { name: step.task, schema: z.toJSONSchema(step.schema) },
          },
          messages: [
            { role: "system", content: step.instructions },
            { role: "user", content: JSON.stringify(step.input) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`解析模型回應 HTTP ${response.status}`);
      const result = await response.json() as { choices: { message: { content: string } }[] };
      return JSON.parse(result.choices[0]!.message.content);
    };
    const service = await planWithSteps(observation, ask);
    checkReferences(service);
    return { ...service, url };
  };
}

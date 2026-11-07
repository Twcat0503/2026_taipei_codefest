import { z } from "zod";
import { openApiDocumentSchema, type ServiceObservation } from "./inspect.js";
import type { Binding, BrowserExecution, ServiceDefinition, ServiceTool } from "./types.js";

/**
 * 生成契約：模型只選擇觀測到的輸入控制項、送出控制項、結果區或 API 操作，並命名工具。
 * 步驟、參數型別與 HTTP 綁定由程式依固定規則組出；模型不能直接寫 execution。
 */

type Element = {
  selector: string;
  tag: string;
  type?: string | null;
  role?: string | null;
  label?: string | null;
  required?: boolean;
  options?: { value: string; label: string }[];
};

export type ServicePlan = {
  /** 送給解析模型的輸出格式（JSON Schema 由此產生）。 */
  schema: z.ZodType;
  /** 解析模型的輸出經 schema 驗證後，組出工具定義。 */
  assemble: (output: unknown) => ServiceDefinition;
};

// 工具名稱與參數名稱會被對話模型當成函式與參數鍵使用，因此限制為識別字；
// 限制寫在 schema 中，解析模型的輸出在生成時就受約束。
const toolName = z.string().regex(/^[a-z][a-z0-9_]*$/).max(60);
const parameterName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(40);

const nonFillableInputs = ["hidden", "file", "checkbox", "radio", "button", "submit", "reset", "image"];
const submitInputs = ["button", "submit", "reset", "image"];

function isInputControl(element: Element) {
  if (element.tag === "select" || element.tag === "textarea") return true;
  return element.tag === "input" && (element.type === "checkbox" || !nonFillableInputs.includes(element.type ?? "text"));
}

function isSubmitControl(element: Element) {
  return element.tag === "button" || element.tag === "a" || element.role === "button" ||
    (element.tag === "input" && submitInputs.includes(element.type ?? ""));
}

function controlSpec(element: Element): { action: "fill" | "select" | "check"; schema: Record<string, unknown> } {
  if (element.tag === "select") {
    return { action: "select", schema: { type: "string", enum: (element.options ?? []).map(option => option.value) } };
  }
  if (element.tag === "textarea") return { action: "fill", schema: { type: "string" } };
  switch (element.type) {
    case "checkbox": return { action: "check", schema: { type: "boolean" } };
    case "number":
    case "range": return { action: "fill", schema: { type: "number" } };
    case "date": return { action: "fill", schema: { type: "string", format: "date" } };
    case "time": return { action: "fill", schema: { type: "string", format: "time" } };
    case "email": return { action: "fill", schema: { type: "string", format: "email" } };
    case "url": return { action: "fill", schema: { type: "string", format: "uri" } };
    default: return { action: "fill", schema: { type: "string" } };
  }
}

type PageOutput = {
  tools: {
    name: string;
    description: string;
    /** 觀測到的輸入控制項選擇器 → 參數名稱；未列出者不是參數。 */
    controls: Record<string, string | undefined>;
    submit: string;
    resultSelector: string;
  }[];
};

function pagePlan(observation: ServiceObservation): ServicePlan {
  const elements = observation.elements as Element[];
  const controls = elements.filter(isInputControl).map(element => element.selector);
  const submits = elements.filter(isSubmitControl).map(element => element.selector);
  if (!controls.length || !submits.length) throw new Error("沒有觀測到可填寫的輸入與送出控制項");
  const schema = z.object({
    tools: z.array(z.object({
      name: toolName,
      description: z.string().min(1),
      // 以選擇器為鍵：JSON 物件中每個控制項最多出現一次，未知的選擇器直接拒絕。
      controls: z.strictObject(Object.fromEntries(controls.map(selector => [selector, parameterName.optional()]))),
      submit: z.enum(submits),
      resultSelector: z.enum(elements.map(element => element.selector)),
    })).length(1),
  });
  return { schema, assemble: output => assemblePage(observation, schema.parse(output) as PageOutput) };
}

function assemblePage(observation: ServiceObservation, plan: PageOutput): ServiceDefinition {
  const elements = observation.elements as Element[];
  const position = new Map(elements.map((element, index) => [element.selector, index]));
  const byselector = new Map(elements.map(element => [element.selector, element]));
  return {
    url: String(observation.url),
    title: String(observation.title ?? ""),
    tools: uniqueTools(plan.tools.map(tool => {
      // 步驟依觀測到的頁面順序排列，與模型列出的順序無關；描述取自觀測到的標籤。
      const chosen = Object.entries(tool.controls)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .sort(([a], [b]) => position.get(a)! - position.get(b)!);
      if (!chosen.length) throw new Error(`工具 ${tool.name} 至少需要一個輸入控制項`);
      const properties = new Map<string, Record<string, unknown>>();
      const required: string[] = [];
      const steps: BrowserExecution["steps"] = [];
      for (const [selector, parameter] of chosen) {
        const element = byselector.get(selector)!;
        if (properties.has(parameter)) throw new Error(`參數名稱重複：${parameter}`);
        const { action, schema } = controlSpec(element);
        properties.set(parameter, element.label ? { ...schema, description: element.label } : schema);
        if (element.required) required.push(parameter);
        steps.push({ action, selector, value: { argument: parameter } });
      }
      steps.push({ action: "click", selector: tool.submit });
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: { type: "object", properties: Object.fromEntries(properties), required },
        execution: { kind: "browser", url: String(observation.url), steps, resultSelector: tool.resultSelector },
      };
    })),
  };
}

const parameterSchema = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  style: z.string().optional(),
  explode: z.boolean().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
});
const serverListSchema = z.array(z.object({ url: z.string() }));
const pathItemSchema = z.object({ servers: serverListSchema.optional(), parameters: z.array(parameterSchema).optional() });
const operationSchema = z.object({
  servers: serverListSchema.optional(),
  parameters: z.array(parameterSchema).optional(),
  requestBody: z.object({
    content: z.record(z.string(), z.object({ schema: z.record(z.string(), z.unknown()).optional() })).optional(),
  }).optional(),
});
type Parameter = z.infer<typeof parameterSchema>;
type PathItem = z.infer<typeof pathItemSchema>;
type Operation = z.infer<typeof operationSchema>;
type Method = "get" | "post" | "put" | "patch" | "delete";
const methods: Method[] = ["get", "post", "put", "patch", "delete"];

type HttpExecution = Extract<ServiceTool["execution"], { kind: "http" }>;
type ApiOperation = { inputSchema: ServiceTool["inputSchema"]; execution: HttpExecution };

const primitiveTypes = ["string", "number", "integer", "boolean"];
const formats = ["date", "date-time", "time", "email", "uri"];

/** 只接受基本型別；物件、陣列與 $ref 不在支援範圍內，回傳 undefined。 */
function primitive(schema: Record<string, unknown> | undefined, description?: string) {
  if (!schema || typeof schema.type !== "string" || !primitiveTypes.includes(schema.type)) return undefined;
  const result: Record<string, unknown> = { type: schema.type };
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.every(value => ["string", "number", "boolean"].includes(typeof value))) {
      return undefined;
    }
    result.enum = schema.enum;
  }
  if (typeof schema.format === "string" && formats.includes(schema.format)) result.format = schema.format;
  const text = description ?? (typeof schema.description === "string" ? schema.description : undefined);
  if (text) result.description = text;
  return result;
}

/** 回傳原因字串表示不支援；否則回傳每個 server 對應的一個操作（鍵為「METHOD URL」）。 */
function buildOperation(
  method: Method,
  path: string,
  pathItem: PathItem,
  operation: Operation,
  observation: ServiceObservation,
  document: z.infer<typeof openApiDocumentSchema>,
): string | [string, ApiOperation][] {
  const reasons: string[] = [];
  const parameters = new Map<string, Parameter>();
  for (const parameter of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    parameters.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  const names = new Set<string>();
  const claim = (name: string) => {
    if (names.has(name)) reasons.push(`參數名稱重複：${name}`);
    names.add(name);
  };
  const inputProperties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  const query: Record<string, Binding> = {};
  for (const parameter of parameters.values()) {
    if (parameter.in !== "path" && parameter.in !== "query") {
      reasons.push(`不支援 ${parameter.in} 參數 ${parameter.name}`);
      continue;
    }
    if (parameter.in === "query" && ((parameter.style ?? "form") !== "form" || (parameter.explode ?? true) !== true)) {
      reasons.push(`不支援 query 參數 ${parameter.name} 的序列化`);
      continue;
    }
    const schema = primitive(parameter.schema, parameter.description);
    if (!schema) {
      reasons.push(`參數 ${parameter.name} 不是基本型別`);
      continue;
    }
    claim(parameter.name);
    inputProperties[parameter.name] = schema;
    if (parameter.in === "path" || parameter.required === true) required.push(parameter.name);
    if (parameter.in === "query") query[parameter.name] = { argument: parameter.name };
  }
  let body: Record<string, Binding> | undefined;
  if (operation.requestBody) {
    const json = operation.requestBody.content?.["application/json"]?.schema;
    const bodyProperties = json?.properties as Record<string, Record<string, unknown>> | undefined;
    if (method === "get" || method === "delete") {
      reasons.push(`${method.toUpperCase()} 不支援請求 body`);
    } else if (json?.type !== "object" || !bodyProperties) {
      reasons.push("JSON 請求 body 必須是含屬性的物件");
    } else {
      body = {};
      const bodyRequired = Array.isArray(json.required) ? json.required as string[] : [];
      for (const [name, propertySchema] of Object.entries(bodyProperties)) {
        const schema = primitive(propertySchema);
        if (!schema) {
          reasons.push(`請求 body 欄位 ${name} 不是基本型別`);
          continue;
        }
        claim(name);
        inputProperties[name] = schema;
        if (bodyRequired.includes(name)) required.push(name);
        body[name] = { argument: name };
      }
    }
  }
  if (reasons.length) return reasons.join("、");
  const inputSchema: ServiceTool["inputSchema"] = { type: "object", properties: inputProperties, required };
  const servers = [operation.servers, pathItem.servers, document.servers].find(list => list?.length) ?? [{ url: "/" }];
  const httpMethod = method.toUpperCase() as HttpExecution["method"];
  return servers.map(server => {
    // OpenAPI path 附加在 server 前綴後；不可用 new URL(path, base) 丟掉前綴或編碼 placeholders。
    const base = new URL(server.url, String(observation.url)).href.replace(/\/$/, "");
    const url = `${base}${path}`;
    const execution: HttpExecution = {
      kind: "http",
      url,
      method: httpMethod,
      ...(Object.keys(query).length ? { query } : {}),
      ...(body ? { body, encoding: "json" as const } : {}),
    };
    return [`${httpMethod} ${url}`, { inputSchema, execution }];
  });
}

function apiPlan(observation: ServiceObservation): ServicePlan {
  const document = openApiDocumentSchema.parse(observation.document);
  const operations = new Map<string, ApiOperation>();
  const skipped: string[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith("/")) continue;
    const pathItem = pathItemSchema.safeParse(item);
    for (const method of methods) {
      if (item[method] === undefined) continue;
      const label = `${method.toUpperCase()} ${path}`;
      const operation = operationSchema.safeParse(item[method]);
      if (!pathItem.success || !operation.success) {
        skipped.push(`${label}：結構不支援`);
        continue;
      }
      const built = buildOperation(method, path, pathItem.data, operation.data, observation, document);
      if (typeof built === "string") {
        skipped.push(`${label}：${built}`);
        continue;
      }
      for (const [key, value] of built) if (!operations.has(key)) operations.set(key, value);
    }
  }
  const keys = [...operations.keys()];
  if (!keys.length) {
    throw new Error(`沒有可提供的 OpenAPI 操作${skipped.length ? `：${skipped.join("；")}` : ""}`);
  }
  const schema = z.object({
    tools: z.array(z.object({
      name: toolName,
      description: z.string().min(1),
      operation: z.enum(keys),
    })).min(1),
  });
  const info = (observation.document as { info?: { title?: unknown } }).info;
  const title = typeof info?.title === "string" ? info.title : String(observation.url);
  return {
    schema,
    assemble: output => {
      const plan = schema.parse(output);
      return {
        url: String(observation.url),
        title,
        tools: uniqueTools(plan.tools.map(tool => {
          const operation = operations.get(tool.operation)!;
          return { name: tool.name, description: tool.description, inputSchema: operation.inputSchema, execution: operation.execution };
        })),
      };
    },
  };
}

function uniqueTools(tools: ServiceTool[]) {
  const names = tools.map(tool => tool.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) throw new Error(`工具名稱重複：${duplicate}`);
  return tools;
}

/** 依觀測來源建立生成計畫；來源不同，可選擇的內容也不同。 */
export function planService(observation: ServiceObservation): ServicePlan {
  return observation.kind === "openapi" ? apiPlan(observation) : pagePlan(observation);
}

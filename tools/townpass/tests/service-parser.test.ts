import { describe, expect, it } from "vitest";
import { createServiceParser } from "../src/registry/parser.js";
import type { ServiceObservation } from "../src/registry/inspect.js";

const url = "https://rooms.example/search";
const observation: ServiceObservation = {
  kind: "page", url, title: "場地查詢", text: "請選日期後查詢",
  elements: [
    { selector: "#date", tag: "input", type: "date", label: "日期", required: true },
    { selector: "#search", tag: "button", type: "submit", text: "查詢" },
    { selector: "#results", tag: "output", text: "" },
  ],
};
const plan = {
  tools: [{
    name: "search_rooms",
    description: "依日期查詢場地",
    controls: { "#date": "date" },
    submit: "#search",
    resultSelector: "#results",
  }],
};

const applicationUrl = "http://127.0.0.1:5173/test-service/applications";
const applicationApi: ServiceObservation = {
  kind: "openapi", url: applicationUrl,
  document: {
    openapi: "3.1.0",
    info: { title: "測試申請 API", version: "1.0" },
    servers: [{ url: "http://127.0.0.1:5173" }],
    paths: { "/test-data/applications": { post: {
      requestBody: { required: true, content: { "application/json": { schema: {
        type: "object",
        properties: {
          district: { type: "string", enum: ["north", "south"] },
          count: { type: "integer" },
          stepFree: { type: "boolean" },
        },
        required: ["district", "count", "stepFree"],
      } } } },
      responses: { "200": { description: "受理" } },
    } } },
  },
};

function reply(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

/** 記錄送給解析模型的請求，並回傳指定的模型輸出。 */
function makeParser(observed: ServiceObservation, body: unknown, status = 200) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const parse = createServiceParser({
    endpoint: "http://127.0.0.1:8080/v1",
    model: "local-parser",
    inspect: async () => observed,
    fetchFn,
  });
  return { parse, requests };
}

describe("本機服務解析：模型只提供計畫，工具由程式組出", () => {
  it("頁面：模型提供控制項、送出與結果，步驟與參數型別由程式組出", async () => {
    const { parse, requests } = makeParser(observation, reply(plan));
    const service = await parse(url);
    expect(service).toEqual({
      url,
      title: "場地查詢",
      tools: [{
        name: "search_rooms",
        description: "依日期查詢場地",
        inputSchema: {
          type: "object",
          properties: { date: { type: "string", format: "date", description: "日期" } },
          required: ["date"],
        },
        execution: {
          kind: "browser",
          url,
          steps: [
            { action: "fill", selector: "#date", value: { argument: "date" } },
            { action: "click", selector: "#search" },
          ],
          resultSelector: "#results",
        },
      }],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("http://127.0.0.1:8080/v1/chat/completions");
    expect(requests[0]!.body).toMatchObject({
      model: "local-parser",
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "tool_plan" } },
    });
    expect((requests[0]!.body.messages as { content: string }[])[1]).toEqual({
      role: "user", content: JSON.stringify(observation),
    });
  });

  it.each([
    { name: "把按鈕當成輸入控制項", tool: { ...plan.tools[0], controls: { "#search": "x" } } },
    { name: "列出沒有被觀測到的控制項", tool: { ...plan.tools[0], controls: { "#missing": "x" } } },
    { name: "把輸入欄位當成送出按鈕", tool: { ...plan.tools[0], submit: "#date" } },
    { name: "指定沒有被觀測到的結果區", tool: { ...plan.tools[0], resultSelector: "#missing" } },
  ])("$name 時拒絕，不保存結果", async ({ tool }) => {
    const { parse } = makeParser(observation, reply({ tools: [tool] }));
    await expect(parse(url)).rejects.toThrow();
  });

  it("模型直接提供的 execution 會被忽略，工具仍由程式組出", async () => {
    const withExecution = { tools: [{
      ...plan.tools[0], execution: { kind: "http", url: "https://evil.example", method: "DELETE" },
    }] };
    const { parse } = makeParser(observation, reply(withExecution));
    const service = await parse(url);
    expect(service.tools[0]!.execution).toMatchObject({ kind: "browser", url });
  });

  it("沒有可填寫的控制項時，不呼叫模型，直接說明原因", async () => {
    const buttonOnly = { ...observation, elements: [{ selector: "#search", tag: "button", type: "submit", text: "查詢" }] };
    const { parse, requests } = makeParser(buttonOnly, reply(plan));
    await expect(parse(url)).rejects.toThrow(/沒有觀測到可填寫的輸入與送出控制項/);
    expect(requests).toHaveLength(0);
  });

  it("解析模型回應錯誤時回報 HTTP 狀態，不產生工具", async () => {
    const { parse } = makeParser(observation, { error: "busy" }, 503);
    await expect(parse(url)).rejects.toThrow(/HTTP 503/);
  });

  it("API 文件：模型只能選擇文件中的操作，body 欄位由程式綁定到同名參數", async () => {
    const key = "POST http://127.0.0.1:5173/test-data/applications";
    const { parse, requests } = makeParser(applicationApi, reply({
      operations: { [key]: { name: "submit_test_application", description: "送出測試申請" } },
    }));
    const service = await parse(applicationUrl);
    expect(service).toEqual({
      url: applicationUrl,
      title: "測試申請 API",
      tools: [{
        name: "submit_test_application",
        description: "送出測試申請",
        inputSchema: {
          type: "object",
          properties: {
            district: { type: "string", enum: ["north", "south"] },
            count: { type: "integer" },
            stepFree: { type: "boolean" },
          },
          required: ["district", "count", "stepFree"],
        },
        execution: {
          kind: "http",
          url: "http://127.0.0.1:5173/test-data/applications",
          method: "POST",
          body: { district: { argument: "district" }, count: { argument: "count" }, stepFree: { argument: "stepFree" } },
          encoding: "json",
        },
      }],
    });
    expect(JSON.stringify(requests[0]!.body.response_format)).toContain(key);
  });

  it("API 文件：模型選擇未列出的操作時拒絕", async () => {
    const { parse } = makeParser(applicationApi, reply({
      operations: { "DELETE http://127.0.0.1:5173/test-data/applications": { name: "remove_all", description: "刪除" } },
    }));
    await expect(parse(applicationUrl)).rejects.toThrow();
  });
});

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

// 每個步驟的模型回答，依步驟的 task 欄位對應。
const pageAnswers: Record<string, unknown> = {
  control: { thought: "The date input is where the user picks a day.", parameter: "date" },
  submit: { thought: "The search button starts the search.", submit: "#search" },
  result: { thought: "The output element shows results.", resultSelector: "#results" },
  tool: { thought: "The tool searches rooms on a date.", name: "search_rooms", description: "依日期查詢場地" },
};

const applicationUrl = "http://127.0.0.1:5173/test-service/applications";
const applicationKey = "POST http://127.0.0.1:5173/test-data/applications";
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
const applicationAnswers: Record<string, unknown> = {
  operation: { thought: "Submitting an application is a user action.", include: true, name: "submit_test_application", description: "送出測試申請" },
};

type Body = {
  model: string;
  temperature: number;
  response_format: { type: string; json_schema: { name: string; schema: unknown } };
  messages: { role: string; content: string }[];
};

/** 依步驟的 task 回傳指定的模型輸出，並記錄每次送出的請求（依送出順序）。 */
function makeParser(observed: ServiceObservation, answers: Record<string, unknown>, status = 200) {
  const requests: { url: string; body: Body; task: string }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    const task = (JSON.parse(body.messages[1]!.content) as { task: string }).task;
    requests.push({ url: String(input), body, task });
    const content = JSON.stringify(answers[task]);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const parse = createServiceParser({
    endpoint: "http://127.0.0.1:8080/v1",
    model: "local-parser",
    inspect: async () => observed,
    fetchFn,
  });
  return { parse, requests };
}

describe("本機服務解析：模型逐步回答小問題，工具由程式組出", () => {
  it("頁面：控制項、送出、結果、工具名稱各一次呼叫，依序送出，工具由程式組出", async () => {
    const { parse, requests } = makeParser(observation, pageAnswers);
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
    expect(requests.map(request => request.task)).toEqual(["control", "submit", "result", "tool"]);
    for (const request of requests) {
      expect(request.url).toBe("http://127.0.0.1:8080/v1/chat/completions");
      expect(request.body).toMatchObject({
        model: "local-parser",
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: request.task } },
      });
    }
  });

  it("控制項步驟只看到該控制項，不看到送出按鈕", async () => {
    const { parse, requests } = makeParser(observation, pageAnswers);
    await parse(url);
    expect(requests[0]!.body.messages[1]!.content).toContain("#date");
    expect(requests[0]!.body.messages[1]!.content).not.toContain("#search");
  });

  it.each([
    { name: "參數名稱含空白", answers: { control: { thought: "ok", parameter: "date value" } }, sent: ["control"] },
    { name: "thought 含中文", answers: { control: { thought: "選擇日期", parameter: "date" } }, sent: ["control"] },
    { name: "把輸入欄位當成送出按鈕", answers: { submit: { thought: "ok", submit: "#date" } }, sent: ["control", "submit"] },
    { name: "指定沒有被觀測到的結果區", answers: { result: { thought: "ok", resultSelector: "#missing" } }, sent: ["control", "submit", "result"] },
  ])("$name 時拒絕，且不再送出後續步驟", async ({ answers, sent }) => {
    const { parse, requests } = makeParser(observation, { ...pageAnswers, ...answers });
    await expect(parse(url)).rejects.toThrow();
    expect(requests.map(request => request.task)).toEqual(sent);
  });

  it("模型直接提供的 execution 會被忽略，工具仍由程式組出", async () => {
    const tool = { ...(pageAnswers.tool as object), execution: { kind: "http", url: "https://evil.example", method: "DELETE" } };
    const { parse } = makeParser(observation, { ...pageAnswers, tool });
    const service = await parse(url);
    expect(service.tools[0]!.execution).toMatchObject({ kind: "browser", url });
  });

  it("沒有可填寫的控制項時，不呼叫模型，直接說明原因", async () => {
    const buttonOnly = { ...observation, elements: [{ selector: "#search", tag: "button", type: "submit", text: "查詢" }] };
    const { parse, requests } = makeParser(buttonOnly, pageAnswers);
    await expect(parse(url)).rejects.toThrow(/沒有觀測到可填寫的輸入與送出控制項/);
    expect(requests).toHaveLength(0);
  });

  it("解析模型回應錯誤時回報 HTTP 狀態，不再送出後續步驟", async () => {
    const { parse, requests } = makeParser(observation, {}, 503);
    await expect(parse(url)).rejects.toThrow(/HTTP 503/);
    expect(requests.map(request => request.task)).toEqual(["control"]);
  });

  it("API 文件：每個操作各自一次呼叫，body 欄位由程式綁定到同名參數", async () => {
    const { parse, requests } = makeParser(applicationApi, applicationAnswers);
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
    expect(requests.map(request => request.task)).toEqual(["operation"]);
    expect(requests[0]!.body.messages[1]!.content).toContain(applicationKey);
  });

  it("API 文件：include 為假的操作不提供，全部不提供時拒絕", async () => {
    const { parse } = makeParser(applicationApi, {
      operation: { thought: "Not needed.", include: false, name: "submit_test_application", description: "送出測試申請" },
    });
    await expect(parse(applicationUrl)).rejects.toThrow(/沒有選擇任何 OpenAPI 操作/);
  });
});

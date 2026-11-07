import { describe, expect, it } from "vitest";
import { z } from "zod";
import { planService } from "../src/registry/plan.js";
import type { ServiceObservation } from "../src/registry/inspect.js";

const courseUrl = "https://courses.example/search";
const courses: ServiceObservation = {
  kind: "page", url: courseUrl, title: "課程查詢", text: "依地區與人數查詢",
  elements: [
    { selector: "#count", tag: "input", type: "number", label: "參加人數", required: true },
    { selector: "#district", tag: "select", type: null, label: "地區", required: true, options: [
      { value: "north", label: "北區" }, { value: "south", label: "南區" },
    ] },
    { selector: "#step-free", tag: "input", type: "checkbox", label: "只顯示無階梯場地", required: false },
    { selector: "#find-courses", tag: "button", type: "submit", text: "查詢課程" },
    { selector: "#courses-result", tag: "output", text: "" },
  ],
};

const coursePlan = {
  tools: [{
    name: "search_courses",
    description: "依地區與人數查詢課程",
    controls: { "#district": "district", "#count": "count", "#step-free": "stepFree" },
    submit: "#find-courses",
    resultSelector: "#courses-result",
  }],
};

const applicationUrl = "http://127.0.0.1:5173/test-service/applications";
const applicationApi: ServiceObservation = {
  kind: "openapi", url: applicationUrl,
  document: {
    openapi: "3.1.0",
    info: { title: "測試申請 API", version: "1.0" },
    servers: [{ url: "http://127.0.0.1:5173" }],
    paths: {
      "/test-data/applications": {
        post: {
          operationId: "submit_test_application",
          requestBody: {
            required: true,
            content: { "application/json": { schema: {
              type: "object",
              properties: {
                district: { type: "string", enum: ["north", "south"] },
                count: { type: "integer" },
                stepFree: { type: "boolean" },
              },
              required: ["district", "count", "stepFree"],
            } } },
          },
          responses: { "200": { description: "受理" } },
        },
      },
    },
  },
};

describe("頁面計畫：模型只選擇觀測到的控制項", () => {
  it("依觀測順序組出步驟，送出按鈕最後，描述取自觀測到的標籤", () => {
    const service = planService(courses).assemble(coursePlan);
    expect(service).toEqual({
      url: courseUrl,
      title: "課程查詢",
      tools: [{
        name: "search_courses",
        description: "依地區與人數查詢課程",
        inputSchema: {
          type: "object",
          properties: {
            count: { type: "number", description: "參加人數" },
            district: { type: "string", enum: ["north", "south"], description: "地區" },
            stepFree: { type: "boolean", description: "只顯示無階梯場地" },
          },
          required: ["count", "district"],
        },
        execution: {
          kind: "browser",
          url: courseUrl,
          steps: [
            { action: "fill", selector: "#count", value: { argument: "count" } },
            { action: "select", selector: "#district", value: { argument: "district" } },
            { action: "check", selector: "#step-free", value: { argument: "stepFree" } },
            { action: "click", selector: "#find-courses" },
          ],
          resultSelector: "#courses-result",
        },
      }],
    });
  });

  it("每個觀測到的輸入控制項都必須有參數名稱，缺漏時拒絕", () => {
    const { schema } = planService(courses);
    expect(schema.safeParse({ tools: [{ ...coursePlan.tools[0], controls: { "#count": "count" } }] }).success).toBe(false);
    expect(schema.safeParse({ tools: [{ ...coursePlan.tools[0], controls: {} }] }).success).toBe(false);
  });

  it("按鈕、結果區與選項值不能成為輸入控制項", () => {
    const { schema } = planService(courses);
    for (const selector of ["#find-courses", "#courses-result"]) {
      expect(schema.safeParse({ tools: [{ ...coursePlan.tools[0], controls: { [selector]: "x" } }] }).success).toBe(false);
    }
    expect(schema.safeParse({ tools: [{ ...coursePlan.tools[0], controls: { north: "x" } }] }).success).toBe(false);
  });

  it("送出控制項必須是觀測到的按鈕或連結", () => {
    const { schema } = planService(courses);
    expect(schema.safeParse({ tools: [{ ...coursePlan.tools[0], submit: "#count" }] }).success).toBe(false);
    expect(schema.safeParse({ tools: [{ ...coursePlan.tools[0], submit: "#find-courses" }] }).success).toBe(true);
  });

  it("頁面計畫只能有一個工具", () => {
    const { schema } = planService(courses);
    expect(schema.safeParse({ tools: [coursePlan.tools[0], { ...coursePlan.tools[0], name: "other" }] }).success).toBe(false);
  });

  it("工具名稱與參數名稱必須是識別字，不接受空白、括號或連字號", () => {
    const { schema } = planService(courses);
    expect(schema.safeParse({ tools: [{ ...coursePlan.tools[0], name: "find-courses" }] }).success).toBe(false);
    expect(schema.safeParse({ tools: [{ ...coursePlan.tools[0], controls: { "#count": "count value" } }] }).success).toBe(false);
    expect(schema.safeParse({ tools: [{ ...coursePlan.tools[0], controls: { "#count": "count (input)" } }] }).success).toBe(false);
    expect(schema.safeParse({ tools: [coursePlan.tools[0]] }).success).toBe(true);
  });

  it("時間欄位的值是 HH:MM（HTML 格式），接受 14:30，拒絕其他字串", () => {
    const observed: ServiceObservation = { kind: "page", url: courseUrl, title: "預約", elements: [
      { selector: "#start", tag: "input", type: "time", label: "開始時間", required: true },
      { selector: "#book", tag: "button", type: "submit", text: "預約" },
      { selector: "#booked", tag: "output", text: "" },
    ] };
    const service = planService(observed).assemble({ tools: [{
      name: "book_slot", description: "預約時段", controls: { "#start": "start" }, submit: "#book", resultSelector: "#booked",
    }] });
    const validate = z.fromJSONSchema(service.tools[0]!.inputSchema);
    expect(validate.safeParse({ start: "14:30" }).success).toBe(true);
    expect(validate.safeParse({ start: "2pm" }).success).toBe(false);
  });

  it("沒有可填寫的輸入控制項時，不呼叫模型，直接說明原因", () => {
    const buttonOnly: ServiceObservation = { kind: "page", url: courseUrl, title: "按鈕", elements: [
      { selector: "#go", tag: "button", type: "submit", text: "前往" },
    ] };
    expect(() => planService(buttonOnly)).toThrow(/沒有觀測到可填寫的輸入與送出控制項/);
  });

  it("自訂 role=button 可以作為送出控制項，radio 不列入輸入或送出", () => {
    const observed: ServiceObservation = { kind: "page", url: courseUrl, title: "自訂", elements: [
      { selector: "#date", tag: "input", type: "date", label: "日期", required: true },
      { selector: "#next", tag: "div", role: "button", text: "下一頁" },
      { selector: "#choice", tag: "input", type: "radio", label: "選項" },
      { selector: "#results", tag: "output", text: "" },
    ] };
    const { schema } = planService(observed);
    const plan = (controls: Record<string, string>, submit: string) => schema.safeParse({ tools: [{
      name: "search", description: "查詢", controls, submit, resultSelector: "#results",
    }] }).success;
    expect(plan({ "#date": "date" }, "#next")).toBe(true);
    expect(plan({ "#choice": "choice" }, "#next")).toBe(false);
    expect(plan({ "#date": "date" }, "#choice")).toBe(false);
  });

  it("同一參數名稱用在兩個控制項時拒絕", () => {
    const { assemble } = planService(courses);
    const duplicateParameter = { tools: [{ ...coursePlan.tools[0], controls: { "#count": "value", "#district": "value", "#step-free": "stepFree" } }] };
    expect(() => assemble(duplicateParameter)).toThrow(/參數名稱重複/);
  });

  it("模型提供的 execution 被忽略，步驟仍由程式依固定規則組出", () => {
    const withExecution = { tools: [{ ...coursePlan.tools[0], execution: { kind: "http", url: "https://x.example", method: "DELETE" } }] };
    const service = planService(courses).assemble(withExecution);
    expect(service.tools[0]!.execution).toMatchObject({ kind: "browser", url: courseUrl });
  });
});

describe("API 計畫：模型只選擇文件中的操作", () => {
  const key = "POST http://127.0.0.1:5173/test-data/applications";

  it("兩個不同操作使用相同工具名稱時拒絕", () => {
    const twoOperations: ServiceObservation = { kind: "openapi", url: "https://rooms.example/search", document: {
      openapi: "3.1.0", servers: [{ url: "https://rooms.example" }],
      paths: {
        "/a": { get: { responses: { "200": { description: "結果" } } } },
        "/b": { post: { responses: { "200": { description: "結果" } } } },
      },
    } };
    const { assemble } = planService(twoOperations);
    expect(() => assemble({ operations: {
      "GET https://rooms.example/a": { name: "same_name", description: "甲" },
      "POST https://rooms.example/b": { name: "same_name", description: "乙" },
    } })).toThrow(/工具名稱重複/);
  });

  it("沒有選擇任何操作時拒絕", () => {
    const { assemble } = planService(applicationApi);
    expect(() => assemble({ operations: {} })).toThrow(/沒有選擇任何 OpenAPI 操作/);
  });

  it("JSON body 欄位綁定到同名參數，OpenAPI 結構字不成為欄位", () => {
    const { schema, assemble } = planService(applicationApi);
    expect(schema.safeParse({ operations: { [key]: { name: "submit_test_application", description: "送出申請" } } }).success).toBe(true);
    const service = assemble({ operations: { [key]: { name: "submit_test_application", description: "送出申請" } } });
    expect(service).toEqual({
      url: applicationUrl,
      title: "測試申請 API",
      tools: [{
        name: "submit_test_application",
        description: "送出申請",
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
  });

  it("path 參數保留在 URL 中，query 參數綁定到同名參數，只有必要者列為 required", () => {
    const observed: ServiceObservation = { kind: "openapi", url: "https://rooms.example/search", document: {
      openapi: "3.1.0", servers: [{ url: "https://rooms.example" }],
      paths: { "/rooms/{id}": { get: {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "結果" } },
      } } },
    } };
    const operation = "GET https://rooms.example/rooms/{id}";
    const service = planService(observed).assemble({ operations: { [operation]: { name: "find_room", description: "查詢場地" } } });
    expect(service.tools[0]).toEqual({
      name: "find_room",
      description: "查詢場地",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, search: { type: "string" } },
        required: ["id"],
      },
      execution: { kind: "http", url: "https://rooms.example/rooms/{id}", method: "GET", query: { search: { argument: "search" } } },
    });
  });

  it.each([
    { servers: [{ url: "https://api.example/v1/" }], pathServers: undefined, endpoint: "https://api.example/v1/rooms/{id}" },
    { servers: [{ url: "./api/v1" }], pathServers: undefined, endpoint: "https://rooms.example/api/v1/rooms/{id}" },
    { servers: [{ url: "https://api.example/v1" }], pathServers: [{ url: "/v2" }], endpoint: "https://rooms.example/v2/rooms/{id}" },
  ])("保留 documented server 前綴：$endpoint", ({ servers, pathServers, endpoint }) => {
    const observed: ServiceObservation = { kind: "openapi", url: "https://rooms.example/search", document: {
      openapi: "3.1.0", servers,
      paths: { "/rooms/{id}": { ...(pathServers ? { servers: pathServers } : {}), post: {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "結果" } },
      } } },
    } };
    const service = planService(observed).assemble({ operations: { [`POST ${endpoint}`]: { name: "room", description: "房間" } } });
    expect(service.tools[0]!.execution).toMatchObject({ kind: "http", url: endpoint, method: "POST" });
  });

  it("不支援的操作不提供給模型：非 form/explode 的 query 不列入，全部不支援時說明原因", () => {
    const observed: ServiceObservation = { kind: "openapi", url: "https://rooms.example/search", document: {
      openapi: "3.1.0", servers: [{ url: "https://rooms.example" }],
      paths: {
        "/rooms": { get: { parameters: [{ name: "tag", in: "query", style: "pipeDelimited", schema: { type: "array" } }], responses: {} } },
      },
    } };
    expect(() => planService(observed)).toThrow(/沒有可提供的 OpenAPI 操作.*query/);
  });

  it("模型只能選擇文件中已列出的操作", () => {
    const { schema } = planService(applicationApi);
    expect(schema.safeParse({ operations: { "GET https://rooms.example/admin": { name: "x", description: "x" } } }).success).toBe(false);
  });
});

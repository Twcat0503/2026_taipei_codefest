import { describe, expect, it } from "vitest";
import { planWithSteps, type Step } from "../src/registry/steps.js";
import type { ServiceObservation } from "../src/registry/inspect.js";

const url = "https://courses.example/search";
const courses: ServiceObservation = {
  kind: "page", url, title: "課程查詢", text: "依地區與人數查詢",
  elements: [
    { selector: "#count", tag: "input", type: "number", label: "參加人數", required: true },
    { selector: "#district", tag: "select", type: null, label: "地區", required: true, options: [
      { value: "north", label: "北區" }, { value: "south", label: "南區" },
    ] },
    { selector: "#find-courses", tag: "button", type: "submit", text: "查詢課程" },
    { selector: "#courses-result", tag: "output", text: "" },
  ],
};

const parameterOf: Record<string, string> = { "#count": "count", "#district": "district" };

type Answer = unknown | ((step: Step) => unknown);

/** 依步驟的 task 回答，並記錄每個步驟與同時執行的數量，用來檢查依序執行。 */
function fakeAsk(answers: Record<string, Answer>) {
  const steps: Step[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const ask = async (step: Step) => {
    steps.push(step);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 1));
    inFlight -= 1;
    const answer = answers[step.task];
    return typeof answer === "function" ? answer(step) : answer;
  };
  return { ask, steps, maxInFlight: () => maxInFlight };
}

const courseAnswers: Record<string, Answer> = {
  control: (step: Step) => ({
    thought: "Name the control the user fills.",
    parameter: parameterOf[(step.input.control as { selector: string }).selector],
  }),
  submit: { thought: "The button starts the search.", submit: "#find-courses" },
  result: { thought: "The output shows the result.", resultSelector: "#courses-result" },
  tool: { thought: "The tool searches courses.", name: "search_courses", description: "依地區與人數查詢課程" },
};

describe("逐步生成：每次呼叫只回答一個小問題", () => {
  it("每個控制項各自一次呼叫，後續呼叫能看到已命名的參數", async () => {
    const { ask, steps } = fakeAsk(courseAnswers);
    const service = await planWithSteps(courses, ask);
    expect(steps.map(step => step.task)).toEqual(["control", "control", "submit", "result", "tool"]);
    expect(steps[0]!.input.takenNames).toEqual([]);
    expect(steps[1]!.input.takenNames).toEqual(["count"]);
    expect(service.tools[0]!.inputSchema.properties).toHaveProperty("count");
    expect(service.tools[0]!.inputSchema.properties).toHaveProperty("district");
  });

  it("步驟依序執行，前一步回答完成後才送出下一步", async () => {
    const { ask, maxInFlight } = fakeAsk(courseAnswers);
    await planWithSteps(courses, ask);
    expect(maxInFlight()).toBe(1);
  });

  it("結果區候選不含輸入控制項與送出控制項", async () => {
    const { ask, steps } = fakeAsk(courseAnswers);
    await planWithSteps(courses, ask);
    const { schema } = steps.find(step => step.task === "result")!;
    expect(schema.safeParse({ thought: "The output shows it.", resultSelector: "#courses-result" }).success).toBe(true);
    expect(schema.safeParse({ thought: "The output shows it.", resultSelector: "#find-courses" }).success).toBe(false);
    expect(schema.safeParse({ thought: "The output shows it.", resultSelector: "#district" }).success).toBe(false);
  });

  it("任一步失敗即停止，不重試", async () => {
    const { ask, steps } = fakeAsk({
      ...courseAnswers,
      control: () => { throw new Error("模型暫時無法回應"); },
    });
    await expect(planWithSteps(courses, ask)).rejects.toThrow("模型暫時無法回應");
    expect(steps).toHaveLength(1);
  });

  it("thought 只允許可列印的英文 ASCII，不含引號，且不超過 200 字元", async () => {
    const { ask, steps } = fakeAsk(courseAnswers);
    await planWithSteps(courses, ask);
    const { schema } = steps[0]!;
    expect(schema.safeParse({ thought: "Name the count field.", parameter: "count" }).success).toBe(true);
    expect(schema.safeParse({ thought: "參加人數", parameter: "count" }).success).toBe(false);
    expect(schema.safeParse({ thought: 'Use "count" here.', parameter: "count" }).success).toBe(false);
    expect(schema.safeParse({ thought: "a".repeat(201), parameter: "count" }).success).toBe(false);
  });

  it("每個 API 操作各自一次呼叫，只有 include 為真的操作成為工具", async () => {
    const rooms: ServiceObservation = { kind: "openapi", url: "https://rooms.example/search", document: {
      openapi: "3.1.0", servers: [{ url: "https://rooms.example" }],
      paths: {
        "/rooms": { get: { operationId: "list_rooms", summary: "列出場地", responses: { "200": { description: "結果" } } } },
        "/rooms/{id}/book": { post: {
          operationId: "book_room",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "結果" } },
        } },
      },
    } };
    const { ask, steps } = fakeAsk({
      operation: (step: Step) => step.input.key === "GET https://rooms.example/rooms"
        ? { thought: "Listing rooms only reads data.", include: true, name: "list_rooms", description: "列出場地" }
        : { thought: "Booking changes data, skip it.", include: false, name: "book_room", description: "預約場地" },
    });
    const service = await planWithSteps(rooms, ask);
    expect(steps[0]!.schema.safeParse({ thought: "ok", include: true, name: "list_rooms", description: 'List "rooms"' }).success).toBe(false);
    expect(steps.map(step => step.task)).toEqual(["operation", "operation"]);
    expect(steps[1]!.input).toMatchObject({ operationId: "book_room", inputs: ["id"] });
    expect(service.tools.map(tool => tool.name)).toEqual(["list_rooms"]);
  });
});

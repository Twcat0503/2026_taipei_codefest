import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { inspectService } from "../src/registry/inspect.js";
import { planService } from "../src/registry/plan.js";

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/openapi.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ openapi: "3.1.0", info: { title: "場地", version: "1" }, paths: {} }));
      return;
    }
    if (req.url === "/data.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ rooms: [], paths: { "/rooms": { get: {} } } }));
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/body-status" || req.url === "/body-live") {
      res.end(`<!doctype html><title>結果</title><body ${req.url === "/body-status" ? 'role="status"' : 'aria-live="polite"'}>查詢完成</body>`);
      return;
    }
    if (req.url === "/uppercase-inputs") {
      res.end(`<!doctype html><title>表單</title>
        <input id="agree" type="CHECKBOX"><input id="send" type="SUBMIT" value="送出">
        <input id="next" type="BUTTON"><input id="reset" type="RESET"><input id="choice" type="RADIO">
        <input id="text" type="invalid"><button id="button" type="SUBMIT">送出</button><output id="result"></output>`);
      return;
    }
    res.end(`<!doctype html><title>場地查詢</title><main id="app"></main>
      <script>setTimeout(() => {
        document.querySelector('#app').innerHTML = '<label for="date">日期</label><input id="date" type="date" required><button id="search">查詢</button><div id="next" role="button">下一頁</div><output id="results"></output>';
      }, 50)</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("微服務觀測", () => {
  it("取得 API 規格，不把 JSON 當網頁標題", async () => {
    const result = await inspectService(`${base}/openapi.json`);
    expect(result).toMatchObject({ kind: "openapi", document: { openapi: "3.1.0" } });
  });

  it("非 OpenAPI JSON 明確回報不支援，不把資料當成 API 規格", async () => {
    await expect(inspectService(`${base}/data.json`)).rejects.toThrow(/OpenAPI/);
  });

  it("DOM 正規化大寫 input type：checkbox 與 text 可作為輸入，submit、button、reset 可送出，radio 不列入", async () => {
    const url = `${base}/uppercase-inputs`;
    const observed = await inspectService(url, { channel: process.platform === "win32" ? "msedge" : undefined });
    const schema = planService(observed).schema;
    const accepts = (controls: string[], submit: string) => schema.safeParse({ tools: [{
      name: "submit_form", description: "送出表單",
      controls: Object.fromEntries(controls.map(selector => [selector, selector.slice(1)])),
      submit, resultSelector: "#result",
    }] }).success;
    expect(observed.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ selector: "#agree", type: "checkbox" }),
      expect.objectContaining({ selector: "#send", type: "submit" }),
      expect.objectContaining({ selector: "#text", type: "text" }),
      expect.objectContaining({ selector: "#button", type: "submit" }),
    ]));
    expect(accepts(["#agree", "#text"], "#send")).toBe(true);
    for (const submit of ["#send", "#next", "#reset", "#button"]) expect(accepts(["#agree"], submit)).toBe(true);
    for (const selector of ["#send", "#next", "#reset", "#choice", "#button"]) expect(accepts([selector], "#send")).toBe(false);
    expect(accepts(["#agree"], "#choice")).toBe(false);
    const service = planService(observed).assemble({ tools: [{
      name: "submit_form", description: "送出表單",
      controls: { "#agree": "agree", "#text": "text" },
      submit: "#send", resultSelector: "#result",
    }] });
    expect(service.tools[0]!.execution).toMatchObject({ steps: [
      { action: "check", selector: "#agree", value: { argument: "agree" } },
      { action: "fill", selector: "#text", value: { argument: "text" } },
      { action: "click", selector: "#send" },
    ] });
  }, 30000);

  it.each(["/body-status", "/body-live"])("無 id 的 body 結果 selector 在真實 DOM 指向原元素：%s", async (path) => {
    const url = `${base}${path}`;
    const channel = process.platform === "win32" ? "msedge" : undefined;
    const observed = await inspectService(url, { channel });
    const body = (observed.elements as { tag: string; selector: string }[]).find(element => element.tag === "body");
    expect(body).toBeDefined();
    const browser = await chromium.launch({ channel });
    try {
      const page = await browser.newPage();
      await page.goto(url);
      await expect(page.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(body!.selector)});
        return { isBody: element === document.body, text: element?.innerText };
      })()`)).resolves.toEqual({ isBody: true, text: "查詢完成" });
    } finally {
      await browser.close();
    }
  }, 30000);

  it("觀測 JavaScript 渲染後的欄位與 form 外的操作按鈕", async () => {
    const result = await inspectService(base, { channel: process.platform === "win32" ? "msedge" : undefined });
    expect(result).toMatchObject({ kind: "page", title: "場地查詢" });
    expect(result.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ selector: "#date", tag: "input", type: "date", label: "日期", required: true }),
      expect.objectContaining({ selector: "#search", tag: "button", text: "查詢" }),
      expect.objectContaining({ selector: "#next", tag: "div", role: "button", text: "下一頁" }),
      expect.objectContaining({ selector: "#results", tag: "output" }),
    ]));
  }, 30000);
});

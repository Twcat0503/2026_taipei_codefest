/** 用假的 fetch 驗證瀏覽器入口符合 agent 的 McpClient 契約，不連網路。 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentToolClient } from "../src/agent-client.js";

const BASE = "https://example.test";
const book = (id: string, name: string) => ({
  id, book_name: name, author: "廣嶋玲子", publisher: "親子天下", publish_date: "2023/01/01", subject: "兒童故事",
  isbn: "9786263055926", click_count: 1,
  series: [{ "series＿name": "N. 1", waiting_people: 0, is_reservation: true, is_hot: false }],
  libraries: [],
});
const COUNTERS_FIXTURE = {
  data: [
    {
      name: "戶政事務所",
      list: [
        {
          id: "c-2-1",
          name: "萬華區戶政事務所",
          info: { address: { text: "和平西路三段120號" }, tel: "02" },
          counters: [{ name: "綜合受理", current_number: "0379", waiting_people: 0 }],
        },
      ],
    },
  ],
};
const ROUTES: Record<string, unknown> = {
  [`${BASE}/mock/library/library_book_list.json`]: { data: [book("b1", "神奇柑仔店"), book("b2", "底層邏輯")] },
  [`${BASE}/mock/counter_list.json`]: COUNTERS_FIXTURE,
  [`${BASE}/mock/service_list.json`]: {
    data: [
      {
        name: "社會福利",
        agency: [{ name: "社會局", options: [{ id: "s1", title: "老人補助", subtitle: "長者津貼" }, { id: "s2", title: "育兒津貼", subtitle: "幼兒" }] }],
      },
    ],
  },
};
const json = (body: unknown, type = "application/json") =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": type } });
const fakeFetch = (async (input: string | URL | Request | URL) => {
  const body = ROUTES[String(input)];
  return body ? json(body) : json({}, "text/html");
}) as typeof fetch;
const signal = () => new AbortController().signal;
const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

describe("createAgentToolClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("只列出 agent 放行的工具", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const { tools } = await client.listTools({ signal: signal() });
    expect(tools.map((tool) => tool.name)).toEqual(["search_books", "search_services"]);
  });

  it("把書籍轉成 agent 要的欄位與來源", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const result = await client.callTool({ name: "search_books", arguments: { query: " 神奇 " } }, { signal: signal() });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(parse(result)).toEqual({
      source: "demo",
      records: [
        {
          id: "b1",
          title: { "zh-Hant-TW": "神奇柑仔店", en: "神奇柑仔店" },
          author: { "zh-Hant-TW": "廣嶋玲子", en: "廣嶋玲子" },
          category: { "zh-Hant-TW": "兒童故事", en: "兒童故事" },
        },
      ],
    });
  });

  it("空字串代表瀏覽全部，查無資料回空陣列", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const all = await client.callTool({ name: "search_books", arguments: { query: "" } }, { signal: signal() });
    expect(parse(all).records).toHaveLength(2);
    const none = await client.callTool({ name: "search_books", arguments: { query: "不存在的書zzz" } }, { signal: signal() });
    expect(parse(none)).toEqual({ source: "demo", records: [] });
  });

  it("服務查詢的泛稱視為瀏覽全部，具體關鍵字才篩選", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const generic = await client.callTool({ name: "search_services", arguments: { query: "申辦" } }, { signal: signal() });
    expect(parse(generic).records).toHaveLength(2);
    const specific = await client.callTool({ name: "search_services", arguments: { query: "補助" } }, { signal: signal() });
    expect(parse(specific)).toEqual({
      source: "demo",
      records: [{ id: "s1", title: { "zh-Hant-TW": "老人補助", en: "老人補助" }, description: { "zh-Hant-TW": "長者津貼", en: "長者津貼" } }],
    });
  });

  it("叫號查詢回傳櫃檯據點，不帶示範號碼", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const result = await client.callTool({ name: "search_services", arguments: { query: "叫號" } }, { signal: signal() });
    expect(parse(result).records).toEqual([
      {
        id: "c-2-1",
        title: { "zh-Hant-TW": "萬華區戶政事務所", en: "萬華區戶政事務所" },
        description: { "zh-Hant-TW": "戶政事務所・和平西路三段120號", en: "戶政事務所・和平西路三段120號" },
      },
    ]);
    expect(result.content[0]!.text).not.toContain("0379");
  });

  it("上游失敗回 isError，不偽裝成查無資料", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: (async () => json({}, "text/html")) as typeof fetch });
    const result = await client.callTool({ name: "search_books", arguments: { query: "神奇" } }, { signal: signal() });
    expect(result.isError).toBe(true);
    expect(parse(result).error.code).toBe("UPSTREAM_FORMAT_CHANGED");
  });

  it("拒絕未知工具與錯誤參數", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const unknown = await client.callTool({ name: "reserve_book", arguments: { query: "x" } }, { signal: signal() });
    expect(parse(unknown).error.code).toBe("TOOL_NOT_FOUND");
    const invalid = await client.callTool({ name: "search_books", arguments: {} }, { signal: signal() });
    expect(parse(invalid).error.code).toBe("INVALID_ARGUMENTS");
  });

  it("取消時立刻中止，不回結果", async () => {
    const pending = (() => new Promise<Response>(() => {})) as typeof fetch;
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: pending });
    const controller = new AbortController();
    const call = client.callTool({ name: "search_books", arguments: { query: "神奇" } }, { signal: controller.signal });
    controller.abort();
    await expect(call).rejects.toBeDefined();
  });

  it("預設 fetch 不綁在 client 上呼叫（瀏覽器否則會 Illegal invocation）", async () => {
    const browserLikeFetch = vi.fn(function (this: unknown, input: string | URL | Request | URL) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(json(ROUTES[String(input)]));
    });
    vi.stubGlobal("fetch", browserLikeFetch);
    const client = createAgentToolClient({ baseUrl: BASE });
    const result = await client.callTool({ name: "search_books", arguments: { query: "神奇" } }, { signal: signal() });
    expect(parse(result).records).toHaveLength(1);
  });
});

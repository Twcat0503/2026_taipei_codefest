/** 用假的 fetch 驗證瀏覽器入口符合 agent 的 ToolClient 契約，不連網路。 */

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
const youbike = (sno: string, act: string, lat: number) => ({
  sno, sna: `站${sno}`, sarea: "大安區", ar: "路", act, updateTime: "2026-11-07 13:00:00", Quantity: 10,
  available_rent_bikes: 4, available_return_bikes: 6, latitude: lat, longitude: 121.5,
});
const ROUTES: Record<string, unknown> = {
  "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json": [
    youbike("far", "1", 25.1), youbike("near", "1", 25.0), youbike("off", "0", 25.0),
  ],
  [`${BASE}/mock/library/library_book_list.json`]: { data: [book("b1", "神奇柑仔店"), book("b2", "底層邏輯")] },
  [`${BASE}/mock/counter_list.json`]: COUNTERS_FIXTURE,
  [`${BASE}/mock/subscription_list.json`]: { data: { submit_target: {}, data: [{ id: "sub-3", name: "交通措施", is_subscribed: true, description: "交通管制訊息" }] } },
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

  it("列出 17 支工具與 JSON Schema", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const { tools } = await client.listTools({ signal: signal() });
    expect(tools).toHaveLength(17);
    expect(tools.map((tool) => tool.name)).toContain("find_nearby_youbike");
    expect(tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
  });

  it("把書籍轉成 agent 要的欄位與來源", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const result = await client.callTool({ name: "search_library_books", arguments: { keyword: " 神奇 " } }, { signal: signal() });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(parse(result)).toMatchObject({
      source: "demo",
      source_label: "示範資料",
      total: 1,
      records: [
        {
          id: "b1",
          title: { "zh-Hant-TW": "神奇柑仔店", en: "神奇柑仔店" },
          author: { "zh-Hant-TW": "廣嶋玲子", en: "廣嶋玲子" },
          category: { "zh-Hant-TW": "兒童故事", en: "兒童故事" },
          url: `${BASE}/library-service/book-detail/b1`,
        },
      ],
    });
  });

  it("空字串代表瀏覽全部，查無資料回空陣列", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const all = await client.callTool({ name: "search_library_books", arguments: { keyword: "" } }, { signal: signal() });
    expect(parse(all).records).toHaveLength(2);
    const none = await client.callTool({ name: "search_library_books", arguments: { keyword: "不存在的書zzz" } }, { signal: signal() });
    expect(parse(none)).toMatchObject({ source: "demo", total: 0, records: [] });
  });

  it("服務查詢的泛稱視為瀏覽全部，具體關鍵字才篩選", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const generic = await client.callTool({ name: "search_application_services", arguments: { keyword: "申辦" } }, { signal: signal() });
    expect(parse(generic).records).toHaveLength(2);
    const specific = await client.callTool({ name: "search_application_services", arguments: { keyword: "補助" } }, { signal: signal() });
    expect(parse(specific).records).toMatchObject([
      { id: "s1", title: { "zh-Hant-TW": "老人補助", en: "老人補助" }, description: { "zh-Hant-TW": "長者津貼", en: "長者津貼" } },
    ]);
  });

  it("櫃檯工具把號碼放進欄位", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const result = await client.callTool({ name: "search_service_counters", arguments: {} }, { signal: signal() });
    const [office] = parse(result).records;
    expect(office.title["zh-Hant-TW"]).toBe("萬華區戶政事務所");
    expect(office.fields.map((f: { label: { en: string } }) => f.label.en)).toEqual(["類別", "地址", "電話", "櫃檯"]);
    expect(office.fields[3].value.en).toContain("0379");
  });

  it("附近查詢用呼叫端的定位，拿不到時回 LOCATION_UNAVAILABLE", async () => {
    const located = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch, getLocation: async () => ({ lat: 25.0, lng: 121.5 }) });
    const near = await located.callTool({ name: "find_nearby_youbike", arguments: { near_me: true } }, { signal: signal() });
    expect(parse(near)).toMatchObject({ source: "live", records: [{ id: "near" }] });
    // Places open in Town Pass's own 找地點 service, never a Google Maps link.
    expect(parse(near).records[0].url).toBeUndefined();
    expect(parse(near).records[0].fields[0]).toEqual({ label: { "zh-Hant-TW": "距離", en: "距離" }, value: { "zh-Hant-TW": "0 公尺", en: "0 公尺" } });
    const unlocated = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const failed = await unlocated.callTool({ name: "find_nearby_youbike", arguments: { near_me: true } }, { signal: signal() });
    expect(failed.isError).toBe(true);
    expect(parse(failed).error.code).toBe("LOCATION_UNAVAILABLE");
    const byArea = await unlocated.callTool({ name: "find_nearby_youbike", arguments: { area: "大安區" } }, { signal: signal() });
    expect(parse(byArea).records.map((r: { id: string }) => r.id)).toEqual(["far", "near"]);
  });

  it("訂閱主題只列主題，不帶個人訂閱狀態", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const result = await client.callTool({ name: "list_subscription_topics", arguments: { keyword: "交通" } }, { signal: signal() });
    expect(parse(result).records).toMatchObject([{ id: "sub-3", title: { en: "交通措施" }, url: `${BASE}/subscription` }]);
    expect(result.content[0]!.text).not.toContain("is_subscribed");
  });

  it("服務清單是台北通站內頁面的連結，不含示範資料", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch, includeDemo: false });
    const result = await client.callTool({ name: "list_townpass_services", arguments: { keyword: "警政" } }, { signal: signal() });
    const body = parse(result);
    expect(body.source).toBe("link");
    expect(body.records).toMatchObject([{ id: "police_report", url: `${BASE}/police-report` }]);
    expect(body.records[0].fields).toBeUndefined();
  });

  it("上游失敗回 isError，不偽裝成查無資料", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: (async () => json({}, "text/html")) as typeof fetch });
    const result = await client.callTool({ name: "search_library_books", arguments: { keyword: "神奇" } }, { signal: signal() });
    expect(result.isError).toBe(true);
    expect(parse(result).error.code).toBe("UPSTREAM_FORMAT_CHANGED");
  });

  it("拒絕未知工具與錯誤參數", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch });
    const unknown = await client.callTool({ name: "reserve_book", arguments: { keyword: "x" } }, { signal: signal() });
    expect(parse(unknown).error.code).toBe("TOOL_NOT_FOUND");
    const invalid = await client.callTool({ name: "search_library_books", arguments: { keyword: 1 } }, { signal: signal() });
    expect(parse(invalid).error.code).toBe("INVALID_ARGUMENTS");
  });

  it("取消時立刻中止，不回結果", async () => {
    const pending = (() => new Promise<Response>(() => {})) as typeof fetch;
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: pending });
    const controller = new AbortController();
    const call = client.callTool({ name: "search_library_books", arguments: { keyword: "神奇" } }, { signal: controller.signal });
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
    const result = await client.callTool({ name: "search_library_books", arguments: { keyword: "神奇" } }, { signal: signal() });
    expect(parse(result).records).toHaveLength(1);
  });

  it("App 模式只提供真實資料與官方入口，不提供示範站模擬資料", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch, includeDemo: false });
    const { tools } = await client.listTools({ signal: signal() });
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "find_nearby_parking",
      "find_nearby_toilets",
      "find_nearby_youbike",
      "list_townpass_services",
      "open_official_service",
    ]);
    const demo = await client.callTool({ name: "search_library_books", arguments: { keyword: "貓" } }, { signal: signal() });
    expect(demo.isError).toBe(true);
  });

  it("入口只從白名單組網址：台北通站內優先，關鍵字只用在圖書搜尋", async () => {
    const client = createAgentToolClient({ baseUrl: BASE, fetchFn: fakeFetch, includeDemo: false });
    const call = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: "open_official_service", arguments: args }, { signal: signal() });
      return result.isError ? null : JSON.parse(result.content[0]!.text);
    };
    const report = await call({ destination: "townpass_report" });
    expect(report.source).toBe("link");
    expect(report.source_label).toBe("台北通站內服務");
    expect(report.source_note).toContain("示範資料");
    expect(report.records[0].url).toBe(`${BASE}/citizen-report/`);
    expect(report.records[0].fields.find((f: { label: { en: string } }) => f.label.en === "前往").value.en).toBe("台北通「有話要說」");
    expect((await call({ destination: "fee_water" })).records[0].url).toBe(`${BASE}/fee-payment/detail/fee-6/`);
    expect((await call({ destination: "townpass_library", keyword: "神奇" })).records[0].url).toBe(
      `${BASE}/library-service/keyword-search?search=%E7%A5%9E%E5%A5%87&type=all`,
    );
    expect((await call({ destination: "townpass_library", keyword: "https://evil.example/" })).records[0].url).toBe(
      `${BASE}/library-service/`,
    );
    expect((await call({ destination: "fee_water", keyword: "x" })).records[0].url).toBe(`${BASE}/fee-payment/detail/fee-6/`);
    const external = await call({ destination: "services_disabled" });
    expect(external.source_label).toBe("官方入口");
    expect(external.records[0].url).toContain("https://service.taipei/");
    expect((await call({ destination: "call_1999" })).records[0].url).toBe("tel:1999");
    expect(await call({ destination: "https://evil.example/" })).toBeNull();
  });
});

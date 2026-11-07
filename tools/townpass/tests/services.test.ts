/** 直接測資料層；上游以假的 fetch 取代，不連網路。 */

import { beforeEach, describe, expect, it } from "vitest";

import { TownPassClient } from "../src/adapters/client.js";
import { BOOKS } from "../src/adapters/datasets.js";
import { createServices, type Services } from "../src/services/index.js";
import { distanceMeters, twd97ToWgs84 } from "../src/shared/geo.js";

const BASE = "https://example.test";
const LIMIT = 10;

const makeBook = (id: string, name: string, clicks: number) => ({
  id,
  book_name: name,
  author: "廣嶋玲子",
  publisher: "親子天下",
  publish_date: "2023/01/01",
  subject: "兒童故事",
  isbn: "9786263055926",
  thumbnail: "ignored",
  click_count: clicks,
  call_number: "",
  series: [{ "series＿name": "N. 1", waiting_people: 3, is_reservation: true, is_hot: false }],
  libraries: [{ id: "lib-1", name: "延吉", area: "大安區", address: { text: "延吉街" }, phone: "02" }],
});

const youbike = (sno: string, act: string, lat: number) => ({
  sno, sna: `站${sno}`, sarea: "大安區", ar: "路", act, updateTime: "2026-11-07 13:00:00", Quantity: 10,
  available_rent_bikes: 4, available_return_bikes: 6, latitude: lat, longitude: 121.5,
});

const ROUTES: Record<string, unknown> = {
  [`${BASE}/mock/library/library_book_list.json`]: { data: [makeBook("b1", "神奇柑仔店", 5), makeBook("b2", "底層邏輯", 9)] },
  [`${BASE}/mock/library/library_notice_list.json`]: {
    data: [{ id: "n1", date: "2024/11/01", title: "內部公告", description: "", is_open_outer_link: false }],
  },
  "https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json": {
    data: {
      UPDATETIME: "Mon Oct 19 10:26:00 CST 2026",
      park: [
        { id: "1", area: "信義區", name: "有入口座標", summary: "", address: "", tel: "", payex: "", serviceTime: "", tw97x: "", tw97y: "", totalcar: 1, totalmotor: 1, Handicap_First: "2", Pregnancy_First: "0", EntranceCoord: { EntrancecoordInfo: [{ Xcod: "25.03", Ycod: "121.56" }] } },
        { id: "2", area: "信義區", name: "只有投影座標", summary: "", address: "", tel: "", payex: "", serviceTime: "", tw97x: "306723.6875", tw97y: "2769942.25", totalcar: 1, totalmotor: 1, Handicap_First: "0", Pregnancy_First: "0" },
        { id: "4", area: "中山區", name: "入口座標錯位", summary: "", address: "", tel: "", payex: "", serviceTime: "", tw97x: "305962.625", tw97y: "2775274.75", totalcar: 1, totalmotor: 1, EntranceCoord: { EntrancecoordInfo: [{ Xcod: "25.03", Ycod: "121.56" }] } },
        { id: "5", area: "信義區", name: "入口座標為零", summary: "", address: "", tel: "", payex: "", serviceTime: "", tw97x: "", tw97y: "", totalcar: 1, totalmotor: 1, Pregnancy_First: "3", EntranceCoord: { EntrancecoordInfo: [{ Xcod: "0", Ycod: "0" }] } },
        { id: "3", area: "信義區", name: "沒有座標", summary: "", address: "", tel: "", payex: "", serviceTime: "", tw97x: "", tw97y: "", totalcar: 1, totalmotor: 1 },
      ],
    },
  },
  "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json": [
    youbike("far", "1", 25.1), youbike("near", "1", 25.0), youbike("off", "0", 25.0),
  ],
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

let fetchCalls = 0;
const fakeFetch = (async (input: string | URL | Request) => {
  fetchCalls += 1;
  const url = String(input);
  if (url.includes("broken")) return new Response("oops", { status: 500 });
  const body = ROUTES[url];
  if (body === undefined) return new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
  // 官方 blob 實際以 application/octet-stream 回傳 JSON。
  if (url.includes("blobtcmsv"))
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/octet-stream" } });
  return jsonResponse(body);
}) as typeof fetch;

const connect = (fetchFn: typeof fetch = fakeFetch, baseUrl = BASE): Services =>
  createServices(new TownPassClient({ baseUrl, timeoutMs: 1000, fetchFn }));

describe("services", () => {
  let s: Services;
  beforeEach(() => {
    fetchCalls = 0;
    s = connect();
  });

  it("library search returns demo-labelled hits and an encoded source url", async () => {
    const body = await s.library.search("神奇", LIMIT);
    expect(body.status).toBe("found");
    expect(body.count).toBe(1);
    expect(body.data_source.label).toBe("示範資料");
    expect(body.results[0]?.book_name).toBe("神奇柑仔店");
    expect(body.source_url).toBe(`${BASE}/library-service/keyword-search?search=%E7%A5%9E%E5%A5%87&type=all`);
  });

  it("reports not_found only when the data loaded and nothing matched", async () => {
    const body = await s.library.search("不存在的書zzz", LIMIT);
    expect(body.status).toBe("not_found");
    expect(body.results).toEqual([]);
  });

  it("treats an HTML 200 as a format failure, not as no results", async () => {
    await expect(s.civic.faq("登入", LIMIT)).rejects.toMatchObject({ code: "UPSTREAM_FORMAT_CHANGED" });
  });

  it("treats an upstream 500 as a failure and does not cache it", async () => {
    const failing = new TownPassClient({ baseUrl: `${BASE}/broken`, timeoutMs: 1000, fetchFn: fakeFetch });
    await expect(failing.load(BOOKS)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    await expect(failing.load(BOOKS)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(fetchCalls).toBe(2);
  });

  it("treats a schema mismatch as a format failure", async () => {
    const wrong = connect((async () => jsonResponse({ data: [{ id: "x" }] })) as typeof fetch);
    await expect(wrong.library.search("x", LIMIT)).rejects.toMatchObject({ code: "UPSTREAM_FORMAT_CHANGED" });
  });

  it("caches datasets between calls", async () => {
    await s.library.search("神奇", LIMIT);
    await s.library.ranking(LIMIT);
    expect(fetchCalls).toBe(1);
  });

  it("getBook maps the full-width series field", async () => {
    const found = await s.library.getBook("b1");
    expect(found.book?.volumes[0]).toEqual({ name: "N. 1", waiting_people: 3, reservable: true, is_hot: false });
    expect((await s.library.getBook("nope")).status).toBe("not_found");
  });

  it("accepts a book without call_number and a notice without outer_link", async () => {
    const { call_number: _omitted, ...withoutCallNumber } = makeBook("b3", "沒有索書號", 1);
    const stubbed = connect((async (input: string | URL | Request) =>
      String(input).includes("library_book_list") ? jsonResponse({ data: [withoutCallNumber] }) : fakeFetch(input)) as typeof fetch);
    expect((await stubbed.library.search("索書號", LIMIT)).count).toBe(1);
    const notices = await stubbed.library.notices(LIMIT);
    expect(notices.results[0]?.link).toBe(`${BASE}/library-service/notice-detail/n1`);
  });

  it("ranking sorts by clicks", async () => {
    const body = await s.library.ranking(LIMIT);
    expect(body.results.map((b) => b.id)).toEqual(["b2", "b1"]);
    expect(body.results[0]?.rank).toBe(1);
  });

  it("youbike sorts by distance, drops inactive stations, and is labelled live", async () => {
    const body = await s.places.youbike({ lat: 25.0, lng: 121.5, radius_m: 20000, limit: LIMIT });
    expect(body.data_source.kind).toBe("live");
    expect(body.results.map((r) => r.id)).toEqual(["near", "far"]);
    expect(body.results[0]?.distance_m).toBe(0);
  });

  it("places require a filter and paired coordinates", async () => {
    await expect(s.places.youbike({ radius_m: 1000, limit: LIMIT })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.places.youbike({ lat: 25, radius_m: 1000, limit: LIMIT })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("parking uses entrance or projected coordinates and skips rows without either", async () => {
    const body = await s.places.parking({ lat: 25.03, lng: 121.56, radius_m: 5000, limit: LIMIT });
    expect(body.data_source.kind).toBe("snapshot");
    expect(body.results.map((p) => p.id)).toEqual(["1", "2"]);
    expect((await s.places.parking({ area: "信義區", radius_m: 1000, limit: LIMIT })).total).toBe(4);
  });

  it("parking reads the official feed, labels its data time, and filters accessible spaces", async () => {
    const body = await s.places.parking({ area: "信義區", accessible: true, radius_m: 1000, limit: LIMIT });
    expect(body.data_source.label).toBe("官方開放資料");
    expect(body.data_source.note).toContain("臺北市政府交通局停車管理工程處");
    expect(body.data_source.note).toContain("2026-10-19 10:26");
    expect(body.data_source.note).toContain("不是即時空位");
    expect(body.results.map((p) => [p.id, p.handicap_spaces, p.pregnancy_spaces])).toEqual([
      ["1", 2, 0],
      ["5", 0, 3],
    ]);
  });

  it("keeps disabled and pregnancy spaces separate before ranking nearby parking", async () => {
    const disabled = await s.places.parking({
      lat: 25.03, lng: 121.56, radius_m: 3000, parking_space: "disabled", limit: LIMIT,
    });
    expect(disabled.results.map((p) => p.id)).toEqual(["1"]);
    const pregnancy = await s.places.parking({
      area: "信義區", radius_m: 1000, parking_space: "pregnancy", limit: LIMIT,
    });
    expect(pregnancy.results.map((p) => p.id)).toEqual(["5"]);
  });

  it("toilets come from the dated official snapshot and can require accessible seats", async () => {
    const body = await s.places.toilets({ area: "大安區", accessible: true, radius_m: 1000, limit: LIMIT });
    expect(body.data_source.note).toContain("臺北市政府環境保護局");
    expect(body.data_source.note).toMatch(/資料時間 \d{4}-\d{2}-\d{2}/);
    expect(body.total).toBeGreaterThan(0);
    expect(body.results.every((t) => t.area === "大安區" && t.accessible_seats > 0)).toBe(true);
    expect(fetchCalls).toBe(0);
    const all = await s.places.toilets({ area: "大安區", radius_m: 1000, limit: LIMIT });
    expect(all.total).toBeGreaterThan(body.total);
  });
});

describe("twd97ToWgs84", () => {
  it("lands next to the known entrance of 府前廣場地下停車場", () => {
    const converted = twd97ToWgs84(306723.6875, 2769942.25);
    expect(distanceMeters(converted, { lat: 25.03648987, lng: 121.5621068 })).toBeLessThan(400);
  });
});

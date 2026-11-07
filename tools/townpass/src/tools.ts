/** 給 agent 的 15 支唯讀工具：輸入用 zod 驗證，輸出統一成卡片可以直接顯示的 records。 */

import { z } from "zod";

import { CATALOG } from "./services/catalog.js";
import type { Services } from "./services/index.js";
import { LocationError } from "./shared/errors.js";
import type { DataSource } from "./shared/result.js";

/** agent 單次最多接受 20 筆，文字欄位上限 500 字。 */
const MAX_RECORDS = 20;
const MAX_TEXT = 500;

export type Localized = { "zh-Hant-TW": string; en: string };
export interface AgentRecord {
  id: string;
  title: Localized;
  description?: Localized;
  author?: Localized;
  category?: Localized;
  fields?: { label: Localized; value: Localized }[];
  url?: string;
}
export interface ToolOutput {
  source: DataSource["kind"];
  source_label: string;
  source_note: string;
  source_url: string;
  total: number;
  truncated: boolean;
  records: AgentRecord[];
}
export type LatLng = { lat: number; lng: number };
export interface ToolContext {
  services: Services;
  baseUrl: string;
  signal: AbortSignal;
  getLocation?: (signal: AbortSignal) => Promise<LatLng | null>;
}

interface ListLike<T> {
  total: number;
  truncated: boolean;
  data_source: DataSource;
  source_url: string;
  results: T[];
}

/** 資料只有中文，en 放原文而非翻譯。上游有 HTML 標籤，這裡去掉，畫面只當純文字。 */
const text = (value: unknown): Localized => {
  const clean = String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  return { "zh-Hant-TW": clean, en: clean };
};
const fields = (entries: Record<string, unknown>) =>
  Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => ({ label: text(label), value: text(value) }));
const httpsOnly = (url: string | undefined) => (url?.startsWith("https://") ? url : undefined);
const mapLink = (coord: LatLng | null) =>
  coord ? `https://www.google.com/maps/search/?api=1&query=${coord.lat},${coord.lng}` : undefined;

function output<T>(list: ListLike<T>, toRecord: (item: T) => AgentRecord): ToolOutput {
  return {
    source: list.data_source.kind,
    source_label: list.data_source.label,
    source_note: list.data_source.note,
    source_url: list.source_url,
    total: list.total,
    truncated: list.truncated,
    records: list.results.map(toRecord),
  };
}

const keyword = z.string().trim().max(100).optional().describe("搜尋關鍵字；省略或空字串代表列出全部");
const orAll = (value: string | undefined) => value || undefined;

/** 泛稱不是真的關鍵字，所有項目都是可申辦服務。 */
const GENERIC_SERVICE_QUERIES = new Set(["申辦", "申請", "服務", "申辦服務"]);

const placeInput = z.strictObject({
  near_me: z.boolean().optional().describe("使用者問「附近」或「最近」時設為 true，由裝置取得位置；不要自己填座標"),
  radius_m: z.number().int().min(1).max(20_000).optional().describe("near_me 的搜尋半徑（公尺），預設 1000"),
  area: z.string().trim().max(100).optional().describe("行政區，例如 大安區"),
  keyword: z.string().trim().max(100).optional().describe("名稱或地址關鍵字"),
});
type PlaceInput = z.output<typeof placeInput>;

/** 沒給行政區和關鍵字也算在問附近。位置只在瀏覽器內計算距離，不會傳給模型。 */
async function placeQuery(args: PlaceInput, ctx: ToolContext) {
  const area = orAll(args.area);
  const key = orAll(args.keyword);
  const base = { radius_m: args.radius_m ?? 1000, area, keyword: key, limit: MAX_RECORDS };
  if (!args.near_me && (area || key)) return base;
  const position = await ctx.getLocation?.(ctx.signal);
  if (!position) throw new LocationError();
  return { ...base, ...position };
}

interface ToolDef<S extends z.ZodObject> {
  name: string;
  description: string;
  input: S;
  run: (args: z.output<S>, ctx: ToolContext) => Promise<ToolOutput>;
}
const define = <S extends z.ZodObject>(def: ToolDef<S>): ToolDef<z.ZodObject> => def as unknown as ToolDef<z.ZodObject>;

const bookRecord = (book: { id: string; book_name: string; author: string; subject: string; publisher?: string; page_url: string }) => ({
  id: book.id,
  title: text(book.book_name),
  author: text(book.author),
  category: text(book.subject),
  url: httpsOnly(book.page_url),
});

export const AGENT_TOOLS = [
  define({
    name: "list_townpass_services",
    description: "列出台北通所有網頁服務與連結，含警政、訂閱、票券錢包、繳費紀錄這些只能到頁面操作的服務。問「有哪些服務」或要找某個服務頁時使用。",
    input: z.strictObject({ keyword }),
    run: async ({ keyword: key }, ctx) => {
      const needle = orAll(key);
      const hits = CATALOG.filter((s) => !needle || s.title.includes(needle) || s.note?.includes(needle));
      return {
        source: "demo",
        source_label: "服務清單",
        source_note: "標示「到頁面操作」的服務涉及送件、付款或個人資料，agent 不代為操作。",
        source_url: ctx.baseUrl,
        total: hits.length,
        truncated: false,
        records: hits.map((s) => ({
          id: s.id,
          title: text(s.title),
          description: s.note ? text(s.note) : undefined,
          fields: fields({ 方式: s.mode === "link_only" ? "到頁面操作" : "可直接查詢" }),
          url: httpsOnly(`${ctx.baseUrl}${s.path}`),
        })),
      };
    },
  }),
  define({
    name: "search_library_books",
    description: "以關鍵字搜尋圖書館藏，比對書名、著者、出版項、主題、ISBN。示範資料，不代表真實館藏。",
    input: z.strictObject({ keyword }),
    run: async ({ keyword: key }, ctx) => output(await ctx.services.library.search(key ?? "", MAX_RECORDS), bookRecord),
  }),
  define({
    name: "get_library_book",
    description: "用搜尋或排行取得的 id 查書籍詳情：冊別、預約等待人數、可取書分館。只能查詢。",
    input: z.strictObject({ book_id: z.string().trim().min(1).max(100).describe("書籍 id，例如 lib-book-5") }),
    run: async ({ book_id }, ctx) => {
      const result = await ctx.services.library.getBook(book_id);
      const books = result.book ? [result.book] : [];
      return output(
        { total: books.length, truncated: false, data_source: result.data_source, source_url: result.book?.page_url ?? ctx.baseUrl, results: books },
        (b) => ({
          ...bookRecord(b),
          fields: fields({
            出版: b.publisher,
            索書號: b.call_number,
            冊別: b.volumes.map((v) => `${v.name}（等待 ${v.waiting_people} 人${v.reservable ? "，可預約" : ""}）`).join("、"),
            可取書分館: b.pickup_libraries.map((l) => l.name).join("、"),
          }),
        }),
      );
    },
  }),
  define({
    name: "get_library_ranking",
    description: "依點閱次數由高到低列出書籍。問熱門書、排行榜時使用。",
    input: z.strictObject({}),
    run: async (_args, ctx) =>
      output(await ctx.services.library.ranking(MAX_RECORDS), (b) => ({ ...bookRecord(b), fields: fields({ 排名: b.rank, 點閱: b.click_count }) })),
  }),
  define({
    name: "list_library_branches",
    description: "列出圖書分館與借書站，含行政區、地址、電話，可用行政區篩選。",
    input: z.strictObject({ area: z.string().trim().max(100).optional().describe("行政區，例如 信義區") }),
    run: async ({ area }, ctx) =>
      output(await ctx.services.library.branches(orAll(area), MAX_RECORDS), (l) => ({
        id: l.id,
        title: text(l.name),
        fields: fields({ 行政區: l.area, 地址: l.address, 電話: l.phone }),
      })),
  }),
  define({
    name: "list_library_notices",
    description: "列出圖書館重要訊息，內容日期可能已過期。",
    input: z.strictObject({}),
    run: async (_args, ctx) =>
      output(await ctx.services.library.notices(MAX_RECORDS), (n) => ({
        id: n.id,
        title: text(n.title),
        description: text(n.description),
        fields: fields({ 日期: n.date }),
        url: httpsOnly(n.link),
      })),
  }),
  define({
    name: "search_application_services",
    description: "搜尋可線上申辦的項目及主管機關，例如補助、證明。只能查項目，不能送出申辦。",
    input: z.strictObject({ keyword }),
    run: async ({ keyword: key }, ctx) => {
      const needle = key && !GENERIC_SERVICE_QUERIES.has(key) ? key : undefined;
      return output(await ctx.services.civic.applications(needle, MAX_RECORDS), (s) => ({
        id: s.id,
        title: text(s.title),
        description: text(s.description),
        fields: fields({ 類別: s.type, 機關: s.agency }),
      }));
    },
  }),
  define({
    name: "search_service_counters",
    description: "查戶政、地政、區公所、稅捐處、就業服務站的櫃檯目前號碼與等待人數。號碼是示範資料，不是現場實際叫號。",
    input: z.strictObject({ keyword }),
    run: async ({ keyword: key }, ctx) =>
      output(await ctx.services.civic.counters(orAll(key), MAX_RECORDS), (o) => ({
        id: o.id,
        title: text(o.name),
        fields: fields({
          類別: o.category,
          地址: o.address,
          電話: o.tel,
          櫃檯: o.counters.map((c) => `${c.name} 目前 ${c.current_number}，等待 ${c.waiting_people} 人`).join("；"),
        }),
      })),
  }),
  define({
    name: "search_faq",
    description: "搜尋台北通常見問題，例如登入註冊、卡證、優惠、帳單。",
    input: z.strictObject({ keyword }),
    run: async ({ keyword: key }, ctx) =>
      output(await ctx.services.civic.faq(orAll(key), MAX_RECORDS), (q) => ({
        id: q.id,
        title: text(q.question),
        description: text(q.answer),
        category: text(q.category),
      })),
  }),
  define({
    name: "search_fee_types",
    description: "搜尋可繳費的項目，例如水費、停車費、地方稅，並列出查繳方式與需要的欄位。不會查帳單，也不會付款。",
    input: z.strictObject({ keyword }),
    run: async ({ keyword: key }, ctx) =>
      output(await ctx.services.civic.fees(orAll(key), MAX_RECORDS), (f) => ({
        id: f.id,
        title: text(f.name),
        category: text(f.category),
        fields: fields({
          查繳方式: f.lookup_methods.map((m) => m.name).join("、"),
          需要欄位: [...new Set(f.lookup_methods.flatMap((m) => m.fields.map((x) => x.label)))].join("、"),
        }),
        url: httpsOnly(f.page_url),
      })),
  }),
  define({
    name: "list_report_categories",
    description: "列出「有話要說」陳情（citizen）或「災情通報」（disaster）的分類。不能送出案件；緊急情況請撥打 119 或 110。",
    input: z.strictObject({ kind: z.enum(["citizen", "disaster"]).describe("citizen=陳情，disaster=災情通報") }),
    run: async ({ kind }, ctx) =>
      output(await ctx.services.civic.reportCategories(kind, MAX_RECORDS), (c) => ({
        id: c.id,
        title: text(c.name),
        description: text(c.items.join("、")),
        url: httpsOnly(`${ctx.baseUrl}${kind === "citizen" ? "/citizen-report/" : "/disaster-report"}`),
      })),
  }),
  define({
    name: "list_subscription_topics",
    description: "列出台北通可訂閱的市政訊息主題，例如交通措施、銀髮資訊、圖書到期通知。只列主題，不代為訂閱。",
    input: z.strictObject({ keyword }),
    run: async ({ keyword: key }, ctx) =>
      output(await ctx.services.civic.subscriptions(orAll(key), MAX_RECORDS), (s) => ({
        id: s.id,
        title: text(s.name),
        description: text(s.description),
        url: httpsOnly(`${ctx.baseUrl}/subscription`),
      })),
  }),
  define({
    name: "search_perks",
    description: "搜尋熱門景點（hot_spot）、票券（ticket）與優惠券（coupon）。內容不代表真實優惠，也不能購票或兌換。",
    input: z.strictObject({ keyword, kind: z.enum(["hot_spot", "ticket", "coupon"]).optional().describe("省略代表全部") }),
    run: async ({ keyword: key, kind }, ctx) =>
      output(await ctx.services.civic.perks(orAll(key), kind, MAX_RECORDS), (p) => ({
        id: p.id,
        title: text(p.name),
        description: text(p.description),
        fields: fields({
          營業時間: p.kind === "hot_spot" ? p.business_hours : undefined,
          地址: p.kind === "hot_spot" ? p.address : undefined,
          價格: p.kind === "ticket" ? p.price : undefined,
          優惠: p.kind === "hot_spot" ? undefined : p.discount,
          期限: p.kind === "coupon" ? p.deadline : undefined,
        }),
        url: httpsOnly(p.page_url),
      })),
  }),
  define({
    name: "find_nearby_youbike",
    description: "查 YouBike 2.0 站點的即時可借車輛與可停空位。問附近或最近時設 near_me；也可用 area 或 keyword。",
    input: placeInput,
    run: async (args, ctx) =>
      output(await ctx.services.places.youbike(await placeQuery(args as PlaceInput, ctx)), (s) => ({
        id: s.id,
        title: text(s.name),
        fields: fields({ 距離: s.distance_m === null ? undefined : `${s.distance_m} 公尺`, 可借: s.available_rent_bikes, 可還: s.available_return_bikes, 地址: s.address, 更新時間: s.updated_at }),
        url: mapLink(s.coord),
      })),
  }),
  define({
    name: "find_nearby_parking",
    description: "查停車場的地址、費率與總車位，沒有即時空位。問附近或最近時設 near_me；也可用 area 或 keyword。",
    input: placeInput,
    run: async (args, ctx) =>
      output(await ctx.services.places.parking(await placeQuery(args as PlaceInput, ctx)), (p) => ({
        id: p.id,
        title: text(p.name),
        description: text(p.fee),
        fields: fields({ 距離: p.distance_m === null ? undefined : `${p.distance_m} 公尺`, 地址: p.address, 總車位: p.total_car_spaces, 機車位: p.total_motorcycle_spaces, 營業時間: p.service_time, 電話: p.tel }),
        url: mapLink(p.coord),
      })),
  }),
  define({
    name: "find_nearby_toilets",
    description: "查公廁的地址與類型，keyword 也可比對類型，例如無障礙廁所。問附近或最近時設 near_me；也可用 area 或 keyword。",
    input: placeInput,
    run: async (args, ctx) =>
      output(await ctx.services.places.toilets(await placeQuery(args as PlaceInput, ctx)), (t) => ({
        id: t.id,
        title: text(t.name),
        fields: fields({ 距離: t.distance_m === null ? undefined : `${t.distance_m} 公尺`, 地址: t.address, 類型: t.type, 等級: t.grade }),
        url: mapLink(t.coord),
      })),
  }),
];

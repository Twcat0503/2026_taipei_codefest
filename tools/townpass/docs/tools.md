# 工具契約

給 agent 與前端的對接文件。這裡的工具全部唯讀，不會送件、付款或預約。

工具直接在瀏覽器執行，不需要 server。第一次要先在這個目錄執行 `pnpm install`。

```ts
// App 正式流程：只提供真實資料與官方入口
const client = createAgentToolClient({ getLocation, includeDemo: false }); // 可傳 baseUrl、timeoutMs、fetchFn
await client.callTool({ name: "find_nearby_youbike", arguments: { near_me: true } }, { signal });
```

`includeDemo` 預設為 `true`（相容既有測試），會多提供示範站模擬資料的工具；App 預設傳 `false`，開發時設 `VITE_TOOL_SOURCE=townpass-demo` 才加回來。

## 17 支工具

依 agent 的分流領域分組。`keyword` 省略或空字串代表列出全部；單次最多回 20 筆。標「真實」的工具才會在 App 預設模式提供。

| 領域 | 工具 | 參數 | 資料性質 |
| --- | --- | --- | --- |
| library | `search_library_books` | `keyword` | 示範 |
| library | `get_library_book` | `book_id` | 示範 |
| library | `get_library_ranking` | 無 | 示範 |
| library | `list_library_branches` | `area?` | 示範 |
| library | `list_library_notices` | 無 | 示範 |
| services | `list_townpass_services` | `keyword?` | 台北通站內服務清單與連結（App 預設提供） |
| services | `search_application_services` | `keyword?` | 示範 |
| services | `search_service_counters` | `keyword?` | 示範，號碼不是現場實際叫號 |
| services | `search_faq` | `keyword?` | 示範 |
| services | `search_fee_types` | `keyword?` | 示範，只能查類型，不能繳費 |
| services | `list_report_categories` | `kind`（`citizen`、`disaster`） | 示範 |
| services | `list_subscription_topics` | `keyword?` | 示範，只列主題，不代為訂閱 |
| perks | `search_perks` | `keyword?`、`kind?`（`hot_spot`、`ticket`、`coupon`） | 示範 |
| places | `find_nearby_youbike` | 見下方 | 真實：交通局即時資料 |
| places | `find_nearby_parking` | 見下方 | 真實：停管處官方資料，含身障、孕婦車位數；不是即時空位 |
| places | `find_nearby_toilets` | 見下方 | 真實：環保局官方資料的日期快照，含無障礙、親子廁座與照護床 |
| library、services、bills、perks | `open_official_service` | `destination`、`keyword?` | 台北通站內服務或官方入口白名單，由使用者確認後前往 |

`find_nearby_*` 的參數是 `near_me`、`radius_m`（預設 1000）、`area`、`keyword`、`accessible`。`accessible: true` 時公廁只列有無障礙廁座的；停車場只列有身障**或**孕婦車位的。查特定車位時，`find_nearby_parking` 另外傳 `parking_space: "disabled"`（身障車位）或 `parking_space: "pregnancy"`（孕婦優先車位），避免混入另一種車位。定位後依直線距離排序，沒有座標的停車場不列入附近查詢；車位數不是即時空位。

### 服務入口 `open_official_service`

模型只選代號，網址一律由 [src/destinations.ts](../src/destinations.ts) 組出；只有 `townpass_library` 會帶 `keyword`（開站內圖書關鍵字搜尋），其他入口忽略。回傳 `source: "link"`、一筆紀錄，**不代表已開啟**：前端必須先讓使用者確認。

**台北通站內優先**：和 App 服務頁、帳務頁開的是同一組微服務頁面（`baseUrl` 預設為範本站）。頁面內容是範本示範資料，`source_note` 會照實說明。

| 代號 | 站內服務 | 路徑 |
| --- | --- | --- |
| `townpass_report` | 有話要說（陳情） | `/citizen-report/` |
| `townpass_disaster` | 災情通報 | `/disaster-report` |
| `townpass_apply` | 申辦服務 | `/` |
| `townpass_counter` | 臨櫃叫號 | `/counter-calling/` |
| `townpass_library` | 圖書借閱（有 keyword 時開關鍵字搜尋） | `/library-service/` |
| `townpass_subscription` | 市政訊息訂閱 | `/subscription` |
| `townpass_police` | 警政服務 | `/police-report` |
| `townpass_coupon`、`townpass_ticket_wallet` | 優惠與票券、票券錢包 | `/coupon/`、`/ticket-wallet` |
| `townpass_faq` | 常見問題 | `/qna` |
| `fee`、`fee_water`、`fee_parking`、`fee_tax`… | 繳費（與帳務頁相同的各項目頁） | `/fee-payment/…` |

**台北通沒有對應微服務時才用官方網站**：`services_disabled`、`services_maternity`、`services_elderly`（台北服務通分類頁）、`call_1999`（App 內走 `1999agree` 的使用同意與撥號流程）。網址都在 2026-11-07 實際開啟確認過。

`list_townpass_services` 只列站內頁面與連結、不含示範資料，所以 App 預設也提供（「有哪些服務？」）。

## 回傳格式

```json
{
  "source": "live",
  "source_label": "即時資料",
  "source_note": "來自台北市公開資料的 YouBike 即時資訊，實際車輛數仍可能變動。",
  "source_url": "https://taipei-pass-service.vercel.app/surrounding-service/",
  "total": 12,
  "truncated": false,
  "records": [
    {
      "id": "500101001",
      "title": { "zh-Hant-TW": "YouBike2.0_捷運科技大樓站", "en": "YouBike2.0_捷運科技大樓站" },
      "fields": [{ "label": { "zh-Hant-TW": "距離", "en": "距離" }, "value": { "zh-Hant-TW": "120 公尺", "en": "120 公尺" } }],
      "url": "https://www.google.com/maps/search/?api=1&query=25.02,121.54"
    }
  ]
}
```

- `source` 是 `demo`、`snapshot`、`live` 或 `link`（官方入口），畫面要用 `source_label` 和 `source_note` 標示資料性質；真實資料的 `source_note` 已含提供機關、資料集、資料時間與授權條款顯名。
- `records[]` 只有 `id`、`title` 一定有；`description`、`category`、`author`、`fields`、`url` 依工具而定。`url` 是 `https://`，唯一例外是官方入口的 `tel:1999`。
- 文字已去掉上游的 HTML 標籤，每欄最多 500 字；`en` 放的是原文，不是翻譯。
- **查無資料：** `records` 是空陣列，`total` 是 0，不是錯誤。
- **失敗：** `isError: true`，`text` 是 `{"error":{"code","message","hint"}}`。
- **取消：** `signal` 中止時，`callTool` 直接 reject。

### 錯誤碼

| `code` | 意思 | 怎麼呈現 |
| --- | --- | --- |
| `INVALID_INPUT`、`INVALID_ARGUMENTS` | 參數不合法 | 請使用者補充或修正 |
| `LOCATION_UNAVAILABLE` | 拿不到裝置位置 | 請使用者說行政區或地名 |
| `UPSTREAM_ERROR` | 連不上資料來源或逾時 | 請稍後再試，不要說查無資料 |
| `UPSTREAM_FORMAT_CHANGED` | 資料格式不符合預期 | 同上 |
| `INTERNAL`、`TOOL_NOT_FOUND` | 程式問題 | 不該出現在正式畫面 |

## 前端注意事項

- **連結不等於資料存在：** 示範站是 SPA，不存在的頁面也回 HTTP 200。
- **座標可能不完整：** 部分停車場沒有座標，用定位查時不會出現。
- **下載量：** 第一次查停車場會載入官方資料檔約 2.9MB、YouBike 約 0.9MB，之後有快取；公廁資料打包在程式內，不需下載。
- **停車場：** 官方「剩餘車位」檔停在舊時間點，所以只用靜態欄位（總車位、身障與孕婦車位、費率），並在來源說明寫出官方資料時間。
- **公廁快照：** data.taipei 的 API 與 CSV 都沒有開放跨網域，WebView 讀不到，所以用 `node scripts/fetch-official-toilets.mjs` 產生 `src/data/toilets.generated.ts`，保留官方匯入日期；提交前可重跑更新。
- **資料授權：** 真實資料依《政府資料開放授權條款－第1版》顯名。示範站的資料來自 TownPass-Services，repo 沒有 LICENSE，授權仍待向主辦單位確認，App 預設不使用。

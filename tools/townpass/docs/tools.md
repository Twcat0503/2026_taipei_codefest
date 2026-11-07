# 工具契約

給 agent 與前端的對接文件。這裡的工具全部唯讀，不會送件、付款或預約。

工具直接在瀏覽器執行，不需要 server。agent 預設就會使用，第一次要先在這個目錄執行 `pnpm install`；設定 `VITE_TOOL_SOURCE=demo` 才改用 agent 內建的虛構資料。

```ts
const client = createAgentToolClient({ getLocation }); // 可傳 baseUrl、timeoutMs、fetchFn
await client.callTool({ name: "find_nearby_youbike", arguments: { near_me: true } }, { signal });
```

## 16 支工具

依 agent 的分流領域分組。`keyword` 省略或空字串代表列出全部；單次最多回 20 筆。

| 領域 | 工具 | 參數 | 資料性質 |
| --- | --- | --- | --- |
| library | `search_library_books` | `keyword` | 示範 |
| library | `get_library_book` | `book_id` | 示範 |
| library | `get_library_ranking` | 無 | 示範 |
| library | `list_library_branches` | `area?` | 示範 |
| library | `list_library_notices` | 無 | 示範 |
| services | `list_townpass_services` | `keyword?` | 服務清單，含只能到頁面操作的服務 |
| services | `search_application_services` | `keyword?` | 示範 |
| services | `search_service_counters` | `keyword?` | 示範，號碼不是現場實際叫號 |
| services | `search_faq` | `keyword?` | 示範 |
| services | `search_fee_types` | `keyword?` | 示範，只能查類型，不能繳費 |
| services | `list_report_categories` | `kind`（`citizen`、`disaster`） | 示範 |
| services | `list_subscription_topics` | `keyword?` | 示範，只列主題，不代為訂閱 |
| perks | `search_perks` | `keyword?`、`kind?`（`hot_spot`、`ticket`、`coupon`） | 示範 |
| places | `find_nearby_youbike` | 見下方 | 即時 |
| places | `find_nearby_parking` | 見下方 | 快照，沒有即時空位 |
| places | `find_nearby_toilets` | 見下方 | 快照 |

`find_nearby_*` 的參數是 `near_me`、`radius_m`（預設 1000）、`area`、`keyword`。

- **定位不經過模型：** 模型只會設 `near_me: true`，座標由呼叫端的 `getLocation` 在瀏覽器內取得，只用來算距離。
- 沒有 `area` 和 `keyword` 時一律視為問附近。拿不到定位會回 `LOCATION_UNAVAILABLE`，agent 會請使用者改說行政區。
- 只有定位時才依距離排序；`area` 和 `keyword` 只做文字比對。

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

- `source` 是 `demo`、`snapshot` 或 `live`，畫面要用 `source_label` 和 `source_note` 標示資料性質。
- `records[]` 只有 `id`、`title` 一定有；`description`、`category`、`author`、`fields`、`url` 依工具而定。`url` 一定是 `https://`。
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
- **下載量：** 第一次查附近設施會載入資料檔：廁所約 2.6MB、停車場約 1.1MB、YouBike 約 0.9MB，之後有快取。
- **資料授權：** 示範站的資料來自 TownPass-Services，repo 沒有 LICENSE，授權仍待向主辦單位確認。

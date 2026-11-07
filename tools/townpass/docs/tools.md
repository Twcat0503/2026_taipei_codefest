# 工具契約

給 agent 與前端的對接文件。這裡的工具全部唯讀，不會送件、付款或預約。

agent 設定 `VITE_TOOL_SOURCE=townpass` 就會使用，第一次要先在這個目錄執行 `pnpm install`。工具直接在瀏覽器執行，不需要 server。

## 工具

```ts
const client = createAgentToolClient(); // 可傳 baseUrl、timeoutMs、fetchFn
await client.callTool({ name: "search_books", arguments: { query: "神奇" } }, { signal });
```

參數只有 `query`，空字串代表瀏覽全部，單次最多回 20 筆。

| 工具 | 查詢內容 | `records` 欄位 |
| --- | --- | --- |
| `search_books` | 書名、著者、出版項、主題、ISBN | `id`、`title`、`author`、`category` |
| `search_services` | 申辦項目 | `id`、`title`、`description`（可能是空字串） |

`search_services` 有兩種特殊關鍵字：

- `申辦`、`申請`、`服務`、`申辦服務` 視為瀏覽全部。
- `叫號`、`臨櫃`、`臨櫃叫號`、`取號`、`櫃檯` 改回傳櫃檯據點，`title` 是據點名稱，`description` 是類別和地址。不含示範號碼。

成功：

```json
{
  "content": [{
    "type": "text",
    "text": "{\"source\":\"demo\",\"records\":[{\"id\":\"lib-book-5\",\"title\":{\"zh-Hant-TW\":\"歡迎光臨錢天堂 : 神奇柑仔店大圖鑑\",\"en\":\"歡迎光臨錢天堂 : 神奇柑仔店大圖鑑\"},\"author\":{\"zh-Hant-TW\":\"廣嶋玲子文 ; jyajya圖 ; 王蘊潔譯\",\"en\":\"廣嶋玲子文 ; jyajya圖 ; 王蘊潔譯\"},\"category\":{\"zh-Hant-TW\":\"兒童故事\",\"en\":\"兒童故事\"}}]}"
  }]
}
```

- **查無資料：** `records` 是空陣列，不是錯誤。
- **失敗：** `isError: true`，`text` 是 `{"error":{"code","message","hint"}}`。
- **取消：** `signal` 中止時，`callTool` 直接 reject。
- **英文：** 資料只有中文，`en` 放的是原文，不是翻譯。

## 資料層

下面的方法在 `src/services/` 已實作並有測試，但還沒開放給 agent。要開放時，在 `agent-client.ts` 加對應工具，agent 端也要加白名單和驗證。

| 方法 | 參數 | 資料性質 |
| --- | --- | --- |
| `library.search` | `keyword`、`limit` | 示範 |
| `library.getBook` | `bookId` | 示範 |
| `library.ranking` | `limit` | 示範 |
| `library.branches` | `area`、`limit` | 示範 |
| `library.notices` | `limit` | 示範 |
| `civic.counters` | `keyword`、`limit` | 示範，號碼不是現場實際叫號 |
| `civic.faq` | `keyword`、`limit` | 示範 |
| `civic.applications` | `keyword`、`limit` | 示範 |
| `civic.fees` | `keyword`、`limit` | 示範，只能查類型，不能繳費 |
| `civic.reportCategories` | `kind`（`citizen`、`disaster`）、`limit` | 示範 |
| `civic.perks` | `keyword`、`kind`（`hot_spot`、`ticket`、`coupon`）、`limit` | 示範 |
| `places.youbike` | 見下方 | 即時 |
| `places.parking` | 見下方 | 快照，沒有即時空位 |
| `places.toilets` | 見下方 | 快照 |

`places.*` 的參數是 `{ lat, lng, radius_m, area, keyword, limit }`，至少要給座標、`area` 或 `keyword` 其中一項。只有給座標時才依距離排序，問「附近」或「最近」時必須給座標；沒給座標時 `distance_m` 是 `null`。

### 回傳格式

列表方法：

```json
{
  "status": "found",
  "total": 2,
  "count": 1,
  "truncated": true,
  "data_source": { "kind": "demo", "label": "示範資料", "note": "……" },
  "source_url": "https://taipei-pass-service.vercel.app/…",
  "results": []
}
```

- `status` 是 `found` 或 `not_found`。`library.getBook` 沒有列表欄位，資料放在 `book`，查無資料時是 `null`。
- `data_source.kind` 是 `demo`、`snapshot` 或 `live`。回覆使用者時要說明資料性質。
- 失敗時丟出帶 `code` 的錯誤，工具入口會轉成上面的錯誤格式。

### 錯誤碼

| `code` | 意思 | 怎麼呈現 |
| --- | --- | --- |
| `INVALID_INPUT` | 參數不合法 | 請使用者補充或修正 |
| `UPSTREAM_ERROR` | 連不上資料來源或逾時 | 請稍後再試，不要說查無資料 |
| `UPSTREAM_FORMAT_CHANGED` | 資料格式不符合預期 | 同上 |
| `INTERNAL` | 內部錯誤 | 同上 |
| `TOOL_NOT_FOUND`、`INVALID_ARGUMENTS` | 工具入口的呼叫錯誤 | 屬於程式問題，不該出現在正式畫面 |

## 前端注意事項

- **不要用 `v-html`：** `civic.fees` 的 `notice` 含有上游的 HTML 標籤。
- **連結不等於資料存在：** 示範站是 SPA，不存在的頁面也回 HTTP 200。
- **座標可能不完整：** 部分停車場沒有座標，用座標查時不會出現。
- **下載量：** 目前只載入圖書、申辦和櫃檯資料。之後接附近設施時，廁所約 3.3MB、停車場約 1.4MB、YouBike 約 1MB。
- **資料授權：** 示範站的資料來自 TownPass-Services，repo 沒有 LICENSE，授權仍待向主辦單位確認。

# 共用服務工具庫

沒有專用工具的微服務，由統一後端載入實際頁面或 API 文件，交給主機上的模型解析成工具，保存後供所有客戶端共用。不是手寫服務描述檔，也不是只產生導頁連結。

> **開發狀態：主機解析的計畫契約已通過四服務實模型驗收（連續三次）。** 主機解析使用 LFM3 1.7B（Q4_0），模型只選擇觀測到的控制項與操作，工具步驟由程式組出。手機對話模型選工具至原生頁面執行的完整鏈路尚未驗證；Android 裝置上的原生測試未在本次修改後重跑；工具名稱與參數的語意品質仍需更多服務驗證。

## 分工

1. 客戶端送出服務 URL，後端先查詢已保存的定義。
2. 未解析過的服務才會載入來源並呼叫解析模型。同一 URL 的同時請求共用一次解析。
3. 後端保存並回傳工具的 `name`、`description`、`inputSchema`、`execution`。
4. **客戶端的對話模型**選工具、填參數；**客戶端執行器**發送 HTTP 請求或操作頁面，回傳服務的實際結果。

解析模型與對話模型分開設定。後端沒有 `/tools/call`，不代替使用者登入或操作服務，也不接收工具呼叫參數。既有 `PhoneModel`／`LocalModel` 接點不變。

## 啟動

### 1. 本機解析模型

先在工具庫主機啟動支援 OpenAI-compatible Chat Completions 與 `response_format: json_schema` 結構化輸出的模型。端點須以 `/v1` 結尾。

例如使用 [llama.cpp](https://github.com/ggml-org/llama.cpp) 與本機已有的 GGUF：

```sh
llama-server --model /path/to/model.gguf --host 127.0.0.1 --port 8088 --alias local-parser --ctx-size 16384 --jinja --reasoning off
```

此命令不下載模型；模型檔案、硬體加速參數與授權依實際部署選擇。`--reasoning off` 是 2026-11-08 四服務驗收連續三次通過時使用的設定；其他 runtime 或設定尚未驗收。其他 runtime 請使用相應設定，並確認能在客戶端的解析等待時間內回應。

### 2. 集中工具庫

從 repo 根目錄：

```sh
cd tools/townpass
pnpm install
pnpm exec playwright install chromium
```

Windows 已安裝 Edge 時，可省略 Chromium 安裝並設定 `PARSER_BROWSER_CHANNEL=msedge`。

PowerShell 啟動範例：

```powershell
$env:PARSER_MODEL_ENDPOINT = 'http://127.0.0.1:8088/v1'
$env:PARSER_MODEL_NAME = 'local-parser'
$env:PARSER_BROWSER_CHANNEL = 'msedge'
pnpm registry
```

POSIX shell：

```sh
PARSER_MODEL_ENDPOINT=http://127.0.0.1:8088/v1 PARSER_MODEL_NAME=local-parser pnpm registry
```

工具庫直接讀取程序環境變數，**不會自動載入 `.env`**。可用設定列於 [`../.env.example`](../.env.example)：

| 變數 | 用途／預設 |
| --- | --- |
| `PARSER_MODEL_ENDPOINT` | 必填，主機上的模型 `/v1` 端點 |
| `PARSER_MODEL_NAME` | 模型名稱，預設 `local-parser` |
| `PARSER_BROWSER_CHANNEL` | 空白使用 Playwright Chromium；Windows 可用 `msedge` |
| `TOOL_REGISTRY_HOST` | 預設 `127.0.0.1` |
| `TOOL_REGISTRY_PORT` | 預設 `7331` |
| `TOOL_REGISTRY_FILE` | 預設 `data/services.json`，相對於程序工作目錄 |

手機連線時，將工具庫監聽位址改成主機的 LAN 位址或 `0.0.0.0`，客戶端使用主機實際 IP；手機的 `127.0.0.1` 不是這台主機。解析模型仍可只監聽主機 loopback。HTTPS 客戶端連工具庫時，工具庫也需使用可存取的 HTTPS 入口，避免 mixed content。

目前是單一程序的 JSON 持久化工具庫，未包含帳號或公開網路部署的存取控制；請在受控的開發網路使用。不要讓多個程序共用寫入同一份資料檔。

### 3. 客戶端

在 `frontend/agent-mvp` 的環境設定中加入：

```dotenv
VITE_TOOL_REGISTRY_URL=http://127.0.0.1:7331
```

手機使用主機的 LAN URL。重新啟動 Vite 或重新建置後生效。未設定時維持既有工具流程；`VITE_TOOL_SOURCE=demo` 的純 fixture 模式不使用工具庫。

對話中貼上服務 URL，例如「用 https://service.example/search 查詢……」，Agent 會先解析該 URL，再將共用工具提供給客戶端模型。已保存的工具也會在後續請求中列出，不必每個客戶端重建。

## HTTP 介面

### `POST /services/resolve`

```json
{ "url": "https://service.example/search" }
```

回傳 `ServiceDefinition`：

```ts
type ServiceDefinition = {
  url: string;
  title: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
      [keyword: string]: unknown;
    };
    execution: ServiceExecution;
  }>;
};
```

同一標準化 URL 有紀錄就直接回傳；沒有才解析並保存。工具名稱加入服務 URL 的 namespace，避免不同服務的同名操作衝突。觀測、模型請求或輸出結構檢查失敗時回傳錯誤，不保存該次結果、不改成導頁工具，也不自動重試。

生成契約：**模型只做選擇，步驟由程式組出。** 模型不直接寫入 `execution`。

- **頁面**：模型只回傳一個工具的 `name` 與 `description`，並用觀測到的選擇器指定：`controls`（輸入控制項對應的參數名稱）、`submit`（送出的按鈕或連結）與 `resultSelector`（回應區）。輸入控制項限於 input、select、textarea；參數型別取自控制項，下拉選單的選項值成為 `enum`，描述取自觀測到的標籤。步驟依頁面順序產生，送出按鈕固定為最後一步。
- **JSON API 文件**：模型只能從文件中已列出的操作（`METHOD URL`）選擇，並為工具命名。參數、URL、query 與 JSON body 的綁定由程式依 OpenAPI 定義產生，body 欄位與請求 schema 的屬性名稱一致。
- 輸出經 schema 驗證後由程式組裝；保存前用客戶端相同的 JSON Schema 編譯器檢查，並確認 required、argument 綁定與 URL path placeholder 都引用已宣告的參數。工具名稱與參數名稱限制為識別字（字母開頭，英數與底線），在生成時即受 schema 約束。

**後端不會替使用者試執行工具**。上述檢查不能證明操作語意正確；工具名稱、描述與參數的選擇仍需端到端驗收，`resolve` 成功不等於服務操作已驗收成功。

### `GET /tools`

回傳 `{ "tools": [...] }`，內容為所有已保存服務的工具。工具庫重啟會從資料檔載入，不重新解析。服務內容更新時，目前不會自動使已保存的工具失效或重建。

## 執行描述

完整型別位於 [`../src/registry/types.ts`](../src/registry/types.ts)。以下是協定說明，**不需要替每個服務手寫**。

參數綁定使用 `{ "argument": "參數名" }`；固定值使用 `{ "literal": 值 }`。

- **HTTP**：`kind: "http"`，包含絕對 `url`、`method`，可附 `query`、`headers`、`body`。URL path 的 `{參數名}` 會編碼替換；body 可用 JSON 或 `encoding: "form"`。客戶端以 `inputSchema` 檢查參數後直接 `fetch`。cookies 採瀏覽器標準的 `same-origin` 行為，仍受服務的 CORS 規則限制。
- **頁面**：`kind: "browser"`，包含頁面 `url`、`steps` 與 `resultSelector`。步驟支援 `fill`、`select`、`check`、`click`，使用觀測到的 CSS selector；可等候非同步欄位及連動選項。結果取自服務頁面的文字，不由模型編造成功訊息。

模型只產生操作資料，不產生任意 JavaScript。固定的客戶端執行程式負責欄位事件與結果讀取。

App 透過 `service_execute` bridge 開啟既有 `TPWebView`，執行後回到助手；使用者關閉頁面或取消時，不會當成操作成功。純瀏覽器使用同源 iframe；跨來源頁面操作會明確要求在 App 中使用，不使用後端 proxy 規避瀏覽器限制。

## 支援範圍與限制

- 可觀察 JavaScript 渲染後的欄位、按鈕、選項、文字，或讀取 JSON API 文件，再由模型推導操作。
- 目前只觀察所提供的單一 URL；不自動爬取整個網站、不解析 YAML OpenAPI、不代為登入或解驗證碼。
- DOM 執行限同一份 document 的操作；會整頁跳轉的表單、多頁精靈、檔案上傳、radio 群組與複雜自訂控制項不在目前支援範圍。
- 每個頁面只產生一個工具；一頁有多個獨立操作時，目前只能選擇其中一個，尚未支援多操作頁面。
- 以未用於調整提示的 5 個新服務測試（每個 5 次，共兩輪）：2 個每次通過，3 個每次失敗。失敗原因是漏掉 `type="time"` 與 `type="tel"` 的輸入控制項，以及 OpenAPI 同一操作被重複提供為兩個工具。同一輸入的輸出每次相同，因此這些失敗是系統性的。四服務驗收的結果不能代表新服務的穩定性。
- OpenAPI 目前只支援 JSON 規格、基本型別（string、number、integer、boolean）、form/explode 的 query，以及 JSON 物件的 request body；不支援 YAML、Swagger 2、`$ref`、巢狀物件、陣列參數、header／cookie 參數與非 JSON 的 body。不支援的操作不會提供給模型，全部不支援時回報原因。
- 結果須是可見且非空的文字；點擊後會等待結果文字或結果區更新。若頁面沒有可觀測的更新，會逾時，而非聲稱完成。
- 共用工具不保存使用者 session。需要登入的操作仍取決於客戶端服務頁的登入狀態；尚未驗證各服務的登入／跨站 cookie 行為。
- 目前沒有送件、付款等操作的額外確認介面，不應把這些高影響操作宣稱為已驗收可用。
- 自動解析依賴模型品質，不能保證任意網站都能正確產生工具；端到端測試應核對目標服務實際收到的參數與回應，而非只看模型輸出合法 JSON。

## 驗證

工具庫：

```sh
cd tools/townpass
pnpm typecheck
pnpm test
```

客戶端：

```sh
cd frontend/agent-mvp
pnpm test
pnpm lint
pnpm build
```

從 `tools/townpass` 執行真實模型驗收（先設定上面的 `PARSER_MODEL_*`）：

```sh
pnpm exec tsx ../../frontend/agent-mvp/scripts/verify-service-registry.ts
```

此腳本提供四個**本機測試微服務**（日期查詢、圖書查詢、多欄位課程查詢、OpenAPI JSON POST），使用真實解析模型建立工具，再讓兩個瀏覽器客戶端以不同值各自執行。它核對服務實收的日期、關鍵字、下拉選項、數字、布林值、HTTP method、JSON body 與請求次數，以及共用定義、解析次數與持久化重載；生成工具的參數數量與步驟順序也會核對。回覆只取客戶端結果紀錄中的實際內容，依序重組分段後完整比對，不以工具標題或描述命中關鍵字當作成功。參數由測試腳本填入，不由對話模型選擇；測試服務會清楚回傳測試資料。這不等同真實市政服務或手機對話模型的實機驗收。

Flutter 的 service 與同路由開頁測試位於 `test/service_tool_service_test.dart`。原生邊界另有 `integration_test/service_tool_webview_test.dart`，在 repo 根目錄執行：

```sh
fvm flutter test integration_test/service_tool_webview_test.dart -d <android-device-id>
```

原生測試使用真實 `TPWebView`、正式 `service_execute` bridge 及裝置內的測試 HTTP server，驗證兩組參數、回傳錯誤、關閉取消與回到原助手。其操作腳本是測試 fixture，不包含解析模型、前端 AgentRunner 或手機模型；不能把兩組邊界驗收合稱為手機完整端到端。

### 2026-11-08 驗收結果

- 目前版本（計畫契約）：工具庫型別檢查通過，7 個測試檔 70 項測試通過；前端 `vue-tsc`、ESLint、Prettier 與 9 個測試檔 112 項測試通過。
- 前一修訂：Flutter 在 ASCII 路徑的暫存副本中完成分析與 20 項測試，分析零問題；本次修改後未重跑。
- 前一修訂：Android API 36 模擬器的原生 WebView 整合測試 3 項通過，涵蓋實收參數、錯誤及取消後再操作。首次冷啟動曾出現 ANR，當時主機記憶體緊張，未確定根因；最終串行重跑通過且沒有新增 ANR。之後新增的取消、關閉、返回與覆蓋頁整合案例只完成靜態分析，尚未在裝置上執行。
- 真實模型驗收：主機解析使用 LFM3 1.7B（Q4_0）、推理關閉，四服務嚴格驗收（日期查詢、圖書查詢、多欄位課程查詢、OpenAPI POST）連續三次全部通過。每次都核對服務實收的參數、HTTP method、JSON body 與請求次數，並核對生成工具的參數數量與步驟順序。
- 更早的生成方式（模型直接寫入步驟）在三次嚴格執行中未通過：各服務最多通過一次。常見失敗包括多餘參數、同一按鈕重複送出、缺少送出步驟、把一個操作拆成多個工具、把常數當成參數，以及 OpenAPI body 照抄文件結構。改為計畫契約後，這些錯誤在結構上不再可能出現，但解析內容仍需驗收。
- 提示與驗收都使用同一組四個本機測試服務，因此這些結果不能當作一般網站的能力證據。工具名稱與描述的品質（例如名稱過於籠統）仍需更多服務驗證。
- 驗收腳本會比對服務實收的請求與回覆，也會核對生成的參數數量與步驟順序；只通過 JSON 驗證不作為成功依據。未以去重、重試或手動工具掩蓋任何失敗。
- 早期舊驗收曾因工具描述命中關鍵字而假通過，現已改為只比對服務實際回覆。
- 驗收腳本以服務實際回覆比對，並核對生成工具的操作形狀；相關單元測試先紅後綠。單元測試不是模型品質證據。
- 正式前端 build 已通過，新增真實 CSS build 回歸，確認 design tokens 與應用樣式均保留。MVP 使用原生 CSS，以本地 PostCSS 設定避免誤載父層 Tailwind 設定；沒有新增套件或修改父層設定。
- 預設格式檢查仍受既有 Windows CRLF 換行影響；使用 `--end-of-line auto` 的檢查通過。未批次重寫既有檔案。build 的兩則 Zod Rollup annotation 警告不影響建置成功。

## 新增相依套件

- [Playwright](https://github.com/microsoft/playwright)，Apache-2.0：後端需要載入並執行服務的 JavaScript，才能看到動態 DOM；單純 `fetch` HTML 不足以完成這項觀測。
- [tsx](https://github.com/privatenumber/tsx)，MIT，開發相依：直接執行 TypeScript 工具庫入口與聯調腳本，沿用現有 Node／TypeScript 程式碼，不新增另一套後端框架。

兩者授權皆可與本專案 AGPL-3.0 組合。

# 城市通 Agent MVP

Vue agent、聊天介面與 Android 手機模型已整合。工具透過 `ToolClient` 直接呼叫，**App 預設只用真實資料**：YouBike 即時資料、停管處停車場資料（含身障、孕婦車位）、環保局公廁資料（含無障礙、親子廁座與照護床），以及官方服務入口。要辦的事會帶到**台北通站內的微服務**（有話要說、繳費、臨櫃叫號、圖書借閱、訂閱、報案、優惠等，和 App 服務頁開的是同一組頁面）；台北通沒有對應服務的才導到官方網站（台北服務通的身障／孕婦／長者服務、1999）。助手會顯示要去哪裡，**使用者按「前往」才離開**；站內頁面的示範資料會照實標示，不會拿來當回答。

## 啟動

```sh
cd tools/townpass
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
cd ../../frontend/agent-mvp
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

開啟 <http://127.0.0.1:5173>。瀏覽器未設定模型接點時為規則模擬，不是 AI；App 內預設手機模型，需按「啟動手機模型」。設定 → 開發者檢視可切換模型，連線失敗不會自動降級為模擬答案。

- 預設工具來源為 `tools/townpass` 的真實資料工具與官方入口（`includeDemo: false`）。
- `VITE_TOOL_SOURCE=townpass-demo` 會加回示範站的模擬資料工具與示範帳單，只供開發比對；`VITE_TOOL_SOURCE=demo` 為完全虛構的圖書／服務／帳單，供 UI 與預約草稿測試。
- `VITE_MODEL_ENDPOINT`、`VITE_MODEL_NAME`、`VITE_MODEL_PROTOCOL` 控制電腦模型。接點只接受 loopback；`VITE_*` 會進入瀏覽器 bundle，不可放秘密。
- 手機 LFM3 使用動態接點與記憶體中的 Bearer key，不透過環境變數；見 [手機模型](docs/phone-model.md)。

## 流程與分工

繁中／英文需求 → 路由 → 圖書、服務、優惠、地點或帳單專家 → 白名單與參數檢查 → 工具 → 顯示驗證過的結果。地點查詢為兩次模型推論；官方入口在原話已明確時（例如「陳情」「繳水費」）只需路由一次，入口由 [`skills/navigation.ts`](src/agent/skills/navigation.ts) 的規則決定，模型選錯時以原話為準。館藏查詢的關鍵字必須原樣出現在使用者原話裡，否則只開館藏首頁。對不上任何官方入口時回覆「目前不支援」，不會隨便帶去某個網站。

離開助手一律要第二次確認：官方入口卡片有「前往／先不要」，結果卡片上的地圖或服務連結也會先問「要離開助手，開啟某網站嗎？」。App 內透過 `open_link`（電話走 `phone_call`）開啟，關閉該頁回到原對話。Google 地圖不支援在 WebView 顯示（會轉成 `intent://`），所以地圖連結走 `launch_map` 交給地圖 App；`TPWebView` 也會把其他網站的 `intent://`、`tel:` 等連結交給系統。

| 範圍          | 接點                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------- |
| Agent harness | `src/agent/runner.ts`：分流、上下文隔離、逾時、取消、位置／帳單補問                       |
| 手機模型      | `PhoneModel`：啟動、狀態、授權、推論、停止與取消                                          |
| 電腦模型      | `LocalModel`：OpenAI-compatible Chat Completions，JSON schema 或原生 tool calls           |
| 工具層        | `ToolClient` in `src/agent/tool-client.ts`；隊友實作在 `tools/townpass/`                  |
| 結果驗證      | `src/agent/tools.ts`，工具清單與 schema 見 [工具文件](../../tools/townpass/docs/tools.md) |
| UI            | `src/App.vue`、`src/i18n.ts`、`src/style.css`；保留 `BillPanel` 與 `PhoneModelPanel`      |

`new AgentRunner(model, state, toolClient)` 是整合入口。`withDemoBills` 把示範帳單加到隊友工具清單；接正式帳務時應替換此組合，不能把真實帳單標成 demo。工具是直接函式呼叫，尚無 MCP transport／server；未來 MCP 可實作相同 `ToolClient` 介面。

模型每次最多 256 output tokens，電腦預設 20 秒、手機 90 秒；工具發現與執行各最多 45 秒，涵蓋定位及上游讀取。取消後晚到的結果不能更新畫面。位置只供工具層計算距離，不送進模型；定位失敗可補充行政區，或切換新需求。對明確地點查詢有保守的路由修正，並保留使用者指定的台北市行政區及無障礙廁所條件，避免小模型漏掉條件。

對話及 trace 只留記憶體；localStorage 只保留閱讀偏好與已驗證的示範預約草稿／回執，不保存帳單、位置或模型 key。內部路由與專家提示為英文，保留原始中文名稱；上游工具 schema／資料可能含中文。畫面只呈現工具資料，不呈現模型自由生成的完成宣告。

## 替民眾帶入資料

前往台北通站內服務時，已知的欄位會在開頁後自動填好，不用重新輸入（[`agent/prefill.ts`](src/agent/prefill.ts)）：

- **水費**：第一次在確認卡輸入水號，勾選「記住」後存在這支手機（[`platform/profile.ts`](src/platform/profile.ts)），下次直接帶入；設定的「我記住的資料」可以刪除。
- **國／社宅租金、平價住宅維護費、聯合醫院醫療費**：身分證字號每次從台北通會員資料（`userinfo` bridge）讀取，畫面遮罩顯示，不寫入儲存空間。
- **陳情（有話要說）**：依民眾的原話整理主旨、描述與發生地點（[`skills/report-draft.ts`](src/agent/skills/report-draft.ts)，規則式、不另外推論，不編造沒說過的內容），在確認卡上可修改；前往時直接開「其他事項（自動選擇案件類別）」填寫頁並填好，送出仍由民眾按。

App 端（`lib/util/tp_prefill.dart`）只在台北通站內網域、只填白名單欄位：號碼類（`water_number`、`tax_id`）限英數與連字號，文字類（`title`、`description`、`location`）限長度且不含控制字元；值一律以 JSON 資料嵌入，不會被當成程式執行。用結構化欄位而不是向量式 RAG：號碼要精確、需要哪個欄位由目的地決定，也不增加手機記憶體負擔。

## 壓力測試

`pnpm stress:phone` 量測手機模型與完整流程的延遲、token 吞吐量，以及 App／模型行程的記憶體、CPU、溫度與電量；用法見 [`scripts/stress-phone.js`](scripts/stress-phone.js) 開頭說明。結果寫在 `stress-results/`（不進 git）。

## 手機聯調

```sh
# repo 根目錄；電腦仍需提供 Vue 頁面
adb reverse tcp:5173 tcp:5173
fvm flutter run -d <device-id>
```

手機模型模式不需要 Mac Ollama。若選電腦模型，才需要另啟動 Ollama 並 `adb reverse tcp:11434 tcp:11434`。開發版的頁面透過 USB 存取電腦，不等於正式靜態站部署。正式整合沿用 TPWebView，部署 HTTPS 並設定 `AGENT_WEB_URL`；不將 dist 打包進 Flutter assets。HTTPS 頁面到手機 loopback 的限制需另行驗證。

## 驗證

```sh
# tools/townpass
mise exec -- pnpm typecheck
mise exec -- pnpm test
# frontend/agent-mvp
mise exec -- pnpm lint
mise exec -- pnpm test
mise exec -- pnpm build
mise exec -- pnpm exec playwright install chromium
mise exec -- pnpm test:e2e
```

E2E 使用獨立埠，不共用開發伺服器。手機 adapter 有橋接、授權、取消與逾時測試；CI 保留 Flutter 測試及 APK 建置。歷史 Qwen 評測 JSON 保留在 docs，僅為當時回歸紀錄，不代表新增工具的手機模型準確率。

限制：個人帳務／登入／付款／真實預約未接入，改帶使用者到官方網站自行操作；停車場官方資料的剩餘車位已停更，只顯示格位總數；公廁為官方資料的日期快照（重跑 `tools/townpass/scripts/fetch-official-toilets.mjs` 更新）。Vue 尚未串接原生 TTS，App 內需使用 TalkBack；自動 axe 通過不等於完整無障礙認證，TalkBack 與持續耗電／熱測試仍待進行。

詳細契約見 [API 盤點](docs/api-status.md)、[帳單 skill](docs/skills/bills.md)、[UI 交接](docs/ui-ux-handoff.md)。

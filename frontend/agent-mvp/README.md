# 城市通 Agent MVP

Vue agent、聊天介面與 Android 手機模型已整合。隊友的 16 個唯讀工具透過 `ToolClient` 直接呼叫；個人帳單另保留明確標示的 demo 工具，尚未接正式帳務或登入。

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

- 預設工具來源為 `tools/townpass`，包含示範站資料、停車場／公廁快照與 YouBike 即時資料。不是所有工具都是真實服務 API。
- `VITE_TOOL_SOURCE=demo` 可切換完全虛構的圖書／服務／帳單，供 UI 與預約草稿測試。預設工具模式不顯示示範預約按鈕。
- `VITE_MODEL_ENDPOINT`、`VITE_MODEL_NAME`、`VITE_MODEL_PROTOCOL` 控制電腦模型。接點只接受 loopback；`VITE_*` 會進入瀏覽器 bundle，不可放秘密。
- 手機 LFM3 使用動態接點與記憶體中的 Bearer key，不透過環境變數；見 [手機模型](docs/phone-model.md)。

## 流程與分工

繁中／英文需求 → 路由 → 圖書、服務、優惠、地點或帳單專家 → 白名單與參數檢查 → 工具 → 顯示驗證過的結果。一般查詢為兩次模型推論，工具完成後直接呈現，不再要求模型生成結語。按鈕選帳單類別、重試與查看書籍詳情不需要模型。

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

限制：個人帳務／登入／付款／真實預約未接入；公廁與停車場是更新時間未知的快照。Vue 尚未串接原生 TTS，App 內需使用 TalkBack；自動 axe 通過不等於完整無障礙認證，TalkBack 與持續耗電／熱測試仍待進行。

詳細契約見 [API 盤點](docs/api-status.md)、[帳單 skill](docs/skills/bills.md)、[UI 交接](docs/ui-ux-handoff.md)。

# 城市通 Agent MVP

UI／UX 隊友請先看 [交接文件與流程圖](docs/ui-ux-handoff.md)，可不用模型與 Flutter 直接修改介面。

本工作區負責 **agent orchestration 與無障礙操作介面**。**LLM 推論與工具由隊友實作**；這裡的 Ollama adapter 和 DemoToolClient 是聯調替身，不是團隊的正式模型或工具。

目前可用：繁體中文／英文需求 → 路由代理 → 圖書或服務代理 → 驗證工具結果 → 本地化呈現。圖書可接續「選書 → 修改取書館 → 預覽確認 → 本機示範回執」，可重開續填。所有館藏、分館及服務都是自製虛構資料，沒有呼叫臺北通正式 API，也沒有送出真實預約。

## 啟動

```sh
cd frontend/agent-mvp
mise trust
mise install
mise exec -- pnpm install
mise exec -- pnpm dev
```

開啟 <http://127.0.0.1:5173>。沒有 `.env.local` 時預設是**規則模擬，不是 AI**。頁面下方「開發者檢視與接點設定」可以切換；失敗時不會偷偷改用模擬答案。

電腦上的真實小模型測試（先安裝 Ollama）：

```sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 ollama serve
# 另一個終端機
ollama pull qwen3:1.7b
cp .env.example .env.local
# 將 VITE_MODEL_ENDPOINT 設為 http://127.0.0.1:11434/v1/chat/completions
mise exec -- pnpm dev
```

目前本機已建立不進 git 的 `.env.local`，選用 Qwen3 1.7B。`VITE_*` 會進入瀏覽器 bundle，**不可放 API key**。接點僅接受 loopback，避免誤送雲端；同源／CORS、HTTPS 混合內容限制由執行環境處理，adapter 不會繞過瀏覽器限制。

## 隊友交接邊界

| 負責方          | 介面／檔案                                 | 契約                                                                   |
| --------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| 我們的 agent    | `src/agent/runner.ts`                      | 分流、隔離上下文、步數上限、取消、工具白名單與驗證                     |
| 隊友 LLM        | `ModelAdapter` in `src/agent/types.ts`     | 接收 messages/tools/signal，回傳 calls 或完成狀態                      |
| 暫時的 LLM 接點 | `src/agent/model.ts`                       | OpenAI-compatible `/v1/chat/completions`，可換模型名稱與協定           |
| 隊友工具        | `ToolClient` in `src/agent/tool-client.ts` | 提供 listTools / callTool；目前由 `tools/townpass/` 以直接函式呼叫實作 |
| 我們的執行層    | `src/agent/tools.ts`                       | 固定服務契約、參數與結果檢查、預覽／確認，不接受任意工具               |
| 使用者介面      | `src/App.vue`, `src/i18n.ts`               | 繁中／英文、可調字級、進度、確認與錯誤呈現                             |

接入點為 `new AgentRunner(modelAdapter, state, toolClient)`。App 預設透過 `tools/townpass/src/agent-client.ts` 查台北通示範站；設定 `VITE_TOOL_SOURCE=demo` 時改用 DemoToolClient 的虛構資料（e2e 使用）。第一次使用前要在 `tools/townpass/` 執行 `pnpm install`。工具契約見 [tools/townpass/docs/tools.md](../../tools/townpass/docs/tools.md)。

### LLM

- `VITE_MODEL_PROTOCOL=json-schema`：目前實測模式，以 `response_format.json_schema` 限制輸出，再轉成內部 ToolCall。傳送 `reasoning_effort: none`，提示使用 `/no_think`；隊友的後端需支援這些功能，或自行提供 ModelAdapter。
- `VITE_MODEL_PROTOCOL=tools`：傳送原生 `tools`，解析 `message.tool_calls`；不送 Ollama 的關閉思考設定。此模式有解析器測試，尚未對隊友模型驗證。
- 每次呼叫限制 256 output tokens、20 秒 timeout，一個回應只接受一個工具；路由一次、專家最多三次。一般成功查詢是三次模型呼叫。
- 不是載入多份模型：同一模型以不同英文 system prompt 執行路由／專家角色，順序呼叫，專家取得新上下文。中文原始需求、書名及工具資料作為資料保留，避免翻譯破壞搜尋。UI 回答由字典與已驗證資料產生，不呈現模型思考過程。
- 小模型 JSON 格式正確不代表分類一定正確；英文提示與少量範例只改善已測情境，仍需隊友模型的獨立評測。

### 工具

`ToolClient` 是 agent 呼叫工具的介面，目前的實作都是直接函式呼叫。代理從 listTools 發現工具，再與本地白名單 `TOOLS` 取交集，只提供分流領域內的工具；不把工具描述當 system 指令。領域與工具見 [tools/townpass/docs/tools.md](../../tools/townpass/docs/tools.md)。

- 工具結果必須是 `source` 為 `demo`、`snapshot` 或 `live`，`records` 不超過 20 筆，每筆有 `id` 與雙語 `title`，`url` 一定是 `https://`。
- 畫面只呈現驗證過的記錄與資料來源標示；模型只收到前 5 筆的 `id` 與標題，不收到完整資料。
- 附近查詢時模型只能設 `near_me`，定位在瀏覽器取得，不傳給模型；拿不到定位會請使用者改說行政區。
- 決策過程（分流、提供的工具、工具呼叫與參數、筆數、失敗原因）顯示在每則回覆的「決策過程」，只留在記憶體。

**示範預約只能從 `demo` 書目開始**，不可把正式資料偽裝成 demo。接正式服務時需一起擴充來源、ID、分館與資料持久化契約；新增操作則要加白名單、驗證器與確認畫面。真實寫入的使用者授權、伺服器端冪等鍵、重試／逾時後的狀態查詢，需與工具隊友確認後實作。本機示範回執不等同服務成功。

## 臺北通 App 入口

手機開啟 **Town Pass 開發版 → 首頁或服務 → 安心助手**。這是本專案的開發版，不是修改商店下載的正式臺北通。

```sh
# repo 根目錄，先保持 Vue dev server 與 Ollama 啟動
adb reverse tcp:5173 tcp:5173
adb reverse tcp:11434 tcp:11434
fvm flutter run -d <device-id>
# 發布靜態站後，正式版必須指定 HTTPS 網址
fvm flutter build apk --release --dart-define=AGENT_WEB_URL=https://your-agent.example
```

Debug 預設 `AGENT_WEB_URL=http://127.0.0.1:5173`，只在 debug manifest 允許 loopback／模擬器主機的明文 HTTP。Release 沒有設定有效 HTTPS URL 就隱藏入口。開發時需保留 USB 與電腦服務；本機位址不是已部署的公開網站。正式 HTTPS 網頁呼叫手機本機推論的跨來源／混合內容限制仍須與 LLM 隊友驗證，必要時改經受控原生 bridge。

2026-11-07 已將 debug APK 安裝至 Pixel 10 Pro XL，從 App 內 TPWebView 成功完成真實模型查詢、修改分館、示範預約與重置；確認 `flutterObject.postMessage` 存在，WebView 顯示尚未提供 TTS 的提示。`fvm flutter analyze`、兩個 Flutter widget tests 與 debug APK 建置通過。

現有 API、原生 bridge 與模擬資料的差別見 [API 盤點](docs/api-status.md)。Flutter 入口驗證包括 WebView 路由／參數、無障礙點擊語意與 200% 字級；舊版未對應實際 App 的 counter 樣板測試已換成入口測試。

## Pixel／WebView 聯調

```sh
adb reverse tcp:5173 tcp:5173
adb reverse tcp:11434 tcp:11434
adb shell am start -a android.intent.action.VIEW -d http://127.0.0.1:5173 com.android.chrome
```

這個模式是 **手機跑 Vue agent 與畫面、Mac 跑推論**。拔掉 USB 就失去此連線，不代表模型已部署手機。隊友本機 LLM 到位後，換成手機 loopback 接點，另外量測冷啟動、記憶體、發熱、耗電與背景恢復。

模型候選為 Qwen3 1.7B Q4_K_M，已下載檔案 1,359,293,444 bytes（約 1.36 GB）。檔案大小不是執行期 RAM；本次未驗證 Tensor G5 加速、Android runtime 或持續推論效能。官方模型卡為 [Qwen/Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B)，Apache-2.0；Android runtime 可供隊友參考 [llama.cpp Android 文件](https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md)。測試接點遵循 [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)。

嵌入 TownPass 時沿用既有 `TPWebView`，正式版部署 HTTPS 靜態站，不將 dist 放 Flutter assets。已在開發版 App 的「首頁」及「服務」頁加入「安心助手」入口，沿用 TPWebView；未新增 native bridge。已偵測 `window.flutterObject`：WebView 不使用 browser speechSynthesis；目前顯示朗讀未提供；最新 App 已有 tts handler，Vue adapter 尚待串接。獨立瀏覽器可朗讀，聲音是否離線取決於系統語音引擎；沒有自製 ASR，可用手機鍵盤語音輸入。

## 驗證與限制

```sh
mise exec -- pnpm lint
mise exec -- pnpm test
mise exec -- pnpm build
mise exec -- pnpm exec playwright install chromium
mise exec -- pnpm test:e2e
# 需啟動真實本機模型，不在一般單元測試中下載或啟動模型
mise exec -- pnpm test:model
```

2026-11-07，Mac ARM64 / Ollama 0.17.5 / qwen3:1.7b：

- 單元測試 13/13、端到端測試 3/3，lint 與型別／正式建置通過。
- 真實模型 8/8 smoke cases：繁中／英文查書、精確書名、無結果、服務、叫號與不支援需求。中位數 1,692.5 ms；最大 1,783 ms；已暖機，非手機或通用能力基準。
- 初版有 2/8 查詢錯誤，原因是泛稱「圖書／books」被當成關鍵字；加入空查詢規則與範例後通過。這是已用於調整提示的回歸測試，不是獨立測試集準確率。重跑產生忽略進 git 的 `model-eval.latest.json`；基準記錄見 `docs/model-eval-2026-11-07.json`。
- Chromium 行動 viewport：首頁與確認頁 axe WCAG A/AA/2.1AA 無違規；繁中／英文 200% 字級不橫向溢出。一般桌面瀏覽器也已走真實模型查詢。
- 實體 Pixel 10 Pro XL（ADB 辨識，Android Chrome 443 CSS px）已完成真實模型查詢、修改分館、確認示範預約與重置；首頁 axe 無違規，200% 字級無橫向溢出。推論透過 USB 在 Mac 執行，非手機端效能測試。
- TalkBack、切換控制、實體手機手動無障礙測試與真正 WebView TTS 尚待驗證。自動檢查通過不等於 WCAG 全面符合。
- 語音／病歷等敏感資料不蒐集，對話不寫入 localStorage；只保存示範草稿／回執與閱讀偏好。開發者 trace 不記原始需求。模型服務端的記錄政策由 LLM 隊友負責。

新增直接相依：Vue、Vite、TypeScript、ESLint、Prettier、Vitest、Playwright、axe 等，用於 UI、建置與功能／無障礙測試；採 MIT、Apache-2.0、MPL-2.0 等開源授權，專案維持 AGPL-3.0。版本由 pnpm-lock.yaml 鎖定；模型不放進 git。

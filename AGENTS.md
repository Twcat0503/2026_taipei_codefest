# 用得了：城市通安心助手

**主要開發為 Vue3 前端**（`frontend/`）；repo 根目錄為 [taipei-doit/TownPass](https://github.com/taipei-doit/TownPass) 快照（不帶 upstream 歷史）之 Flutter 行動端專案（upstream 本體為 GPL-3.0）。**最終成品以 AGPL-3.0 授權**。

## 技術棧與版本

### 前端（主要開發，`frontend/`）

- Vue 3 + Vite + TypeScript + Tailwind CSS，以 [TownPass-Services](https://github.com/taipei-doit/TownPass-Services) 為範本（來源與授權狀態見 `frontend/README.md`）；lint／格式：ESLint + Prettier；測試：Vitest。
- Node 與 pnpm 版本由 `frontend/mise.toml` 釘選（`mise install` 安裝）；套件管理一律用 **pnpm**，不用 npm／yarn／bun。
- `mise.toml`、`package.json`、`pnpm-lock.yaml` 進 git；目錄結構與前端慣例見 `frontend/README.md`。前端開發在常駐的 `frontend` branch 進行。
- **設計基準：mobile-first**，以 Android 裝置 viewport 為主，Android Chrome 驗證。

### Flutter（行動端，repo 根目錄）

- Flutter **3.47.6**，版本來源：`.fvmrc`（用 FVM 管理，不要用系統 Flutter）。
- Dart SDK `>=3.13.0 <4.0.0`（見 `pubspec.yaml`）。
- 狀態管理／路由：`get`（GetX）；JSON 序列化：`json_serializable` + `build_runner`；asset 引用由 `flutter_gen_runner` 產生。
- **開發基準：Android 裝置**（模擬器或實體機）；iOS 為 best-effort，不作為 PR 門檻。

## 指令

### 前端（`frontend/`）

```sh
cd frontend
mise install   # 首次：安裝 mise.toml 釘選的 Node／pnpm
pnpm install   # 安裝相依
pnpm dev       # 開發伺服器
pnpm build     # 正式建置（含型別檢查）
pnpm lint      # ESLint（只檢查；pnpm lint:fix 會自動修正）
pnpm format    # Prettier（pnpm format:check 只檢查不改）
pnpm test      # Vitest（單次執行；pnpm test:watch 為監看模式）
```

### Flutter（repo 根目錄）

```sh
fvm install                      # 首次：安裝 .fvmrc 釘選的 Flutter
fvm flutter pub get              # 安裝相依
fvm dart run build_runner build  # 產生 *.g.dart 與 flutter_gen asset 引用（首次必跑）
fvm flutter devices              # 列出可用裝置（以 Android 為基準）
fvm flutter run -d <device-id>   # 執行於 Android 裝置／模擬器
fvm flutter analyze              # lint
fvm dart format lib test         # 格式化（CI 會檢查格式）
fvm flutter test                 # 全部測試
fvm flutter test test/widget_test.dart   # 單一測試檔
```

## 測試與 lint 現況（2026-11-08 實測）

- `fvm flutter analyze`：無任何 issue（exit code 0），新改動應維持零 issue。
- `fvm flutter test`：204 個測試全過，涵蓋安心助手入口（WebView 路由、無障礙點擊、200% 字級）、app shell、無障礙 bridge（`tts` 生命週期、`haptic`、`a11y_state`）、ASR／TTS 的 bridge 與 service、表單帶入、`userinfo` 來源檢查、`open_link` 帶入回覆、麥克風入口。
- `frontend/agent-mvp/`：`pnpm lint`、`pnpm test`（541 個）、`pnpm build`、`pnpm test:e2e`（47 個，含 axe 的 WCAG 2.1 AA 掃描）全過。
- `tools/townpass/`：`pnpm typecheck`、`pnpm test`（114 個）全過。
- CI 另外執行 Kotlin TTS 生命週期測試（job `kotlin-tts`，`TtsLifecycleTest.kt`）與 Python TTS 工具測試（job `python-tts`，`tools/tts-android/`）。
- `integration_test/` 的 LLM／ASR／TTS 伺服器測試需要實機與手動安裝的模型，CI 不執行。

## 架構入門點

### 前端（`frontend/`）

- Vue3 + Vite + TS 前端，**主要開發區**；內部結構與目錄慣例寫在 `frontend/README.md`，以該檔為準。

### Flutter（repo 根目錄）

- `lib/main.dart`：進入點。`initServices()` 在 `runApp` 前以 `Get.putAsync`／`Get.put` 依序註冊 `lib/service/` 的全域 service；其餘程式一律 `Get.find<XService>()` 取用，新增 service 要加在這裡。
- `lib/util/tp_route.dart`：route 常數與 `GetPage` 清單集中於此，頁面 controller 在各自 `BindingsBuilder` 內 `Get.put`。新增頁面＝加常數＋加 `GetPage`。
- `TPRoute.openUri(uri:, forceTitle:)`：開連結的共用入口；`local://` scheme 轉 app 內路由，其他 URL 一律開 `TPWebView`。
- `lib/page/<feature>/`：一個功能一個目錄（home、bill、city_service、account…），頁面專屬 widget 放各頁的 `widget/` 子目錄。
- `lib/service/`：服務層；`lib/bean/`：資料模型（多為 JSON serializable）。
- `lib/util/`：共用 UI 元件一律 `tp_` 前綴（`tp_button.dart`、`tp_colors.dart`、`tp_text_styles.dart`…），新共用元件沿用此命名。
- 微服務掛進 app：城市服務列表定義在 `lib/page/city_service/model/my_service_model.dart`。先在 `MyServiceItemId` enum 加 id，再於 `MyServiceIdExt` 補 `MyServiceItem`；`destinationUrl` 填前端部署網址（空字串＝項目不可點），`forceWebViewTitle` 可固定 WebView 標題。
- Mock 資料流：controller／service 以 `rootBundle.loadString(Assets.mockData.xxx)` 讀 `assets/mock_data/*.json`，再交給 `lib/bean/` 的 model 解析（範例：`AccountService`）。
- `assets/mock_data/`：mock 資料；`assets/svg/`、`assets/image/` 經 flutter_gen 產生常數，勿手寫 asset 路徑字串。
- 本機 AI 服務：`MainActivity.kt`（`android/app/src/main/kotlin/com/example/townpass/`）註冊 MethodChannel `town_pass/llm`、`town_pass/asr`、`town_pass/tts`，Dart 端是 `lib/service/` 的 `llm_service.dart`、`asr_service.dart`、`tts_service.dart`。三者都是只綁 loopback 的 native 子行程，以記憶體中的 Bearer key 授權；模型不隨 APK 發布，安裝方式見 `tools/llm-android/`、`tools/asr-android/`、`tools/tts-android/` 的 README。
- 無障礙 bridge：`tts`（requestId 生命週期：先 `start`，再恰好一個 `done`／`stopped`／`error`）、`haptic`、`a11y_state`；需要帶回 requestId 的回覆一律用 `_withRequestId()`。
- `lib/util/tp_prefill.dart`：`open_link` 帶 `prefill` 時，只在台北通站內網域、只填白名單欄位。
- `test/widget_test.dart`：安心助手入口測試（現況見「測試與 lint 現況」）。

## Agent MVP 分工

- **隊友負責工具與 LLM 推論**；本範圍是 agent orchestration、工具驗證與操作介面。
- 已驗證的獨立 MVP 在 `frontend/agent-mvp/`，保留 `frontend/` 既有服務範本；UI／UX 交接見 `frontend/agent-mvp/docs/ui-ux-handoff.md`。
- 在 `frontend/agent-mvp/` 執行 `mise install`、`pnpm install`、`pnpm dev`；lint、format:check、test、build 也在該目錄獨立執行，CI 另行檢查。
- LLM 透過 `ModelAdapter`、工具透過 `ToolClient` 介面替換（實作是直接函式呼叫）；Ollama 與 DemoToolClient 僅供聯調，契約見 MVP README。
- 平台層在 `src/platform/`：新的 bridge 呼叫一律經過 `native-bridge.ts`（requestId 配對、逾時、沒有 bridge 時回報不可用）；無障礙層（`a11y.ts`、`announcer.ts`、`haptics.ts`、`feedback.ts`、`speech.ts`）與選用的本機自然語音（`natural-voice.ts`）說明見 MVP 的 `docs/accessibility.md`。
- 路由及專家提示用英文；中文需求與專有名詞保留為資料，使用者介面預設繁體中文。
- App 首頁／服務頁入口使用 `TPAgentEntry`；`AGENT_WEB_URL` debug 預設 loopback，release 需明確指定 HTTPS。前端接點變數見 MVP 的 `.env.example`，不放秘密。

## WebView 整合（前端 ↔ App）

- Vue3 前端以 `flutter_inappwebview` 整合進 app；app 內開網頁一律用 `TPWebView`（`Get.toNamed(TPRoute.webView, arguments: WebViewArgument(url: ...))`），勿自建 InAppWebView。
- JS→Flutter bridge：`window.flutterObject.postMessage(JSON.stringify({name, data}))`；新增能力須 extends `TPWebMessageHandler` 並註冊於 `TPWebMessageListener`。
  - `TPInAppWebView`（`lib/util/tp_web_view.dart`）在 `onWebViewCreated` 掛上 `TPWebMessageListener`，注入的 JS 物件名為 `flutterObject`。
  - 所有 handler 都寫在同一檔 `lib/util/web_message_handler/tp_web_message_handler.dart`；listener 依訊息的 `name` 找 `_cachedMessageHandlers` 中同名的 handler，對不到就不會回覆。
  - 現有 `name` 以 `TPWebMessageListener._cachedMessageHandlers`（`lib/util/web_message_handler/tp_web_message_listener.dart`）的清單為準，不在文件重複列舉；前端以 `frontend/src/composables/` 的 `useConnectionMessage`（送出）與 `useHandleConnectionData`（接收）收發訊息；agent-mvp 則經 `src/platform/native-bridge.ts`。
  - 回覆由 `replyWebMessage()` 包成 `{"name", "data"}` JSON 字串，網頁端通常從 `flutterObject` 的 `message` 事件（`event.data`）收到。**例外：`tts_start`／`tts_stop`／`tts_status` 的授權主 frame 回覆走 `window` 的 `message` 事件**，透過 `postWebMessage` 綁定原請求 origin，避免共享 reply proxy 將憑證送到其他 frame；呼叫範例與本機模型安裝見 [Android TTS 文件](tools/tts-android/README.md)。舊 `tts` 系統朗讀與 LLM 事件不變。
- Vue 端必須偵測 `window.flutterObject` 是否存在，瀏覽器獨立執行時走 mock fallback（參與者不裝 Flutter 也能純瀏覽器開發）。
- 開發聯調：`pnpm dev --host`，app 內開 `http://<開發機IP>:5173`（模擬器 `http://10.0.2.2:5173`）；cleartext HTTP 需 AndroidManifest debug 設定（`usesCleartextTraffic` 或 networkSecurityConfig）。
- 正式整合：SPA 部署為 https 靜態站；不將 `dist/` 打包進 Flutter assets。

## 設計規範（讓「用不了」的人用得了）

本專案的對象是覺得服務 **「用不了」** 的人：身心障礙者、高齡者、孕婦、傷眼者、照顧者；方向為無障礙介面、語音輔助、字級調整、線上服務優化。無障礙是產品核心，功能取捨以「上述對象能否獨立完成任務」為準。法規依據、各對象設計要點與自檢方式見 CONTRIBUTING.md「設計規範」。

- **標準**：以 **WCAG 2.1 Level AA** 實作（涵蓋數位發展部「網站無障礙規範」所參酌的 WCAG 2.0 AA）；App 面向另對照[城市通無障礙檢核表](https://tpe-guideline.web.app/docs/accessibility/accessibility.html)。
- **無障礙介面**：語意化 HTML、圖片 `alt`、表單 `label`、icon 按鈕 `aria-label`；鍵盤可操作、focus 可見；內文對比 ≥ 4.5:1（大字與 icon ≥ 3:1），不以顏色為唯一線索；觸控目標 ≥ **48×48 dp**；不鎖螢幕方向、不自動輪播；Flutter 互動元件加 `Semantics`。
- **字級調整**：頁內提供字級切換並記住偏好；字級用 `rem`，放大到 200% 不截斷、不需橫向捲動。
- **語音輔助**：所有資訊都要有文字，語音只是輔助。Android WebView 不支援 `speechSynthesis`：app 內朗讀改走 bridge（新增 `TPWebMessageHandler`，由 Flutter 端 TTS 朗讀）或播放音檔；瀏覽器獨立執行時才用 `speechSynthesis`。
- **線上服務優化**：一頁一件事、顯示進度、送出前預覽確認、可中斷續填，能從 `userinfo` 帶入的資料先帶入；用白話文。
- **多語言**：預設正體中文（`zh-Hant-TW`）並提供英文，與 app 語系選項一致；UI 字串集中在字典檔，不寫死在 component；切換語言時同步 `<html lang>`，朗讀語言跟著 UI。
- **個資**：`userinfo` 只取需要的欄位；身分證字號等敏感欄位顯示時遮罩、不寫入前端儲存；不蒐集病歷、障別等健康資料，改問使用偏好（大字、語音）。
- **開放資料**：畫面依《政府資料開放授權條款》附件格式標示顯名聲明，未標示視同未取得授權。
- PR 須附設計自檢結果（axe-core／vitest-axe、TalkBack 等，見 CONTRIBUTING.md）。

## 相關資源

- 開發文件（中英）：<https://tpe-guideline.web.app>，首頁含 Figma UI Kit／Town Pass Design Tokens 連結。
- 開放資料：<https://data.taipei>、<https://data.gov.tw>、<https://tdx.transportdata.tw>；城市儀表板（開源參考）：<https://github.com/taipei-doit/Taipei-City-Dashboard>。
- Flutter 3.47 更新說明：<https://flutter.dev/blog/whats-new-in-flutter-3-47>（本專案 `.fvmrc` 釘選 3.47.6）。

## 環境變數

無。資料目前走 `assets/mock_data/`。

## 團隊協作規範

完整規範見 [CONTRIBUTING.md](CONTRIBUTING.md)，重點摘要：

- 不在 `main` 直接開工；切 `feat/`、`fix/`、`docs/` 等 prefix 的 feature branch，經 PR 併入。
- PR 需 CI（`.github/workflows/ci.yml`）通過且至少一人 review，由維護者 squash merge；PR 內文附自檢結果：Flutter 變更跑 `fvm dart format lib test` + `fvm flutter analyze` + `fvm flutter test`，`frontend/` 變更跑 `pnpm lint` + `pnpm format:check` + `pnpm test` + `pnpm build`。
- Commit message 用 Conventional Commits（英文，subject ≤72 字元、祈使句、無句號）；一個 commit／PR 一件事。
- 生成檔（`*.g.dart`、`lib/gen/`）已被 gitignore、不進 commit；勿手動編輯，改來源後跑 `build_runner` 於本地產生。
- API key 等機密不進 commit：`.env` 已 gitignore，key 名稱登記 `.env.example`，source code 不硬編碼。
- 個人開發環境不進 git：IDE 設定、SDK／本機路徑、建置快取、AI 工具的設定與暫存目錄、個人工具設定等一律不 commit；團隊共用且可重現的設定才進 git（如 `frontend/mise.toml`、`pnpm-lock.yaml`、`pubspec.lock`、`.fvmrc`）。
- 內部文件不進 git：會議紀錄、個人筆記、內部草稿／簡報與尚未公開的資料放團隊雲端或本機；repo 只放可公開的專案文件（`README.md`、`AGENTS.md`、`CONTRIBUTING.md`、`LICENSE` 等）。不確定可否公開先問維護者。
- 新增相依套件須為開源且與 **AGPL-3.0** 相容（MIT／BSD／Apache-2.0 可），PR 內說明選用理由。

## 程式碼慣例

- 註解可用繁中或英文，同一個檔案內保持一致；identifier 與 commit message 用英文。
- repo 會公開：程式碼、註解、commit message、PR 內文都不得引用內部路徑或內部文件內容；需要佐證時附公開來源的 URL。

## 資料來源與穩定性

- **資料要真實可查**：畫面上的統計數字、法條、電話、申辦天數與 dataset 名稱，都要有可查證的公開出處，並列在前端 `/about`（技術與資料來源頁）；查不到就不放，不可編造。
- 開放資料依《政府資料開放授權條款》顯名（見「設計規範」）。
- 還沒串接真實資料、暫時使用 mock 的畫面，要在畫面上清楚標示，不能讓使用者誤以為是真實資料。
- **不能白屏**：每個 bridge 呼叫都要考慮失敗與一直沒有回覆的情況（不在 app 內時沒有 `flutterObject`，也不會有回覆）；資料載入失敗時，要顯示看得到的錯誤訊息與重試方式。
- **app 外也能用**：主要流程在純瀏覽器（沒有 `window.flutterObject`）也要能完整走完；原生能力改用瀏覽器實作，或明確告知目前無法使用。

## AI coding agent 守則

- 開工前先 `git fetch --prune`，確認目前的 branch 沒有被合併（見 CONTRIBUTING.md「日常 Git 操作」）；一個任務一個 branch，不在 `main` 上修改。
- 依改動的目錄選 base branch：`frontend/` → `frontend`、`agent/` → `agent`、`model/` → `model`、`tools/` → `tools`，其他從 `main` 切出（見 CONTRIBUTING.md「常駐 branch」）；跨線介面的改動先 PR 到 `main`。
- 只改任務範圍內的檔案；順手發現的問題寫進回報或 PR 內文，不要一起改。
- 宣稱完成前，先跑所屬棧的自檢指令（見「指令」）；失敗就照實回報。
- push 與開 PR 依使用者指示；合併由維護者執行。
- 遵守「程式碼慣例」與「資料來源與穩定性」：不引用內部路徑、不編造資料。
- 不讀取、不輸出、不 commit 機密（`.env`、token、金鑰）。

## 已知 gotchas

- 需先接受 Xcode license：`sudo xcodebuild -license accept`，否則 brew／iOS build 會失敗（僅 iOS 需要；Android 基準開發不受影響）。
- 首次跑不起來多半是沒跑 `build_runner build`（缺 `*.g.dart`／`lib/gen/`）。
- 改 `pubspec.yaml` 的 assets／fonts 後要重跑 `dart run build_runner build` 才更新 flutter_gen 常數。
- 上游 TownPass 持續演進；本 repo 為快照，要對照 upstream 請看 origin repo。
- agent-mvp 常駐一個 `role="alert"` 的 assertive live region（`src/platform/announcer.ts`）；e2e 用 `getByRole('alert')` 時要限縮到元件範圍，否則 strict mode 會對到兩個元素。
- Android WebView 播放媒體需要使用者手勢（`mediaPlaybackRequiresUserGesture` 預設為 true）：先 fetch 再 `play()` 會被擋。本機自然語音因此在第一次互動時解鎖一個共用的 `<audio>`，之後都重用它。
- 本機 LLM／ASR／TTS 的 bridge（`kLlmAllowedOrigins`，`lib/service/llm_service.dart`）與 TTS 的 HTTP（`tools/tts-android/native/http_api.h`）只允許開發用 origin；正式 HTTPS 網域加入白名單前，這些能力在正式站上不可用（朗讀會退回系統語音）。

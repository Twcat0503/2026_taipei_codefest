# 2026 Taipei Codefest — Town Pass Workshop

2026 台北秋季程式節工作坊專案。**主要開發為 Vue3 前端**（`frontend/`）；repo 根目錄為 [taipei-doit/TownPass](https://github.com/taipei-doit/TownPass) 快照（不帶 upstream 歷史）之 Flutter 行動端專案（upstream 本體為 GPL-3.0）。**最終成品以 AGPL-3.0 授權**。

## 技術棧與版本

### 前端（主要開發，`frontend/`）

- Vue 3 + Vite + TypeScript；lint／格式：ESLint + Prettier；測試：Vitest。
- Node 與 pnpm 版本由 `frontend/mise.toml` 釘選（`mise install` 安裝）；套件管理一律用 **pnpm**，不用 npm／yarn／bun。
- 目錄待建立；scaffold 後 `mise.toml` 與 `pnpm-lock.yaml` 進 git。
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
pnpm lint      # ESLint
pnpm test      # Vitest
```

### Flutter（repo 根目錄）

```sh
fvm install                      # 首次：安裝 .fvmrc 釘選的 Flutter
fvm flutter pub get              # 安裝相依
fvm dart run build_runner build  # 產生 *.g.dart 與 flutter_gen asset 引用（首次必跑）
fvm flutter devices              # 列出可用裝置（以 Android 為基準）
fvm flutter run -d <device-id>   # 執行於 Android 裝置／模擬器
fvm flutter analyze              # lint
fvm flutter test                 # 全部測試
fvm flutter test test/widget_test.dart   # 單一測試檔
```

## 架構入門點

- `frontend/`：Vue3 + Vite + TS 前端，**主要開發區**（待建立；scaffold 後補內部結構說明）。
- `lib/main.dart`：Flutter 進入點。
- `lib/page/<feature>/`：一個功能一個目錄（home、bill、city_service、account…），頁面專屬 widget 放各頁的 `widget/` 子目錄。
- `lib/service/`：服務層；`lib/bean/`：資料模型（多為 JSON serializable）。
- `lib/util/`：共用 UI 元件一律 `tp_` 前綴（`tp_button.dart`、`tp_colors.dart`、`tp_text_styles.dart`…），新共用元件沿用此命名。
- `assets/mock_data/`：mock 資料；`assets/svg/`、`assets/image/` 經 flutter_gen 產生常數，勿手寫 asset 路徑字串。
- `test/`：目前僅 `widget_test.dart`。

## WebView 整合（前端 ↔ App）

- Vue3 前端以 `flutter_inappwebview` 整合進 app；app 內開網頁一律用 `TPWebView`（`Get.toNamed(TPRoute.webView, arguments: WebViewArgument(url: ...))`），勿自建 InAppWebView。
- JS→Flutter bridge：`window.flutterObject.postMessage(JSON.stringify({name, data}))`；handler 在 `lib/util/web_message_handler/`（userinfo、location、qr_code_scan、phone_call、notify、open_link、deviceinfo 等），新增能力須 extends `TPWebMessageHandler` 並註冊於 `TPWebMessageListener`。
- Vue 端必須偵測 `window.flutterObject` 是否存在，瀏覽器獨立執行時走 mock fallback（參與者不裝 Flutter 也能純瀏覽器開發）。
- 開發聯調：`pnpm dev --host`，app 內開 `http://<開發機IP>:5173`（模擬器 `http://10.0.2.2:5173`）；cleartext HTTP 需 AndroidManifest debug 設定（`usesCleartextTraffic` 或 networkSecurityConfig）。
- 正式整合：SPA 部署為 https 靜態站；不將 `dist/` 打包進 Flutter assets。

## 設計規範（競賽主題「用不了」）

主辦方指定主題 **「用不了」**：對象為身心障礙者、高齡者、孕婦、傷眼者、照顧者；方向為無障礙介面、語音輔助、字級調整、線上服務優化。無障礙是產品核心，功能取捨以「上述對象能否獨立完成任務」為準。法規依據、各對象設計要點與自檢方式見 CONTRIBUTING.md「設計規範」。

- **標準**：以 **WCAG 2.1 Level AA** 實作（涵蓋數位發展部「網站無障礙規範」所參酌的 WCAG 2.0 AA）；App 面向另對照[城市通無障礙檢核表](https://tpe-guideline.web.app/docs/accessibility/accessibility.html)。
- **無障礙介面**：語意化 HTML、圖片 `alt`、表單 `label`、icon 按鈕 `aria-label`；鍵盤可操作、focus 可見；內文對比 ≥ 4.5:1（大字與 icon ≥ 3:1），不以顏色為唯一線索；觸控目標 ≥ **48×48 dp**；不鎖螢幕方向、不自動輪播；Flutter 互動元件加 `Semantics`。
- **字級調整**：頁內提供字級切換並記住偏好；字級用 `rem`，放大到 200% 不截斷、不需橫向捲動。
- **語音輔助**：所有資訊都要有文字，語音只是輔助。Android WebView 不支援 `speechSynthesis`：app 內朗讀改走 bridge（新增 `TPWebMessageHandler`，由 Flutter 端 TTS 朗讀）或播放音檔；瀏覽器獨立執行時才用 `speechSynthesis`。
- **線上服務優化**：一頁一件事、顯示進度、送出前預覽確認、可中斷續填，能從 `userinfo` 帶入的資料先帶入；用白話文。
- **多語言**：預設正體中文（`zh-Hant-TW`）並提供英文，與 app 語系選項一致；UI 字串集中在字典檔，不寫死在 component；切換語言時同步 `<html lang>`，朗讀語言跟著 UI。
- **個資**：`userinfo` 只取需要的欄位；身分證字號等敏感欄位顯示時遮罩、不寫入前端儲存；不蒐集病歷、障別等健康資料，改問使用偏好（大字、語音）。
- **開放資料**：畫面依《政府資料開放授權條款》附件格式標示顯名聲明，未標示視同未取得授權。
- PR 須附設計自檢結果（axe-core／vitest-axe、TalkBack 等，見 CONTRIBUTING.md）。

## 相關資源（競賽）

- 開發文件（中英）：<https://tpe-guideline.web.app>，首頁含 Figma UI Kit／Town Pass Design Tokens 連結。
- 活動官網・競賽須知：<https://codefest.taipei/2026-fall>。
- 開放資料：<https://data.taipei>、<https://data.gov.tw>、<https://tdx.transportdata.tw>；城市儀表板（開源參考）：<https://github.com/taipei-doit/Taipei-City-Dashboard>。
- Flutter 3.47 更新說明：<https://flutter.dev/blog/whats-new-in-flutter-3-47>（本專案 `.fvmrc` 釘選 3.47.6）。
- 規則問題請洽承辦單位（台北市電腦商業同業公會），不適用 GitHub Issue。

## 環境變數

無。資料目前走 `assets/mock_data/`。

## 團隊協作規範

完整規範見 [CONTRIBUTING.md](CONTRIBUTING.md)，重點摘要：

- 不在 `main` 直接開工；切 `feat/`、`fix/`、`docs/` 等 prefix 的 feature branch，經 PR 併入。
- PR 需至少一人 review，由維護者 squash merge；合併前無 CI 門檻，但 PR 內文附自檢結果：Flutter 變更跑 `fvm flutter analyze` + `fvm flutter test`，`frontend/` 變更跑 `pnpm lint` + `pnpm test`。
- Commit message 用 Conventional Commits（英文，subject ≤72 字元、祈使句、無句號）；一個 commit／PR 一件事。
- 生成檔（`*.g.dart`、`lib/gen/`）已被 gitignore、不進 commit；勿手動編輯，改來源後跑 `build_runner` 於本地產生。
- API key 等機密不進 commit：`.env` 已 gitignore，key 名稱登記 `.env.example`，source code 不硬編碼。
- 新增相依套件須為開源且與 **AGPL-3.0** 相容（MIT／BSD／Apache-2.0 可），PR 內說明選用理由。

## 程式碼慣例

- 註解可用繁中或英文，同一個檔案內保持一致；identifier 與 commit message 用英文。
- repo 會公開：程式碼、註解、commit message、PR 內文都不得引用 `research/` 等內部路徑或內部文件內容；需要佐證時附公開來源的 URL。

## 資料來源與穩定性

- **資料要真實可查**：畫面上的統計數字、法條、電話、申辦天數與 dataset 名稱，都要有可查證的公開出處，並列在前端 `/about`（技術與資料來源頁）；查不到就不放，不可編造。
- 開放資料依《政府資料開放授權條款》顯名（見「設計規範」）。
- 還沒串接真實資料、暫時使用 mock 的畫面，要在畫面上清楚標示，不能讓使用者誤以為是真實資料。
- **不能白屏**：每個 bridge 呼叫都要處理失敗（`bridge.call()` 會以 `no-bridge`／`timeout` reject）；資料載入失敗時，要顯示看得到的錯誤訊息與重試方式。
- **app 外也能用**：主要流程在純瀏覽器（沒有 `window.flutterObject`）也要能完整走完；原生能力改用瀏覽器實作，或明確告知目前無法使用。

## Agent 工作守則

多個 agent（Claude Code、pi 等）同時參與開發時：

- 開工前先 `git fetch --prune`，確認目前的 branch 沒有被合併（見 CONTRIBUTING.md「日常 Git 操作」）；一個任務一個 branch，平行作業用 worktree（放在已 gitignore 的 `.claude/worktrees/`），不在 `main` 上修改。
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

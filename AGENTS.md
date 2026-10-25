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

## 無障礙設計標準

- 依台北市政府採用之國家標準：國發會「政府網頁無障礙規範」與「政府行動網路應用無障礙規範」，即 **WCAG 2.1 Level AA**。
- 前端（Vue3）：語意化 HTML、有意義圖片給 `alt`、表單欄位有 `label`、鍵盤可操作且 focus 可見、內文對比 ≥ 4.5:1（大字 ≥ 3:1）、200% 縮放可正常閱讀；建議以 axe-core／vitest-axe 做自動化檢查。
- Flutter：互動元件給 `Semantics` 標籤、觸控目標 ≥ 44×44 dp、支援系統字級放大、不以顏色作為唯一資訊線索。
- PR 須附無障礙自檢結果（見 CONTRIBUTING.md）。

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

## 已知 gotchas

- 需先接受 Xcode license：`sudo xcodebuild -license accept`，否則 brew／iOS build 會失敗（僅 iOS 需要；Android 基準開發不受影響）。
- 首次跑不起來多半是沒跑 `build_runner build`（缺 `*.g.dart`／`lib/gen/`）。
- 改 `pubspec.yaml` 的 assets／fonts 後要重跑 `dart run build_runner build` 才更新 flutter_gen 常數。
- 上游 TownPass 持續演進；本 repo 為快照，要對照 upstream 請看 origin repo。

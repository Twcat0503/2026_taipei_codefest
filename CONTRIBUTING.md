# 貢獻指南（Contributing Guide）

2026 台北秋季程式節工作坊的團隊協作規範。本 repo 為 [taipei-doit/TownPass](https://github.com/taipei-doit/TownPass) 快照（upstream 本體為 GPL-3.0）。**最終成品以 AGPL-3.0 授權**，所有貢獻同樣以 AGPL-3.0 釋出（GPL-3.0 元件依 GPL v3 §13 可併入 AGPL-3.0 成品）。

環境需求與建置指令見 [AGENTS.md](AGENTS.md)：Flutter 用 FVM 釘選版本（首次必跑 `build_runner`）；前端（`frontend/`）用 mise 釘選 Node／pnpm，套件管理用 pnpm。

## 開發流程

1. **不要直接在 `main` 上開工。** 先從最新 `main` 切出 feature branch，命名：
   - `feat/<short-name>`：新功能
   - `fix/<short-name>`：修 bug
   - `docs/<short-name>`：文件
   - `refactor/<short-name>`、`chore/<short-name>`：其他
2. 本地開發、自測（見下方「提交前自檢」）。
3. 開 PR 到 `main`，一個 PR 只做一件事。
4. **PR 需至少一位 reviewer approve**，由維護者以 **squash merge** 併入 `main`。

## 開發基準：Android

- Flutter 開發與驗證以 **Android 裝置**（模擬器或實體機）為基準：`fvm flutter devices` 確認裝置後 `fvm flutter run -d <device-id>` 執行。
- iOS 為 best-effort：能跑更好，但不作為 PR 門檻；iOS 獨有問題請開 issue 追蹤，不擋合併。
- 前端以 Android 裝置為準：mobile-first 開發，於 Android Chrome 驗證。

## Commit 規範

- 使用 [Conventional Commits](https://www.conventionalcommits.org/)，內文用英文：`feat:` `fix:` `refactor:` `perf:` `test:` `docs:` `chore:`。
- Subject 用祈使句、小寫開頭、不加句號、不超過 72 字元。
- 一個 commit 一件事；commit message 不加 AI 署名行。

## PR 規範

- 標題沿用 Conventional Commits 風格（squash merge 後即成為 `main` 上的 commit message）。
- 內文寫清楚：改什麼、為什麼、如何驗證；UI 變更請附截圖或錄影。
- 合併前無自動化門檻（本 repo 目前無 CI），但請**自行確認**變更所屬棧：

  Flutter（repo 根目錄）：

  ```sh
  fvm flutter analyze
  fvm flutter test
  ```

  前端（`frontend/`）：

  ```sh
  pnpm lint
  pnpm test
  ```

  結果貼在 PR 內文即可。

## 前端開發（`frontend/`）

- 主要開發區：Vue 3 + Vite + TypeScript，ESLint/Prettier、Vitest。
- Node 與 pnpm 由 `frontend/mise.toml` 釘選；套件管理一律用 `pnpm`，不用 npm／yarn／bun。
- `package.json` 與 `pnpm-lock.yaml` 的變更放同一個 commit；`node_modules/`、`dist/` 不進 git。
- mobile-first 開發，以 Android 裝置（Chrome）驗證後再提交 PR。
- 新增前端相依套件同樣須符合下方「相依套件」的開源授權規則。

## WebView 整合

- 前端以 WebView 整合進 app；app 內開網頁一律用 `TPWebView`（`TPRoute.webView`），勿自建 WebView。
- Bridge 協定：`window.flutterObject.postMessage(JSON.stringify({ name, data }))`，回覆亦為 JSON 字串。
- 新增原生能力：Flutter 端新增 `TPWebMessageHandler` 子類並註冊到 `TPWebMessageListener._cachedMessageHandlers`；Vue 端經統一封裝函式呼叫，勿在各 component 散寫 `window.flutterObject`。
- Vue 端必須在 `window.flutterObject` 不存在時有瀏覽器 fallback（mock），確保前端可獨立執行。
- 開發聯調：`pnpm dev --host` 後於 app 開 `http://<開發機IP>:5173`（模擬器 `10.0.2.2:5173`）；cleartext HTTP 僅開放給 debug 建置。
- 正式部署：SPA 部署為 https 靜態站；`dist/` 不打包進 Flutter assets。

## 無障礙設計

- 所有網頁與 app 介面以 **WCAG 2.1 Level AA** 為設計標準，依據台北市政府採用之國發會「政府網頁無障礙規範」與「政府行動網路應用無障礙規範」。
- 前端重點：
  - 語意化 HTML；有意義的圖片提供 `alt`；表單欄位有對應 `label`。
  - 所有互動功能可用鍵盤操作，focus 狀態清楚可見。
  - 內文對比 ≥ 4.5:1、大字 ≥ 3:1；不以顏色作為唯一資訊線索。
  - 200% 縮放下不需橫向捲動即可閱讀（reflow）。
- Flutter 重點：
  - 互動 widget 提供 `Semantics` 標籤；觸控目標 ≥ 44×44 dp。
  - 支援系統字級放大，勿釘死固定高度導致文字截斷。
- 自檢：前端跑 axe-core（或 vitest-axe）；Flutter 開 TalkBack 驗證語音朗讀；結果附於 PR 內文。

## 生成檔與資料

- `*.g.dart`、`lib/gen/` 為生成檔，已被 `.gitignore` 排除、**不進 commit**；修改來源（model、`pubspec.yaml` 的 assets／fonts 等）後在本地執行 `fvm dart run build_runner build` 產生，勿手動編輯。
- Asset 一律引用 flutter_gen 常數，不手寫路徑字串。
- 目前資料走 `assets/mock_data/`，新增 mock 資料請維持相同結構與命名。

## 機密與 API key

- API key、token、密碼等機密資訊**一律不進 commit**。
- `.env`、`.env.*` 已列入 `.gitignore`；環境變數的值放 `.env`，key 名稱登記到 `.env.example`（只列 key，不寫值）。
- 不在 source code、mock 資料或 PR 內文中硬編碼 key 值。
- Commit 前檢查 diff 確認未夾帶機密；若不慎提交，立即撤銷該 key 並替換，不要只刪後續 commit。

## 相依套件

- 新增套件必須是**開源套件**（pub.dev／npm 上有明確授權），且授權需與 **AGPL-3.0** 相容（MIT、BSD、Apache-2.0 可；不相容授權（如 GPL-2.0-only、SSPL、各種 proprietary）不可用）。前端 `frontend/` 相依套件適用同一規則。
- 開 PR 時說明：為什麼需要這個套件、現有套件或標準函式庫為何不夠用。
- `pubspec.yaml` 與 `pubspec.lock` 的變更放同一個 commit。

## 相關資源

| 資源 | 連結／位置 |
| --- | --- |
| TownPass 原始碼（upstream） | <https://github.com/taipei-doit/TownPass> |
| 開發文件（中英） | <https://tpe-guideline.web.app> |
| 活動官網・競賽須知 | <https://codefest.taipei/2026-fall> |
| Figma UI Kit | 開發文件首頁有連結，搜尋「Town Pass Design Tokens」 |
| 開放資料 | <https://data.taipei>、<https://data.gov.tw>、<https://tdx.transportdata.tw> |
| 城市儀表板（開源參考） | <https://github.com/taipei-doit/Taipei-City-Dashboard> |
| Flutter 3.47 更新說明 | <https://flutter.dev/blog/whats-new-in-flutter-3-47> |

- 使用開放資料時注意各平台的授權條款與頻率限制；串接 TDX 等需申請 token 的資料源，key 依上方「機密與 API key」規則管理，不進 commit。
- 設計請沿用 Figma UI Kit 的 Town Pass Design Tokens（色彩、字級、圓角等），勿自行定義新值。

## 其他

- 發現與本規範不符的既有程式碼，可在 PR 內提出，但不要順手做大範圍重構。
- 上游 TownPass 快照本體為 GPL-3.0，維持不變；本競賽最終成品（含前端與整合後 app）以 **AGPL-3.0** 授權，`LICENSE` 已換為 AGPL-3.0 全文。

- 技術問題與討論請開 GitHub Issue；**競賽規則問題請洽承辦單位（台北市電腦商業同業公會）**。

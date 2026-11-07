# 貢獻指南（Contributing Guide）

2026 台北秋季程式節工作坊的團隊協作規範。本 repo 為 [taipei-doit/TownPass](https://github.com/taipei-doit/TownPass) 快照（upstream 本體為 GPL-3.0）。**最終成品以 AGPL-3.0 授權**，所有貢獻同樣以 AGPL-3.0 釋出（GPL-3.0 元件依 GPL v3 §13 可併入 AGPL-3.0 成品）。

環境需求與建置指令見 [AGENTS.md](AGENTS.md)：Flutter 用 FVM 釘選版本（首次必跑 `build_runner`）；前端（`frontend/`）用 mise 釘選 Node／pnpm，套件管理用 pnpm。

## 開發流程

1. **不要直接在 `main` 上開工。** 先更新 `main`，再切出 feature branch：

   ```sh
   git switch main && git pull --rebase
   git switch -c feat/<short-name>
   ```

   命名：
   - `feat/<short-name>`：新功能
   - `fix/<short-name>`：修 bug
   - `docs/<short-name>`：文件
   - `refactor/<short-name>`、`chore/<short-name>`：其他
2. 本地開發、自測（指令見下方「PR 規範」）。
3. 開 PR 到 `main`，一個 PR 只做一件事。
4. **PR 需至少一位 reviewer approve**，由維護者以 **squash merge** 併入 `main`。

### 日常 Git 操作

- **開工前確認 branch 還沒被合併**：`git fetch --prune` 後跑 `git branch -vv`，標示 `[gone]` 的是已合併、GitHub 上已刪除的 branch，不要在上面繼續開發；新工作一律從最新的 `main` 開新 branch。
- **同步 main**：PR 落後 `main` 或出現衝突時，用 rebase 同步，衝突在本機解決並重跑自檢：

  ```sh
  git fetch origin
  git rebase origin/main
  git push --force-with-lease
  ```

  不想在本機處理時，也可以按 PR 頁面的「Update branch」。
- **force push 只用 `--force-with-lease`，而且只推自己的 branch**；不要改寫別人的 branch，`main` 一律禁止 force push。
- **PR 要小、早點合併**：一個 PR 盡量在幾個小時內就能審完合併；branch 放越久，越容易跟別人衝突。
- **疊加 PR**（B 依賴還沒合併的 A）：B 從 A 切出，PR 的 base 選 A。A 以 squash 合併後，在 B 上執行：

  ```sh
  git fetch origin
  git rebase --onto origin/main A
  git push --force-with-lease
  ```

  本機已經刪掉 A 的話，把 `A` 換成 A 合併前最後一個 commit 的 SHA。最後確認 B 的 PR base 已改回 `main`（A 的 branch 被刪除後，GitHub 通常會自動改）。
- **合併後清理**：GitHub 會自動刪除已合併的 branch，本機再執行：

  ```sh
  git switch main && git pull --rebase
  git fetch --prune
  git branch -D <branch>
  ```

  squash 合併後用 `git branch -d` 會被拒絕（git 看不出內容已經合併），這是正常的；確認 PR 已合併後再用 `-D`。

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

## 部署（Cloudflare Pages）

前端由 Cloudflare Pages 連結本 repo 自動部署（`<project>` 為 Pages 專案名稱）：

| 項目 | 設定 |
| --- | --- |
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `pnpm build` |
| Build output directory | `dist` |
| 環境變數 | `NODE_VERSION`、`PNPM_VERSION`，值與 `frontend/mise.toml` 相同；改版本時兩邊一起改 |

- 每次合併進 `main` 都會更新正式站 `https://<project>.pages.dev`。
- 每個 PR 會自動產生預覽站，Cloudflare 會把網址留言在 PR 上；每個 branch 另有固定的別名，例如 `feat/foo` 對應 `https://feat-foo.<project>.pages.dev`。審 UI 變更時，用 Android 手機開預覽網址確認。
- 預覽站預設公開，不要放機密或尚未公開的資料。
- `lib/page/city_service/model/my_service_model.dart` 的 `destinationUrl` 只填正式站網址；要在 app 裡測預覽站，就在本機暫時修改，不要 commit。
- 正式站出問題時，先到 Cloudflare dashboard 的 Deployments，把 production rollback 到上一個正常的 deployment，再開 `fix/` PR 修正。
- SPA 路由不用另外設定：專案沒有 `404.html` 時，Pages 會把未知路徑交給 `index.html`。

## 發表與提交

發表就是現場操作成品，發表用的版本就是正式 release，不另外做展示版。

- **釋出**：確認 `main` 的 CI 通過、正式站已更新後，由維護者打 tag：

  ```sh
  git switch main && git pull --rebase
  git tag -a v1.0.0 -m "release v1.0.0"
  git push origin v1.0.0
  ```

  APK 從同一個 tag build：`fvm flutter build apk --release`，產出在 `build/app/outputs/flutter-apk/app-release.apk`。目前 release 沿用 debug 簽章，可以直接安裝，但不能上架。
- 釋出後只收 `fix/` PR；修完後打下一個 patch 版號（例如 `v1.0.1`），並重新 build APK。
- **提交前檢查**（截止時間與欄位字數見 AGENTS.md「競賽限制」）：
  - [ ] repo 已轉為 public，用無痕視窗打得開提交的 GitHub 連結
  - [ ] 根目錄 README 是作品說明，資料來源與授權都已填寫
  - [ ] 正式站的 `/about` 列出所有資料來源，開放資料依授權條款顯名
  - [ ] `destinationUrl` 指向正式站，app 已從 release tag 重新 build
  - [ ] 專案名稱、簡介、作品介紹符合字數限制；截圖連結的權限是「知道連結的人可檢視」
- **發表設備**（現場只能操作成品，不能用簡報）：
  - [ ] Android 實機或模擬器已安裝 release APK；實機可以用 scrcpy 投到筆電畫面
  - [ ] 實際開過一次 TalkBack 與最大系統字級，主要流程都走得完
  - [ ] 準備網路備案（例如手機熱點）；斷網時畫面會顯示錯誤提示，不會白屏
  - [ ] HDMI 轉接器、充電器自備

## 設計規範

主題、對象與必守規則摘要見 [AGENTS.md](AGENTS.md)「設計規範」；本節補充依據、各對象設計要點、實作細則與自檢方式。

### 依據

| 類別 | 規範 | 重點 |
| --- | --- | --- |
| 無障礙（法律） | 《身心障礙者權益保障法》第 52 條之 2 | 政府機關（構）、學校網站應通過第一優先等級以上無障礙檢測，並取得認證標章 |
| 無障礙（子法） | 《各級機關機構學校網站無障礙檢測及認證標章核發辦法》（數位發展部） | 檢測依主管機關訂定的「網站無障礙規範」；基準為可感知、可操作、可理解、穩健性；標章效期 3 年 |
| 無障礙（技術） | 數位發展部「網站無障礙規範」 | 2017 年實施，參酌 WCAG 2.0 |
| 無障礙（城市通） | [城市通無障礙檢核表](https://tpe-guideline.web.app/docs/accessibility/accessibility.html) | App 檢核項目，各項連結數位發展部；如觸控目標 48dp（TS3）、字級 200%（DT3）、直橫向（AD2）、語言標示（PD1） |
| 設計（城市通） | [城市通設計規範](https://tpe-guideline.web.app/design/)、Figma UI Kit | 四原則：便捷、穩定、美好、永續 |
| 語言 | 《國家語言發展法》第 4、11 條 | 國家語言一律平等；政府機關（構）必要時提供國家語言間的通譯服務 |
| 個資 | 《個人資料保護法》第 5、6、8 條 | 比例原則；病歷、醫療、健康檢查等特種個資原則上不得蒐集；直接蒐集須告知 |
| 開放資料 | 《政府資料開放授權條款－第1版》 | 須依附件格式顯名，未顯名視為自始未取得授權；與 CC BY 4.0 相容 |

本專案以 **WCAG 2.1 Level AA** 為實作目標；WCAG 2.1 向下相容，符合 2.1 AA 即符合 2.0 AA。

### 各對象設計要點

| 對象 | 常見困難 | 設計要點 |
| --- | --- | --- |
| 視障、傷眼者 | 看不清或看不到畫面 | 只靠 TalkBack 能走完全部流程；可放大字級；關鍵資訊可朗讀 |
| 高齡者 | 字小、步驟多、用語難懂 | 白話用語、一頁一件事、icon 一律附文字、每個操作都有明確回饋 |
| 肢體障礙、孕婦 | 精細操作困難、容易疲勞、常單手操作 | 觸控目標 ≥ 48dp 且間距 ≥ 8dp；主要按鈕放在拇指可及的下半部；不要求拖曳或多指手勢；不設操作時限 |
| 聽障 | 聽不到語音 | 語音內容一律有文字版；通知要有視覺提示 |
| 照顧者 | 代人操作、同時照顧多人 | 代辦時清楚標示「替誰辦理」；結果可分享給被照顧者或其他照顧者 |

### 實作細則

- **無障礙介面**
  - 不用 `div` 模擬按鈕；裝飾性圖片用 `alt=""`。
  - 必填欄位用文字標示，不只靠紅色或星號；錯誤訊息指出哪個欄位、怎麼修正，並以 `aria-live` 通知螢幕閱讀器。
  - focus 順序由上而下、由左而右（城市通檢核表 FC3）。
  - Town Pass Design Tokens 若對比或字級達不到上述要求，以無障礙優先，另訂的值在 PR 說明。
  - Flutter：支援系統字級放大，勿釘死固定高度導致文字截斷。
- **字級調整**
  - 至少 3 段（標準／大／特大），偏好存在本機，下次開啟沿用。
  - `TPWebView` 目前沒有設定 `textZoom`；系統字級是否帶入網頁要在 Android 實機確認，頁內字級控制不能依賴系統設定。
- **語音輔助**
  - 朗讀可隨時停止、可調語速，內容與畫面文字一致。
  - 依據：MDN browser-compat-data 標示 Android WebView 不支援 `speechSynthesis`（Chrome for Android 支援）。
  - 語音辨識在 WebView 的支援不確定，採用前先在 Android 實機驗證，且不可作為唯一輸入方式。
- **線上服務優化**
  - 送出前預覽確認、必填欄位即時驗證（城市通申辦服務的 UI 規範）。
  - 草稿可暫存在本機供續填，但不含身分證字號等個資欄位。
- **多語言**
  - app 的語系選項在 `lib/page/language/`（繁體中文／English），切換邏輯尚未實作。
  - Vue 端字典檔可用 `vue-i18n`，新增時依「相依套件」規則在 PR 說明。
  - 夾雜其他語言的片段加上 `lang` 屬性（城市通檢核表 PD1）；英文字串較長，按鈕與標籤要能換行。
  - 《國家語言發展法》沒有要求網站提供全部國家語言；若以高齡者為主要對象，語音輔助可評估提供台語、客語。
- **個資**
  - 只取功能需要的欄位（個資法第 5 條）；不蒐集病歷、醫療、健康檢查等特種個資（第 6 條），障別比照辦理；直接向使用者蒐集時，依第 8 條告知蒐集目的、個資類別、利用方式與當事人權利。
- **開放資料標示**
  - 顯名聲明依授權條款附件：「提供機關/單位 [年份] [開放資料釋出名稱與版本號]」、依授權條款公眾釋出的聲明、條款連結 <https://data.gov.tw/license>。放在畫面的「資料來源」區塊。
  - 其他平台的資料依各自的使用條款標示。

### 自檢

- 前端：axe-core（或 vitest-axe）自動檢查；Android 實機開 TalkBack 走完主要流程；字級調到最大、旋轉螢幕各試一次。
- Flutter：TalkBack 驗證語音朗讀；系統字級調到最大，檢查有無截斷。
- 結果附於 PR 內文。

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
| Figma UI Kit | <https://www.figma.com/community/file/1409212309969674409/town-pass-open-source-gov-mobile-app-ui-kit-and-design-system> |
| 開放資料 | <https://data.taipei>、<https://data.gov.tw>、<https://tdx.transportdata.tw> |
| 城市儀表板（開源參考） | <https://github.com/taipei-doit/Taipei-City-Dashboard> |
| Flutter 3.47 更新說明 | <https://flutter.dev/blog/whats-new-in-flutter-3-47> |

- 使用開放資料時注意各平台的授權條款與頻率限制；串接 TDX 等需申請 token 的資料源，key 依上方「機密與 API key」規則管理，不進 commit。
- 設計請沿用 Figma UI Kit 的 Town Pass Design Tokens（色彩、字級、圓角等），勿自行定義新值；唯一例外是無障礙要求（見「設計規範」）。

## 其他

- 發現與本規範不符的既有程式碼，可在 PR 內提出，但不要順手做大範圍重構。
- 上游 TownPass 快照本體為 GPL-3.0，維持不變；本競賽最終成品（含前端與整合後 app）以 **AGPL-3.0** 授權，`LICENSE` 已換為 AGPL-3.0 全文。

- 技術問題與討論請開 GitHub Issue；**競賽規則問題請洽承辦單位（台北市電腦商業同業公會）**。

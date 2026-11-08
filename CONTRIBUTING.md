# 貢獻指南（Contributing Guide）

本專案的團隊協作規範。本 repo 為 [taipei-doit/TownPass](https://github.com/taipei-doit/TownPass) 快照（upstream 本體為 GPL-3.0）。**最終成品以 AGPL-3.0 授權**，所有貢獻同樣以 AGPL-3.0 釋出（GPL-3.0 元件依 GPL v3 §13 可併入 AGPL-3.0 成品）。

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

### 常駐 branch（各開發線）

四條開發線各有一條常駐 branch，對應各自的目錄；其他工作（Flutter app、文件、CI）仍以 `main` 為基準。

| 常駐 branch | 目錄 | 內容 |
| --- | --- | --- |
| `frontend` | `frontend/` | Vue 3 前端：聊天畫面、結果卡片 |
| `agent` | `agent/` | Agent 服務：聊天 API、對話流程、逐步拆解與工具呼叫、錯誤處理 |
| `model` | `model/` | 本機模型（Liquid AI LFM3-VL-2B、Q4_0 QAD）：推理服務 |
| `tools` | `tools/` | 工具包裝：`townpass`（把台北通服務包裝成工具）與資料讀取層 |

- 功能從所屬的常駐 branch 切出，PR 的 base 選同一條常駐 branch，審過後 squash 合併：

  ```sh
  git switch agent && git pull --rebase
  git switch -c feat/<short-name>
  ```

- 一條線能跟其他線串起來時（例如前端打得到聊天 API、agent 呼叫得到工具），由維護者開 PR 把常駐 branch 合進 `main`，**用 merge commit，不要 squash**，歷史才不會分叉。
- `main` 有更新時，由維護者把 `main` merge 回各常駐 branch；常駐 branch 不 rebase、不 force push。
- 跨線的介面（聊天 API 的格式、工具的名稱與參數、模型輸出的工具呼叫格式）要改時，先開 PR 到 `main`，請相關負責人 review，各線再把 `main` 合回自己的 branch。
- 模型權重、訓練資料等大型檔案不進 git，放在團隊雲端或模型平台；repo 只放下載、轉換與量化的腳本。
- `frontend` 會自動部署成固定的預覽站 `https://frontend.<project>.pages.dev`（見「部署」），可以當作整合測試環境。

### 日常 Git 操作

- **開工前確認 branch 還沒被合併**：`git fetch --prune` 後跑 `git branch -vv`，標示 `[gone]` 的是已合併、GitHub 上已刪除的 branch，不要在上面繼續開發；新工作一律從最新的常駐 branch 或 `main` 開新 branch。
- **同步 main**：PR 落後 `main` 或出現衝突時，用 rebase 同步，衝突在本機解決並重跑自檢：

  ```sh
  git fetch origin
  git rebase origin/main
  git push --force-with-lease
  ```

  不想在本機處理時，也可以按 PR 頁面的「Update branch」。替別人的 PR 解衝突時改用 merge（`git merge origin/main`，衝突寫在 merge commit 裡），不改寫對方的 branch。
- **force push 只用 `--force-with-lease`，而且只推自己的 branch**；不要改寫別人的 branch，`main` 一律禁止 force push。
- **多個 PR 改到同一區時依序合併**：每合一個，下一個 PR 先合入最新的 `main`，再重跑該棧的完整自檢（前端含 `pnpm test:e2e`）。git 沒有回報衝突不代表沒有語意衝突，例如同一個 helper 在兩個 PR 被改成不同名字，或新增的全域元件讓舊測試的選擇器一次對到兩個元素。
- **PR 要小、早點合併**：一個 PR 盡量在幾個小時內就能審完合併；branch 放越久，越容易跟別人衝突。
- **疊加 PR**（B 依賴還沒合併的 A）：B 從 A 切出，PR 的 base 選 A。A 以 squash 合併後，在 B 上執行：

  ```sh
  git fetch origin
  git rebase --onto origin/main A
  git push --force-with-lease
  ```

  本機已經刪掉 A 的話，把 `A` 換成 A 合併前最後一個 commit 的 SHA。本 repo 沒有開啟「合併後自動刪除 branch」，GitHub 不會自動把 B 的 base 改回 `main`：**先把 B 的 base 改成 `main`，再 push**。PR 跟 base 衝突、建不出 merge ref 時 GitHub 不會跑 CI，而改 base 這個動作本身也不會觸發 CI。
- **合併後清理**：本 repo 沒有開啟自動刪除，合併後由作者刪除遠端 branch（`git push origin --delete <branch>`；四條常駐 branch 不刪），本機再執行：

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
- squash 時 subject 用 PR 標題加 `(#N)`（合計不超過 72 字元，太長就縮短），內文改寫成幾行摘要，不要沿用 GitHub 預設那種把每個 commit 訊息串起來的內容；PR 裡有其他隊友的 commit 時，保留他們的 `Co-authored-by`。
- 內文寫清楚：改什麼、為什麼、如何驗證；UI 變更請附截圖或錄影。
- **合併條件：CI 通過，且至少一位 reviewer approve。** CI（`.github/workflows/ci.yml`）依改動路徑只檢查受影響的棧：
  - 前端（`frontend/` 有改動，含 `frontend/agent-mvp/`）：`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`。
  - Agent MVP（`frontend/agent-mvp/` 或 `tools/townpass/` 有改動）：`tools/townpass` 的 `pnpm typecheck`、`pnpm test`，再跑 agent-mvp 的 `pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`、`pnpm test:e2e`。
  - Flutter（`lib/`、`test/`、`integration_test/`、`android/`、`assets/`、`fonts/`、`tools/llm-android/`、`tools/asr-android/`、`tools/tts-android/`、`pubspec.*`、`analysis_options.yaml`、`.fvmrc` 有改動）：`dart format` 格式檢查、`build_runner`、`flutter analyze`、`flutter test`，最後建 arm64 debug APK。
  - 改到 `.github/workflows/` 時三組都會跑。
  - branch protection 只需要把「CI result」設為 required check。
- push 前先在本機跑過同一組指令，結果貼在 PR 內文：

  Flutter（repo 根目錄）：

  ```sh
  fvm dart format lib test
  fvm flutter analyze
  fvm flutter test
  ```

  前端（`frontend/`）：

  ```sh
  pnpm lint
  pnpm format:check
  pnpm test
  pnpm build
  ```

  Agent MVP（先在 `tools/townpass/`，再到 `frontend/agent-mvp/`）：

  ```sh
  pnpm typecheck && pnpm test          # tools/townpass
  pnpm lint && pnpm test && pnpm build # frontend/agent-mvp
  pnpm test:e2e                        # frontend/agent-mvp
  ```

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
| Build watch paths | 只包含 `frontend/*`，其他開發線的 push 不會觸發前端建置 |
| 環境變數 | `NODE_VERSION`、`PNPM_VERSION`，值與 `frontend/mise.toml` 相同；改版本時兩邊一起改 |

- 每次合併進 `main` 都會更新正式站 `https://<project>.pages.dev`。
- 每個 PR 會自動產生預覽站，Cloudflare 會把網址留言在 PR 上；每個 branch 另有固定的別名，例如 `feat/foo` 對應 `https://feat-foo.<project>.pages.dev`。審 UI 變更時，用 Android 手機開預覽網址確認。
- 預覽站預設公開，不要放機密或尚未公開的資料。
- `lib/page/city_service/model/my_service_model.dart` 的 `destinationUrl` 只填正式站網址；要在 app 裡測預覽站，就在本機暫時修改，不要 commit。
- 正式站出問題時，先到 Cloudflare dashboard 的 Deployments，把 production rollback 到上一個正常的 deployment，再開 `fix/` PR 修正。
- SPA 路由不用另外設定：專案沒有 `404.html` 時，Pages 會把未知路徑交給 `index.html`。

## 釋出

- 確認 `main` 的 CI 通過、正式站已更新後，由維護者打 tag：

  ```sh
  git switch main && git pull --rebase
  git tag -a v1.0.0 -m "release v1.0.0"
  git push origin v1.0.0
  ```

  APK 從同一個 tag build：`fvm flutter build apk --release`，產出在 `build/app/outputs/flutter-apk/app-release.apk`。目前 release 沿用 debug 簽章，可以直接安裝，但不能上架。
- 釋出後只收 `fix/` PR；修完後打下一個 patch 版號（例如 `v1.0.1`），並重新 build APK。

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

## 個人開發環境與內部文件

- **個人開發環境不進 git**：以下屬個人環境或可重現的產物，一律不 commit。
  - IDE／編輯器設定：`.idea/`、`.vscode/`、`*.iml`。
  - 本機 SDK 與路徑設定：`.fvm/`、`**/android/local.properties`、`**/ios/Flutter/Generated.xcconfig`。
  - 建置與快取：`.dart_tool/`、`build/`、`**/ios/Pods/`、`**/DerivedData/`、`.flutter-plugins*`。
  - AI 工具的工作目錄（worktree、暫存、個人設定）已整個列入 `.gitignore`；本機覆寫檔 `.mise.local.toml`、`pubspec_overrides.yaml` 亦同。
  - 個人 shell／工具設定、本機除錯用檔案、截圖與錄影原檔。
  - 上列多數已列於 `.gitignore`；新增這類檔案時同步補規則，或改用個人全域 gitignore。
- **例外——團隊共用且可重現的設定要進 git**：`frontend/mise.toml`、`pnpm-lock.yaml`、`pubspec.lock`、`.fvmrc`、`.env.example` 等，讓其他人能重建相同環境。
- **內部文件不進 git**：會議紀錄、個人筆記、內部草稿／簡報、尚未公開的排程或廠商資料等，放團隊雲端硬碟或本機；repo 只放可公開的專案文件（`README.md`、`AGENTS.md`、`CONTRIBUTING.md`、`TODO.md`、`CODE_OF_CONDUCT.md`、`LICENSE`）。
- 不確定某個檔案屬「團隊共用」或「個人／內部」時，先問維護者再 commit。

## 相依套件

- 新增套件必須是**開源套件**（pub.dev／npm 上有明確授權），且授權需與 **AGPL-3.0** 相容（MIT、BSD、Apache-2.0 可；不相容授權（如 GPL-2.0-only、SSPL、各種 proprietary）不可用）。前端 `frontend/` 相依套件適用同一規則。
- 開 PR 時說明：為什麼需要這個套件、現有套件或標準函式庫為何不夠用。
- `pubspec.yaml` 與 `pubspec.lock` 的變更放同一個 commit。

## 相關資源

| 資源 | 連結／位置 |
| --- | --- |
| TownPass 原始碼（upstream） | <https://github.com/taipei-doit/TownPass> |
| 開發文件（中英） | <https://tpe-guideline.web.app> |
| Figma UI Kit | <https://www.figma.com/community/file/1409212309969674409/town-pass-open-source-gov-mobile-app-ui-kit-and-design-system> |
| 開放資料 | <https://data.taipei>、<https://data.gov.tw>、<https://tdx.transportdata.tw> |
| 城市儀表板（開源參考） | <https://github.com/taipei-doit/Taipei-City-Dashboard> |
| Flutter 3.47 更新說明 | <https://flutter.dev/blog/whats-new-in-flutter-3-47> |

- 使用開放資料時注意各平台的授權條款與頻率限制；串接 TDX 等需申請 token 的資料源，key 依上方「機密與 API key」規則管理，不進 commit。
- 設計請沿用 Figma UI Kit 的 Town Pass Design Tokens（色彩、字級、圓角等），勿自行定義新值；唯一例外是無障礙要求（見「設計規範」）。

## 其他

- 發現與本規範不符的既有程式碼，可在 PR 內提出，但不要順手做大範圍重構。
- 上游 TownPass 快照本體為 GPL-3.0，維持不變；本專案的成品（含前端與整合後 app）以 **AGPL-3.0** 授權，`LICENSE` 已換為 AGPL-3.0 全文。

- 技術問題與討論請開 GitHub Issue。

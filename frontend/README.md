# frontend

Agent MVP 已放在獨立子專案 [`agent-mvp/`](agent-mvp/README.md)，不替換這裡的服務範本。UI／UX 隊友請看 [MVP 交接文件](agent-mvp/docs/ui-ux-handoff.md)；兩者分開執行安裝、開發與測試指令。

「用得了」的 Vue 前端（聊天畫面與結果卡片，規劃中），以 TownPass-Services 為範本，掛在城市通的 `TPWebView` 裡，也能直接用瀏覽器開發。專案規範以根目錄的 [AGENTS.md](../AGENTS.md) 與 [CONTRIBUTING.md](../CONTRIBUTING.md) 為準；前端開發在常駐的 `frontend` branch 進行。

## 範本來源

| 項目   | 內容                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游   | <https://github.com/taipei-doit/TownPass-Services>                                                                                                |
| 版本   | `3274852`（2025-01-09），不含歷史的快照                                                                                                           |
| 授權   | 上游未附授權條款；依城市通開發文件「Fork 專案程式庫，然後將專案 clone 到您的電腦」的指示使用                                                      |
| 未帶入 | `.github/`、`.vscode/`、`CODE_OF_CONDUCT.md`、`CONTRIBUTING.md`（以本 repo 的為準）                                                               |
| 調整   | 加上 `mise.toml`；`lint` 改成只檢查並新增 `lint:fix`；新增 `format:check` 與 Vitest（`test`、`test:watch`）；用 `lint:fix` 修正上游遺留的排版錯誤 |

上游的套件版本（Vue 3.4、Vite 5、ESLint 8、TypeScript 5.4）先維持不動。

## 指令

```sh
mise install        # 首次：安裝 mise.toml 釘選的 Node／pnpm
pnpm install        # 安裝相依
pnpm dev            # http://localhost:5173；app 內聯調用 pnpm dev --host
pnpm build          # vue-tsc 型別檢查 + vite build，輸出到 dist/
pnpm lint           # ESLint（只檢查）；pnpm lint:fix 自動修正
pnpm format         # Prettier 改寫 src/；pnpm format:check 只檢查不改
pnpm test           # Vitest 單次執行；pnpm test:watch 為監看模式
```

開 PR 前跑過 `pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`，CI 也跑同一組。

## 目錄

| 路徑                                                | 用途                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/views/`                                        | 一個路由一個頁面，對應各項台北通服務（申辦、陳情、叫號、繳費、圖書館、優惠券、訂閱、災害與報案通報、周邊、問答） |
| `src/components/atoms/`、`molecules/`、`organisms/` | 依 atomic design 分層的共用元件                                                                                  |
| `src/stores/`                                       | Pinia store，大致一個服務一個                                                                                    |
| `src/composables/`                                  | 與 app 溝通的 `useConnectionMessage`、`useHandleConnectionData`，見下節                                          |
| `src/router/index.ts`                               | 路由表                                                                                                           |
| `src/css/index.css`、`tailwind.config.js`           | 全域樣式與 Tailwind 主題（字型、主色、陰影）                                                                     |
| `public/mock/`                                      | 各服務的示範資料（JSON）；也是目標架構中工具層的資料來源之一（見根目錄 README）                                  |
| `src/**/__tests__/*.spec.ts`                        | Vitest 測試                                                                                                      |

## 與 app 溝通（bridge）

- 送訊息：`useConnectionMessage(name, data)` 會把 `{ name, data }` 轉成 JSON，呼叫 `flutterObject.postMessage`；不在 app 內時什麼都不做。
- 接收回覆：每個 view 呼叫一次 `useHandleConnectionData(cb)`，app 的回覆以字串放在 `event.data`。
- 這兩個 composable 只在 `src/views/` 呼叫，不要散落在 component 裡（沿用範本的慣例）。
- 可用的 `name` 以 Flutter 端 `TPWebMessageListener._cachedMessageHandlers` 為準（見 AGENTS.md「WebView 整合」）。
- 不在 app 內時不會有回覆，畫面仍要正常顯示（見 AGENTS.md「資料來源與穩定性」）。

## 語音操作導覽

`App.vue` 在頁面層啟動 `useButtonGuidance()`，與助手共用 `shared/interaction-guidance.ts`。它涵蓋輸入框、上傳標籤、下一步及彈窗中的按鈕；探索時只朗讀固定功能，第二次點擊才交給原本的表單或檔案選擇器，不略過既有驗證。

新版 App 以 `button_guidance` bridge 同步助手設定的 `{ enabled, lang }`，並在頁面載入前注入初始偏好，因此換服務網域仍可沿用設定；沒有 bridge 時使用此網站已儲存的偏好。設定關閉時維持一般操作，TalkBack 與鍵盤啟用不增加額外點擊。這條跨頁能力需要同時更新 APK 與服務網頁；完整契約與測試範圍見 [無障礙文件](agent-mvp/docs/accessibility.md)。

## 已知事項

- 地圖功能使用 Google Maps，key 由 `VITE_GOOGLE_MAPS_API_KEY` 提供（名稱登記在 `.env.example`，值放 `.env.local`，不進 git）；沒有 key 時地圖區塊顯示「地圖暫時無法使用」。
- `pnpm build` 會提醒主要 bundle 超過 500 kB，之後可以用動態 import 拆分。
- 範本釘的 vue-tsc 2.0.11 跑 type-check 時會印出 `languageId not found`，但 exit code 仍是 0；之後升級套件時一併確認。
- `pnpm lint` 目前有 35 個 `no-unused-vars` warning（上游遺留），不影響 CI。

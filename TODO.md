# TODO

團隊待辦清單。各開發線只改自己的段落；完成的項目打勾，可以跟功能 PR 一起送。協作流程見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 共同

- [ ] 定好跨線介面：聊天 API 格式、工具名稱與參數、模型的工具呼叫格式（先 PR 到 `main`）
- [ ] 填上各開發線負責人（GitHub 帳號）

## 前端（`frontend`）

- [ ] 聊天畫面：輸入問題、顯示對話紀錄與處理中狀態
- [ ] 結果卡片：把工具查到的結果整理成卡片
- [ ] 使用者資料與定位：透過 JS bridge 取得，不在 app 內時要有替代方式
- [ ] 錯誤提示：API 失敗或逾時時顯示原因，並可以重試
- [ ] 資料來源頁 `/about`：列出所有資料來源與開放資料顯名
- [ ] 需要時從 `feat/frontend-scaffold` 搬來 bridge（Promise、timeout、fallback）與朗讀模組
- [ ] Google Maps 的 `apiKey` 改讀環境變數，key 名稱登記到 `.env.example`

## Agent（`agent`）

- [ ] 聊天 API：接收前端訊息，回傳回覆與卡片資料
- [ ] 分步拆解：把需求拆成步驟，一次只呼叫一支工具
- [ ] 工具呼叫：透過 MCP 或轉接呼叫 `townpass-mcp`
- [ ] 錯誤處理：工具失敗、逾時、模型輸出格式錯誤

## 模型（`model`）

- [ ] 推理服務：載入 LFM3 1.7B int4 並推論，給 agent 呼叫
- [ ] 工具呼叫格式：模型固定輸出「工具名稱＋參數」
- [ ] 訓練與評估腳本（權重放雲端，不進 git）

## 工具（`tools`）

- [ ] 把 `townpass-mcp`（15 支唯讀工具）搬進 `tools/townpass-mcp/`
- [ ] 資料讀取層：逾時、快取、格式驗證
- [ ] YouBike 即時資料工具，附上資料來源

## App（Flutter，從 `main` 切出）

- [ ] `AndroidManifest.xml` 的 `<queries>` 補上 `TTS_SERVICE`，並在實機確認能朗讀
- [ ] `TtsMessageHandler` 每次呼叫都能切換語言
- [ ] `a11yService` 的 `destinationUrl` 換成正式站網址
- [ ] 修好 `test/widget_test.dart`，再把 `flutter test` 加回 CI

## Repo 與部署（維護者）

- [ ] GitHub ruleset：保護 `main` 與四條常駐 branch（禁止刪除與 force push，`main` 需要走 PR）
- [ ] Cloudflare Pages：連結 repo，Build watch paths 只包含 `frontend/*`（設定見 CONTRIBUTING.md「部署」）
- [ ] 向主辦單位確認 TownPass-Services 的授權
- [ ] README 補上正式站網址與 YouBike 資料來源

## 提交（11/8 09:00 前）

- [ ] 確認 AGENTS.md「競賽限制」的內容可以公開，再把 repo 轉為 public
- [ ] 打 release tag，並從同一個 tag build APK
- [ ] 完成提交前檢查與發表設備檢查（見 CONTRIBUTING.md「發表與提交」）

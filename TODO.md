# TODO

團隊待辦清單。各開發線只改自己的段落；完成的項目打勾，可以跟功能 PR 一起送。協作流程見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 共同

- [ ] 決定 agent 的位置：沿用 #11 的前端 harness（`frontend/agent-mvp/`），或另做 `agent/` 服務
- [ ] 定好跨線介面：`ModelAdapter`、`McpClient`／工具名稱與參數、模型的工具呼叫格式（先 PR 到 `main`；目前的契約見 #11 的 `frontend/agent-mvp/README.md`）
- [ ] 填上各開發線負責人（GitHub 帳號）

## 前端（`frontend`）

- [ ] 解決 #11 與 `frontend` 在 README 的衝突，review 後合併進 `frontend`
- [ ] UI／UX 調整與無障礙驗證（#12）
- [ ] 資料來源頁 `/about`：列出所有資料來源與開放資料顯名
- [ ] 使用者資料與定位：透過 JS bridge 取得，不在 app 內時要有替代方式
- [ ] 範本地圖頁的 Google Maps `apiKey` 改讀環境變數，key 名稱登記到 `.env.example`

## Agent

- [ ] 接上正式 MCP，取代 `DemoMcpClient`
- [ ] 接上正式模型，取代規則模擬與暫用的 Qwen3 1.7B
- [ ] 接上正式服務後，重新驗證逾時、取消、工具失敗與模型輸出格式錯誤的處理

## 模型（`model`）

- [ ] 推理服務：載入 LFM3 1.7B int4 並推論，給 agent 呼叫
- [ ] 工具呼叫格式：模型固定輸出「工具名稱＋參數」，與 `ModelAdapter` 對齊
- [ ] 訓練與評估腳本（權重放雲端，不進 git）

## 工具（`tools`）

- [x] 把唯讀工具搬進 `tools/townpass/`，由 agent 直接呼叫
- [x] 資料讀取層：逾時、快取、格式驗證
- [x] YouBike 即時資料工具，附上資料來源

## App（Flutter，從 `main` 切出）

- [ ] 整合 App 入口：`a11yService`（用得了）與 #11 的「安心助手」擇一或合併
- [ ] 入口網址換成正式站（`destinationUrl` 與 #11 的 release HTTPS URL）
- [ ] `AndroidManifest.xml` 的 `<queries>` 補上 `TTS_SERVICE`，並在實機確認能朗讀
- [ ] `TtsMessageHandler` 每次呼叫都能切換語言
- [ ] `flutter test` 加回 CI（#11 已處理，合併後勾選）

## Repo 與部署（維護者）

- [ ] GitHub ruleset：保護 `main` 與四條常駐 branch（禁止刪除與 force push，`main` 需要走 PR）
- [ ] Cloudflare Pages：連結 repo，Build watch paths 只包含 `frontend/*`（設定見 CONTRIBUTING.md「部署」）
- [ ] 向主辦單位確認 TownPass-Services 的授權
- [ ] README 補上正式站網址與 YouBike 資料來源

## 提交（11/8 09:00 前）

- [ ] 確認 AGENTS.md「競賽限制」的內容可以公開，再把 repo 轉為 public
- [ ] 打 release tag，並從同一個 tag build APK
- [ ] 完成提交前檢查與發表設備檢查（見 CONTRIBUTING.md「發表與提交」）

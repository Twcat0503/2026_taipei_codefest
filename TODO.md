# TODO

團隊待辦清單。各開發線只改自己的段落；完成的項目打勾，可以跟功能 PR 一起送。協作流程見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 共同

- [x] 決定 agent 的位置：沿用前端 harness（`frontend/agent-mvp/`）
- [x] 定好跨線介面：`ModelAdapter`、`ToolClient`／工具名稱與參數（契約見 `frontend/agent-mvp/README.md`）
- [ ] 填上各開發線負責人（GitHub 帳號）

## 前端（`frontend`）

- [x] 解決 #11 與 `frontend` 在 README 的衝突，review 後合併進 `frontend`
- [ ] UI／UX 與無障礙驗證（#12）：無障礙層已接上新 UI（#34），待 TalkBack 與實機字級驗證
- [x] 資料來源頁 `/about`：列出所有資料來源與開放資料顯名（#46）
- [x] 使用者資料與定位：透過 JS bridge 取得，不在 app 內時有替代方式
- [x] 範本地圖頁的 Google Maps `apiKey` 改讀環境變數，key 名稱登記到 `.env.example`（#57）

## Agent（`frontend/agent-mvp/`）

- [x] 用 `tools/townpass/` 取代 `DemoToolClient`（預設啟用，直接函式呼叫）
- [x] 接上手機 LFM3，取代規則模擬與暫用的 Qwen3 1.7B
- [ ] 接上正式服務後，重新驗證逾時、取消、工具失敗與模型輸出格式錯誤的處理
- [x] 緊急狀況的對話摘要重新載入後只剩文字、沒有撥號按鈕（#47）
- [x] `open_link` 帶入資料失敗時（舊版 App、表單欄位對不上）沒有任何回饋（#49）
- [x] 系統高對比模式要涵蓋新 UI 的 token（`--primary`、`--surface`、`--bubble`、`--user-bubble`）（#50）
- [x] 朗讀內容要包含緊急卡片的撥號說明（#47）
- [x] 停車：「愛心車位」等用詞對應到身障車位；重新載入後停車操作列會消失；孕婦車位入口尚未提供（#48）

## 模型（`model`）

- [x] 推理服務：手機上以 native 子行程載入 LFM3-VL-2B 並推論（`tools/llm-android/`）
- [ ] 工具呼叫格式：模型固定輸出「工具名稱＋參數」，與 `ModelAdapter` 對齊
- [ ] 訓練與評估腳本（權重放雲端，不進 git）

## 工具（`tools`）

- [x] 把唯讀工具搬進 `tools/townpass/`，由 agent 直接呼叫
- [x] 資料讀取層：逾時、快取、格式驗證
- [x] YouBike 即時資料工具，附上資料來源
- [x] 繳費連結改指可用的頁面，並以 Vue router 守門測試（#24）

## App（Flutter，從 `main` 切出）

- [ ] 整合 App 入口：`a11yService`（用得了）與「安心助手」擇一或合併
- [ ] 入口網址換成正式站（`destinationUrl` 與 release 的 HTTPS `AGENT_WEB_URL`）
- [ ] `AndroidManifest.xml` 已補 `TTS_SERVICE` 的 `<queries>`，待實機確認能朗讀
- [x] `TtsMessageHandler` 每次呼叫都能切換語言
- [x] `flutter test` 加回 CI
- [x] `userinfo` handler 加上來源與主 frame 檢查（目前任何載入的頁面都能取得會員資料）（#45）
- [ ] 本機 LLM／ASR／TTS 的來源白名單加入正式 HTTPS 網域（Dart `kLlmAllowedOrigins` 與 TTS native `allowed_origin`）
- [ ] BlueMagpie 實機驗證：首句延遲、觸控與 TalkBack 能否解鎖音訊、與 LLM 同時載入的記憶體
- [x] ASR：前端還沒有入口；`asr_stop` 無法取消進行中的 `asr_start`；`onDestroy` 不會停掉 ASR（#53、#68）
- [x] `TtsLifecycleTest.kt` 與 `tools/*-android` 的 Python 測試尚未納入 CI（#64）

## Repo 與部署（維護者）

- [ ] GitHub ruleset：保護 `main` 與四條常駐 branch（禁止刪除與 force push，`main` 需要走 PR）
- [ ] Cloudflare Pages：連結 repo，Build watch paths 只包含 `frontend/*`（設定見 CONTRIBUTING.md「部署」）
- [ ] 向臺北市政府資訊局確認 TownPass-Services 的授權
- [ ] `fonts/` 的 PingFang TC 是 Apple 專有字型（隨上游帶入），改用開源字型（例如 Noto Sans TC），見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- [ ] 確認 LFM3 模型的授權全文（目前只知標示為 `lfm1.0`）

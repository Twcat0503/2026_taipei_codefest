# 可用 API 與目前串接狀態

依 2026-11-07 整合程式碼盤點，描述本專案開發版，不代表取得臺北通正式環境授權。

| 介面                                                          | 現況                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 手機 `/v1/chat/completions`                                   | `PhoneModel` 經 `llm_start/status/stop` 管理 Android LFM3；動態 loopback 接點、私有 Bearer key      |
| 電腦 `/v1/chat/completions`                                   | 可選 Ollama 等相容服務；與手機模型模式分開                                                          |
| `ToolClient.listTools/callTool`                               | 預設直接呼叫 `tools/townpass` 的 16 個唯讀工具，沒有 MCP transport/server                           |
| 圖書／申辦／叫號機關／FAQ／繳費類型／通報分類／訂閱主題／優惠 | 讀取示範站 JSON；非正式館藏、號碼、費用或優惠                                                       |
| 公廁／停車場                                                  | 示範站內建的靜態快照，更新時間未知；停車場沒有即時空位                                              |
| YouBike                                                       | 讀取台北市公開即時資料，畫面標示來源及更新時間                                                      |
| 個人帳單                                                      | `withDemoBills` 提供 `list_bills` fixture；保留分類追問、四種狀態與固定範本導頁，沒有真實帳務或付款 |
| 預約／送件／購票／繳費                                        | 不提供正式寫入；只有 `VITE_TOOL_SOURCE=demo` 顯示本機示範預約                                       |

完整工具名稱、參數與來源見 [工具文件](../../../tools/townpass/docs/tools.md)。`demo`、`snapshot`、`live` 依工具回傳標示，不因模型真實推論而變成真實服務。

## 已使用的原生 bridge

呼叫形式為 `window.flutterObject.postMessage(JSON.stringify({ name, data }))`。

- `llm_start/status/stop`：手機模型生命週期；requestId 對應回覆，金鑰不存前端儲存。
- `location`：只在附近查詢時取得位置；無權限／逾時會提示補充行政區。座標不進入模型上下文。
- `open_link`：使用者點選工具結果或固定帳單範本時導頁。沒有成功載入回覆，不能把請求開頁當成完成服務。
- `userinfo` 未接；App 目前帳戶仍是 mock，不能拿來代表正式登入。
- `tts/share` 已存在於 App，但 Vue 的語音完成／錯誤生命週期尚未接入。WebView 不使用 speechSynthesis。

## 正式服務仍需交付

工具負責人需提供工具 schema、回傳來源與欄位、授權／登入方式、測試環境與錯誤格式。個人帳單契約見 [帳單 skill](skills/bills.md)，接正式資料前需擴充目前只允許 demo 的驗證器。任何寫入還需預覽確認、伺服器冪等鍵及交易狀態查詢。

手機模型細節見 [PhoneModel](phone-model.md)。正式 HTTPS 部署、首次完整模型下載／續傳與長時間實機測試仍需分別驗證。

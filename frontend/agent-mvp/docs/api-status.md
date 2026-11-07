# 可用 API 與目前串接狀態

依 2026-11-07 本專案實際程式碼盤點。這份清單描述開發版，不代表臺北通正式環境的 API 授權或可用性。

| 介面                         | 現況                                                                         | Agent 現在能做什麼                                                |
| ---------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /v1/chat/completions`  | 已連到 Mac 的 Ollama / Qwen3 1.7B，手機以 ADB reverse 連到 `127.0.0.1:11434` | 需求分流與搜尋參數產生；不是政府服務資料 API                      |
| MCP `listTools` / `callTool` | 只有本機 TypeScript DemoMcpClient，沒有 MCP server／transport                | 呼叫 `search_books`、`search_services`、`list_bills` 取得虛構資料 |
| 圖書查詢、預約               | 未接正式圖書館 API                                                           | 查詢示範書目、產生本機示範回執                                    |
| 申辦、叫號、繳費、票券、陳情 | 未接正式服務 API                                                             | Agent 只有部分服務介紹，不能送件、取號或付款                      |
| WebView 原生 bridge          | App 已實作以下 handlers；MVP 使用既有 open_link 導頁，其餘未接               | 導頁由使用者點選固定入口，不作為任意 LLM tool                     |

## App 現有 bridge

呼叫形式是 `window.flutterObject.postMessage(JSON.stringify({ name, data }))`，不是 HTTP API。回傳透過 WebMessageListener；實作在 `lib/util/web_message_handler/`。

| `name`                     | 能力                              | 限制                                                      |
| -------------------------- | --------------------------------- | --------------------------------------------------------- |
| `location`                 | 讀取裝置位置                      | 需要使用者定位權限，可能回空結果                          |
| `deviceinfo`               | 讀取裝置資訊                      | 回傳原生裝置資料；Agent 目前不需要也不讀取                |
| `qr_code_scan`             | 開啟掃碼頁並回傳結果              | 相機與使用者操作，不是背景自主掃碼                        |
| `open_link`                | 沿用 App route 開啟網頁／本地頁面 | 開頁不等於取得該服務 API 或完成交易                       |
| `launch_map`               | 交給系統開啟地圖 URI              | 取決於手機可處理 URI 的應用程式                           |
| `phone_call` / `1999agree` | 開啟系統撥號流程                  | 會產生外部操作；不可直接交給 LLM 自主呼叫                 |
| `notify`                   | 顯示本機通知、部分示範訂閱狀態    | 不是遠端訂閱服務 API                                      |
| `userinfo`                 | 讀取 AccountService 的帳戶        | **目前來源是 assets/mock_data/account，不是正式登入身分** |
| `tts` / `share`            | 最新 App 已新增原生朗讀／分享     | 本 MVP Vue 尚未接入，不能宣稱畫面已可使用                 |

Agent 沒有呼叫位置、相機、電話或 userinfo，沒有讀取個資。要讓 Agent 使用其中一項，應由 MCP 隊友提供受控工具，再加白名單、最小資料欄位與必要確認。

## 要接正式服務，隊友需交付什麼

1. LLM：本機 Chat Completions 接點、模型名稱、原生 tool calls 或 JSON schema 能力、取消與錯誤格式。
2. MCP：client adapter 或可連線 transport、工具名稱／schema、回傳欄位與來源、登入授權方式、測試帳號／環境。
3. 寫入型服務：預覽內容、確認後才提交的介面、冪等鍵、交易查詢及失敗重試規則。

正式 API 需由服務維運方提供授權與文件。原有 App 中的 `taipei-pass-service.vercel.app` 網頁連結不能當成可供 agent 呼叫的正式 API；不能用模擬回執宣稱正式服務成功。

## 帳單增量

已提供本期帳單 skill、缺類型追問、四種繳費狀態、錯誤重試及固定開發範本導頁。仍是自製 demo 帳單；沒有查真實帳務、正式登入或付款。契約與分工見 [帳單 skill](skills/bills.md)。`open_link` 沒有成功回覆，所以只顯示已請求開頁，不能宣稱頁面載入或定位本期成功。

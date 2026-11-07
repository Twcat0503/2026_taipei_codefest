# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

技術棧、指令、協作規範、WebView 整合與無障礙要求一律以 @AGENTS.md 為準（團隊共用、跨 agent 的單一來源，規範要改請改那份）。本檔只補 AGENTS.md 沒寫的：要讀多個檔案才拼得出來的架構，以及選手手冊裡會影響開發的競賽限制。

## Flutter 架構重點

- **啟動與 DI**：`lib/main.dart` 的 `initServices()` 在 `runApp` 前以 `Get.putAsync`／`Get.put` 依序註冊 `lib/service/` 的全域 service，其餘程式一律 `Get.find<XService>()` 取用；新增 service 要加在這裡。
- **路由**：route 常數與 `GetPage` 清單集中在 `lib/util/tp_route.dart`，頁面 controller 在各自的 `BindingsBuilder` 內 `Get.put`。新增頁面＝加常數＋加 `GetPage`。
- **開連結的共用入口**：`TPRoute.openUri(uri:, forceTitle:)`。`local://` scheme 轉 app 內路由，其他 URL 一律開 `TPWebView`。
- **微服務掛進 app**：城市服務列表定義在 `lib/page/city_service/model/my_service_model.dart`。先在 `MyServiceItemId` enum 加 id，再於 `MyServiceIdExt` 補 `MyServiceItem`；`destinationUrl` 填前端部署網址（空字串＝項目不可點），`forceWebViewTitle` 可固定 WebView 標題。
- **JS bridge 實作細節**（協定本身見 AGENTS.md）：
  - `TPInAppWebView`（`lib/util/tp_web_view.dart`）在 `onWebViewCreated` 掛上 `TPWebMessageListener`，注入的 JS 物件名為 `flutterObject`。
  - 所有 handler 都寫在同一檔 `lib/util/web_message_handler/tp_web_message_handler.dart`；listener 依訊息的 `name` 找 `_cachedMessageHandlers` 中同名的 handler，**對不到就不會回覆**。
  - 現有 `name`：`userinfo`、`launch_map`、`1999agree`、`phone_call`、`location`、`deviceinfo`、`open_link`、`notify`、`qr_code_scan`。
  - 回覆由 `replyWebMessage()` 包成 `{"name", "data"}` JSON 字串，網頁端從 `flutterObject` 的 `message` 事件（`event.data`）收到。
- **Mock 資料流**：controller／service 以 `rootBundle.loadString(Assets.mockData.xxx)` 讀 `assets/mock_data/*.json`，再交給 `lib/bean/` 的 `json_serializable` model 解析（範例：`AccountService`）。

## 測試與 lint 現況（2026-11-07 實測）

- `fvm flutter test` 必定失敗：唯一的 `test/widget_test.dart` 是 Flutter 範本留下的 counter smoke test（找 `Icons.add` 與計數文字），沒先跑 `initServices()`，會在 `SharedPreferencesService.instance` 的 null check 失敗，與本 app 無關。
- `fvm flutter analyze` 既有 25 個 issue（7 warning、18 info、無 error），exit code 為 1。
- PR 自檢看到以上結果屬既有狀態，只需確認沒有新增的失敗或 issue。

## 競賽限制（來源：附件1_2026臺北秋季程式設計節選手須知手冊）

- **時程**：2026/11/7（六）10:30 起 Hacking；**11/8（日）09:00 前要在上傳系統完成作品提交**；10:00–13:30 初選，14:10–16:40 決選。
- **題目**：「用不了」（主辦方指定；對象、方向與設計規範見 AGENTS.md「設計規範」）。
- **提交欄位**：

  | 欄位 | 限制 |
  | --- | --- |
  | 專案名稱 | ≤ 20 字 |
  | 提案方向與簡介 | ≤ 50 字 |
  | 作品介紹 | ≤ 200 字，含專案介紹、服務使用技術 |
  | 使用開放資料名稱及連結 | 資料集名稱＋連結 |
  | 程式碼連結 | GitHub 網址（http/https） |
  | 服務畫面截圖連結 | 截圖或簡報檔放個人雲端的分享連結 |

- **發表只能現場電腦 Demo，不得使用任何形式簡報（PPT、Canva 等）**。初選為評審輪桌，每隊 2 分鐘發表＋1 分鐘 Q&A；決選 15 隊、順序電腦抽籤，每隊 5 分鐘發表＋5 分鐘 Q&A。Demo 電腦自備，控台只提供 HDMI 線，轉接器自備。
- **評分**：

  | 階段 | 項目（配分） |
  | --- | --- |
  | 初選 | 服務應用 40（創意、與題目相符）、視覺呈現 30、技術完整度 30（架構清楚、資料來源正確、運行流暢） |
  | 決選 | 服務應用 25、服務完整度 30（落地可能性與難易度）、技術穩定度 20（操作流暢、系統穩定）、視覺呈現 15、創意及公益性 10（活用開源技術、公共利益） |

- **作品簡介建議涵蓋**：城市通微服務的理念與受眾、符合主題的應用場景、開發項目與引用技術、資料來源與服務應用方式。

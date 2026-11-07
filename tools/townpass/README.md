# townpass tools

把臺北市的官方資料與服務入口包成唯讀工具，由瀏覽器裡的 agent 直接呼叫，不需要另外架 server。App 預設只用真實資料：YouBike 即時資料、停管處停車場資料、環保局公廁資料，以及經確認的官方服務入口；示範站的模擬資料只在開發時提供。

```sh
mise install && pnpm install
pnpm typecheck
pnpm test
```

`src/agent-client.ts` 的 `createAgentToolClient()` 符合 `frontend/agent-mvp` 的 `ToolClient` 介面，提供 17 支工具：真實資料的 YouBike、停車場、公廁與官方入口，加上開發用的示範站工具（圖書、申辦與臨櫃、常見問題、繳費、陳情通報、市政訊息訂閱主題、優惠票券）。資料只有中文，所以 `en` 欄位放的是原文。

相依套件：`zod`（上游資料驗證，MIT）。

工具的參數、回傳格式與限制見 [docs/tools.md](docs/tools.md)。

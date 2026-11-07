# townpass tools

把台北通網頁服務包成唯讀工具，由瀏覽器裡的 agent 直接呼叫，不需要另外架 server。除 YouBike 外都是示範資料或靜態快照，不代表真實狀況。

```sh
mise install && pnpm install
pnpm typecheck
pnpm test
```

`src/agent-client.ts` 的 `createAgentToolClient()` 符合 `frontend/agent-mvp` 的 `McpClient` 介面（介面名稱沿用 agent 端，這裡沒有使用 MCP 協定）。目前提供 `search_books`、`search_services`。資料只有中文，所以 `en` 欄位放的是原文。

相依套件：`zod`（上游資料驗證，MIT）。

工具的參數、回傳格式與限制見 [docs/tools.md](docs/tools.md)。

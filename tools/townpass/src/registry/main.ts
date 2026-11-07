import { resolve } from "node:path";
import { inspectService } from "./inspect.js";
import { createServiceParser } from "./parser.js";
import { createRegistryServer } from "./server.js";
import { ServiceRegistry } from "./store.js";

const endpoint = process.env.PARSER_MODEL_ENDPOINT;
if (!endpoint) throw new Error("請設定 PARSER_MODEL_ENDPOINT，指向這台主機的模型 /v1 端點");
const parser = createServiceParser({
  endpoint,
  model: process.env.PARSER_MODEL_NAME || "local-parser",
  inspect: (url) => inspectService(url, { channel: process.env.PARSER_BROWSER_CHANNEL || undefined }),
});
const registry = new ServiceRegistry(resolve(process.env.TOOL_REGISTRY_FILE || "data/services.json"), parser);
const server = createRegistryServer(registry);
const host = process.env.TOOL_REGISTRY_HOST || "127.0.0.1";
const port = Number(process.env.TOOL_REGISTRY_PORT || 7331);
server.listen(port, host, () => console.log(`工具庫：http://${host}:${port}`));

import { createServer } from "node:http";
import type { ServiceRegistry } from "./store.js";

export function createRegistryServer(registry: ServiceRegistry) {
  return createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("content-type", "application/json; charset=utf-8");
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
      } else if (request.method === "GET" && request.url === "/tools") {
        response.end(JSON.stringify({ tools: await registry.listTools() }));
      } else if (request.method === "POST" && request.url === "/services/resolve") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const { url } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.end(JSON.stringify(await registry.resolve(url)));
      } else {
        response.writeHead(404).end(JSON.stringify({ error: "找不到此路由" }));
      }
    } catch (error) {
      response.writeHead(500).end(JSON.stringify({ error: (error as Error).message }));
    }
  });
}

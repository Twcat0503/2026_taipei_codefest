import { createServer, type IncomingMessage } from "node:http";
import type { ServiceRegistry } from "./store.js";
import { UrlNotAllowedError } from "./url-policy.js";

const maxBodyBytes = 16 * 1024;

export type RegistryServerOptions = {
  /** 允許跨來源呼叫的網頁來源（origin）。預設不送 CORS 允許標頭，只接受同來源呼叫。 */
  allowedOrigins?: string[];
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "請使用 application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new HttpError(413, "請求內容過大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "請求不是有效的 JSON");
  }
}

function serviceUrl(body: unknown): string {
  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== "string") throw new HttpError(400, "請提供服務網址");
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new HttpError(400, "服務網址格式不正確");
  }
  if (protocol !== "http:" && protocol !== "https:") throw new HttpError(400, "服務網址必須是 http 或 https");
  return url;
}

export function createRegistryServer(registry: ServiceRegistry, options: RegistryServerOptions = {}) {
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    response.setHeader("vary", "origin");
    if (origin && allowedOrigins.has(origin)) response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("content-type", "application/json; charset=utf-8");
    const send = (status: number, body: unknown) => response.writeHead(status).end(JSON.stringify(body));
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
      } else if (request.method === "GET" && request.url === "/tools") {
        send(200, { tools: await registry.listTools() });
      } else if (request.method === "POST" && request.url === "/services/resolve") {
        send(200, await registry.resolve(serviceUrl(await readJson(request))));
      } else {
        send(404, { error: "找不到此路由" });
      }
    } catch (error) {
      if (error instanceof HttpError) {
        send(error.status, { error: error.message });
      } else if (error instanceof UrlNotAllowedError) {
        send(400, { error: "服務網址不允許解析" });
      } else {
        // 內部錯誤細節只寫入伺服器 log，不回傳給呼叫端。
        console.error(error);
        send(500, { error: "工具解析失敗，請稍後再試" });
      }
    }
  });
}

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceRegistry } from "../src/registry/store.js";
import { createRegistryServer, type RegistryServerOptions } from "../src/registry/server.js";
import { UrlNotAllowedError } from "../src/registry/url-policy.js";
import type { ServiceDefinition } from "../src/registry/types.js";

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const start = async (registry: ServiceRegistry, options?: RegistryServerOptions) => {
  const server = createRegistryServer(registry, options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const registryWith = async (file: string, parse: (url: string) => Promise<ServiceDefinition>) => new ServiceRegistry(file, parse);
const tempFile = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return join(directory, "services.json");
};
const resolveRequest = (base: string, body: string, contentType = "application/json") =>
  fetch(`${base}/services/resolve`, { method: "POST", headers: { "content-type": contentType }, body });

describe("集中工具後端", () => {
  it("兩個 HTTP 呼叫者共用工具，重啟後仍不重建", async () => {
    const file = await tempFile("registry-server-");
    let parses = 0;
    const base = await start(await registryWith(file, async (url) => {
      parses++;
      return { url, title: "場地", tools: [{
        name: "search", description: "查詢場地", inputSchema: { type: "object", properties: {} },
        execution: { kind: "http", url: `${url}rooms`, method: "GET" },
      }] };
    }));
    const request = () => resolveRequest(base, JSON.stringify({ url: "https://rooms.example/" }))
      .then((response) => response.json() as Promise<ServiceDefinition>);
    const [a, b] = await Promise.all([request(), request()]);
    expect(a).toEqual(b);
    expect(parses).toBe(1);
    expect(await fetch(`${base}/tools`).then((r) => r.json())).toEqual({ tools: a.tools });

    const restarted = await start(await registryWith(file, async () => { throw new Error("不應解析"); }));
    expect(await fetch(`${restarted}/tools`).then((r) => r.json())).toEqual({ tools: a.tools });
    expect((await fetch(`${base}/tools/call`, { method: "POST" })).status).toBe(404);
  });

  it("模型失敗以通用訊息回應，細節只寫入伺服器 log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const base = await start(await registryWith(await tempFile("registry-failure-"), async () => { throw new Error("模型未啟動"); }));
    const response = await resolveRequest(base, JSON.stringify({ url: "https://rooms.example/" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "工具解析失敗，請稍後再試" });
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: "模型未啟動" }));
    const preflight = await fetch(`${base}/services/resolve`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it.each([
    { name: "非 JSON 的內容型別", body: '{"url":"https://rooms.example/"}', type: "text/plain", status: 415 },
    { name: "不是 JSON 的內容", body: "not json", type: "application/json", status: 400 },
    { name: "缺少網址", body: "{}", type: "application/json", status: 400 },
    { name: "網址格式錯誤", body: '{"url":"rooms"}', type: "application/json", status: 400 },
    { name: "非 http 的協定", body: '{"url":"file:///etc/passwd"}', type: "application/json", status: 400 },
  ])("$name 回 $status，且不進入解析", async ({ body, type, status }) => {
    const parse = vi.fn(async () => { throw new Error("不應解析"); });
    const base = await start(await registryWith(await tempFile("registry-input-"), parse));
    const response = await resolveRequest(base, body, type);
    expect(response.status).toBe(status);
    expect(parse).not.toHaveBeenCalled();
  });

  it("請求內容超過 16 KB 時回 413，且不進入解析", async () => {
    const parse = vi.fn(async () => { throw new Error("不應解析"); });
    const base = await start(await registryWith(await tempFile("registry-large-"), parse));
    const response = await resolveRequest(base, JSON.stringify({ url: "https://rooms.example/", padding: "a".repeat(17 * 1024) }));
    expect(response.status).toBe(413);
    expect(parse).not.toHaveBeenCalled();
  });

  it("服務網址不允許時回 400，且不洩漏解析細節", async () => {
    const base = await start(await registryWith(await tempFile("registry-policy-"), async () => {
      throw new UrlNotAllowedError("不允許內網或本機位址");
    }));
    const response = await resolveRequest(base, JSON.stringify({ url: "https://intranet.example/" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "服務網址不允許解析" });
  });

  it("只有列入白名單的網頁來源會收到 CORS 允許標頭", async () => {
    const registry = await registryWith(await tempFile("registry-cors-"), async () => { throw new Error("不應解析"); });
    const base = await start(registry, { allowedOrigins: ["http://127.0.0.1:5173"] });
    const allowed = await fetch(`${base}/tools`, { headers: { origin: "http://127.0.0.1:5173" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    const other = await fetch(`${base}/tools`, { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const sameOrigin = await fetch(`${base}/tools`);
    expect(sameOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });
});

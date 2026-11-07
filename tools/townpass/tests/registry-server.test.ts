import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceRegistry } from "../src/registry/store.js";
import { createRegistryServer } from "../src/registry/server.js";
import type { ServiceDefinition } from "../src/registry/types.js";

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const start = async (registry: ServiceRegistry) => {
  const server = createRegistryServer(registry);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe("集中工具後端", () => {
  it("兩個 HTTP 呼叫者共用工具，重啟後仍不重建", async () => {
    const directory = await mkdtemp(join(tmpdir(), "registry-server-"));
    directories.push(directory);
    const file = join(directory, "services.json");
    let parses = 0;
    const base = await start(new ServiceRegistry(file, async (url) => {
      parses++;
      return { url, title: "場地", tools: [{
        name: "search", description: "查詢場地", inputSchema: { type: "object", properties: {} },
        execution: { kind: "http", url: `${url}rooms`, method: "GET" },
      }] };
    }));
    const request = () => fetch(`${base}/services/resolve`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://rooms.example/" }),
    }).then((response) => response.json() as Promise<ServiceDefinition>);
    const [a, b] = await Promise.all([request(), request()]);
    expect(a).toEqual(b);
    expect(parses).toBe(1);
    expect(await fetch(`${base}/tools`).then((r) => r.json())).toEqual({ tools: a.tools });

    const restarted = await start(new ServiceRegistry(file, async () => { throw new Error("不應解析"); }));
    expect(await fetch(`${restarted}/tools`).then((r) => r.json())).toEqual({ tools: a.tools });
    expect((await fetch(`${base}/tools/call`, { method: "POST" })).status).toBe(404);
  });

  it("模型失敗以錯誤回應，不回空工具假裝成功", async () => {
    const directory = await mkdtemp(join(tmpdir(), "registry-failure-"));
    directories.push(directory);
    const base = await start(new ServiceRegistry(join(directory, "services.json"), async () => { throw new Error("模型未啟動"); }));
    const response = await fetch(`${base}/services/resolve`, { method: "POST", body: JSON.stringify({ url: "https://rooms.example/" }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "模型未啟動" });
    const preflight = await fetch(`${base}/services/resolve`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceRegistry } from "../src/registry/store.js";
import type { ServiceDefinition } from "../src/registry/types.js";

const service = (url: string): ServiceDefinition => ({
  url,
  title: "場地查詢",
  tools: [{
    name: "search_rooms",
    description: "依日期查詢可用場地",
    inputSchema: { type: "object", properties: { date: { type: "string" } }, required: ["date"] },
    execution: { kind: "http" as const, url: `${url}/rooms`, method: "GET", query: { date: { argument: "date" } } },
  }],
});

let directory: string;
let file: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "townpass-registry-"));
  file = join(directory, "services.json");
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("ServiceRegistry", () => {
  it("同時請求同一服務共用一次解析", async () => {
    let parses = 0;
    const registry = new ServiceRegistry(file, async (url) => {
      parses++;
      return service(url);
    });
    const [a, b] = await Promise.all([
      registry.resolve("https://rooms.example"),
      registry.resolve("https://rooms.example/"),
    ]);
    expect(a).toEqual(b);
    expect(parses).toBe(1);
    expect(a.tools[0]?.execution).toMatchObject({ kind: "http", query: { date: { argument: "date" } } });
  });

  it("新 instance 讀取已保存的工具，不再解析", async () => {
    const registry = new ServiceRegistry(file, async (url) => service(url));
    const saved = await registry.resolve("https://rooms.example/");
    const reloaded = new ServiceRegistry(file, async () => { throw new Error("不應重新解析"); });
    expect(await reloaded.resolve("https://rooms.example/")).toEqual(saved);
    expect(await reloaded.listTools()).toEqual(saved.tools);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual([saved]);
  });

  it("不同服務的同名工具有不同名稱，並行保存不遺失服務", async () => {
    const registry = new ServiceRegistry(file, async (url) => service(url));
    const [a, b] = await Promise.all([
      registry.resolve("https://a.example/"),
      registry.resolve("https://b.example/"),
    ]);
    expect(a.tools[0]?.name).not.toBe(b.tools[0]?.name);
    const reloaded = new ServiceRegistry(file, async () => { throw new Error("不應重新解析"); });
    expect(await reloaded.listTools()).toHaveLength(2);
  });

  it("解析失敗不保存工具，也不自動重試", async () => {
    let parses = 0;
    const registry = new ServiceRegistry(file, async () => { parses++; throw new Error("模型未啟動"); });
    await expect(registry.resolve("https://rooms.example/")).rejects.toThrow("模型未啟動");
    expect(await registry.listTools()).toEqual([]);
    expect(parses).toBe(1);
  });
});

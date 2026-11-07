import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ServiceDefinition, ServiceParser } from "./types.js";

export class ServiceRegistry {
  private services = new Map<string, ServiceDefinition>();
  private pending = new Map<string, Promise<ServiceDefinition>>();
  private loaded: Promise<void>;
  private saving: Promise<void> = Promise.resolve();

  constructor(private file: string, private parseService: ServiceParser) {
    this.loaded = this.load();
  }

  private async load() {
    try {
      const saved: ServiceDefinition[] = JSON.parse(await readFile(this.file, "utf8"));
      this.services = new Map(saved.map((service) => [service.url, service]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async listTools() {
    await this.loaded;
    return [...this.services.values()].flatMap((service) => service.tools);
  }

  async resolve(input: string): Promise<ServiceDefinition> {
    await this.loaded;
    const url = new URL(input).href;
    const saved = this.services.get(url);
    if (saved) return saved;
    const existing = this.pending.get(url);
    if (existing) return existing;
    const parsing = this.create(url).finally(() => { this.pending.delete(url); });
    this.pending.set(url, parsing);
    return parsing;
  }

  private async create(url: string) {
    const parsed = await this.parseService(url);
    const prefix = createHash("sha256").update(url).digest("hex").slice(0, 12);
    const service: ServiceDefinition = {
      ...parsed,
      url,
      tools: parsed.tools.map((tool, index) => ({
        ...tool,
        name: `svc_${prefix}_${index}_${tool.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32)}`,
      })),
    };
    // 不同服務可以並行解析；檔案寫入依序執行，避免彼此覆蓋。
    const save = this.saving.then(async () => {
      const next = new Map(this.services).set(url, service);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, JSON.stringify([...next.values()], null, 2), "utf8");
      this.services = next;
    });
    this.saving = save.catch(() => {});
    await save;
    return service;
  }
}

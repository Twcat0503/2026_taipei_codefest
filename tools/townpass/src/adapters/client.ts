/** 上游讀取層：負責逾時、快取、content-type 與 schema 驗證，不含業務邏輯。 */

import type { z } from "zod";

import { UpstreamError, UpstreamFormatError } from "../shared/errors.js";

export interface Dataset<T> {
  /** 站內路徑或完整網址；只來自 datasets.ts，不接受模型輸入。 */
  url: string;
  label: string;
  schema: z.ZodType<T>;
  ttlMs: number;
  /**
   * 官方 blob 檔以 application/octet-stream 回傳 JSON；只有這類完整網址的官方檔案可略過 content-type 檢查，
   * 仍要通過 JSON 解析與 schema 驗證。示範站 SPA 的路徑不可略過（不存在的路徑會回 HTML）。
   */
  anyContentType?: boolean;
}

export interface ClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class TownPassClient {
  private readonly cache = new Map<string, { expires: number; value: Promise<unknown> }>();
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    // 不能直接存 fetch：瀏覽器以 this.fetchFn() 呼叫會丟 Illegal invocation。
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  load<T>(dataset: Dataset<T>): Promise<T> {
    const hit = this.cache.get(dataset.url);
    if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
    const value = this.fetchDataset(dataset);
    this.cache.set(dataset.url, { expires: Date.now() + dataset.ttlMs, value });
    value.catch(() => this.cache.delete(dataset.url));
    return value;
  }

  private async fetchDataset<T>(dataset: Dataset<T>): Promise<T> {
    const url = /^https?:/.test(dataset.url) ? dataset.url : `${this.options.baseUrl}${dataset.url}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, { signal: AbortSignal.timeout(this.options.timeoutMs) });
    } catch {
      throw new UpstreamError(`無法取得${dataset.label}`);
    }
    if (!response.ok) throw new UpstreamError(`取得${dataset.label}失敗（HTTP ${response.status}）`);

    // 示範站是 SPA：不存在的路徑也回 200 和 HTML，所以不能只看狀態碼。
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json") && !dataset.anyContentType) throw new UpstreamFormatError(dataset.label);

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new UpstreamFormatError(dataset.label);
    }
    const parsed = dataset.schema.safeParse(raw);
    if (!parsed.success) throw new UpstreamFormatError(dataset.label);
    return parsed.data;
  }
}

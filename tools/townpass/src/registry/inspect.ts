import { chromium } from "playwright";
import { z } from "zod";
import { assertPublicHttpUrl, type UrlPolicy } from "./url-policy.js";

export type ServiceObservation = Record<string, unknown>;

export const openApiDocumentSchema = z.object({
  openapi: z.string().startsWith("3."),
  servers: z.array(z.object({ url: z.string() })).optional(),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});

export type InspectOptions = UrlPolicy & { channel?: string };

const fetchTimeoutMs = 20_000;
const pageTimeoutMs = 30_000;
const maxRedirects = 5;

/** 逐跳檢查重新導向：每一跳都要通過同一個政策，避免公開網址導向內網位址。 */
async function fetchChecked(input: string, policy: UrlPolicy) {
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicHttpUrl(current, policy);
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(fetchTimeoutMs) });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = new URL(location, current).href;
      continue;
    }
    return { response, url: current };
  }
  throw new Error("重新導向次數過多");
}

export async function inspectService(url: string, options: InspectOptions = {}): Promise<ServiceObservation> {
  const policy: UrlPolicy = { allowPrivateHosts: options.allowPrivateHosts, resolveHost: options.resolveHost };
  const { response, url: finalUrl } = await fetchChecked(url, policy);
  if (!response.ok) throw new Error(`服務回應 HTTP ${response.status}`);
  if (response.headers.get("content-type")?.includes("json")) {
    const document: unknown = await response.json();
    if (!openApiDocumentSchema.safeParse(document).success) throw new Error("只支援 OpenAPI 3 JSON 規格");
    return { kind: "openapi", url: finalUrl, document };
  }
  await response.body?.cancel();
  const browser = await chromium.launch({ channel: options.channel });
  try {
    const page = await browser.newPage();
    // 頁面的每個請求（含重新導向與子資源）都經過同一個政策；被拒絕的請求直接中止。
    await page.route("**/*", async (route) => {
      try {
        await assertPublicHttpUrl(route.request().url(), policy);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    await page.goto(finalUrl, { waitUntil: "networkidle", timeout: pageTimeoutMs });
    return await page.evaluate<ServiceObservation>(String.raw`(() => {
      const selector = (element) => {
        if (element.id) return '#' + CSS.escape(element.id);
        if (element === document.body) return 'body';
        const parts = [];
        let current = element;
        while (current && current !== document.body) {
          const siblings = Array.from(current.parentElement.children).filter(s => s.tagName === current.tagName);
          parts.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')');
          current = current.parentElement;
        }
        return 'body > ' + parts.join(' > ');
      };
      const elements = Array.from(document.querySelectorAll('input:not([type=hidden]),select,textarea,button,a[href],[role=button],output,[role=status],[role=alert],[aria-live],form,[id]'));
      return {
        kind: 'page', url: location.href, title: document.title,
        text: document.body.innerText,
        elements: elements.map(element => ({
          selector: selector(element), tag: element.tagName.toLowerCase(),
          type: element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element.type : element.getAttribute('type'),
          name: element.getAttribute('name'), role: element.getAttribute('role'),
          label: Array.from(element.labels || []).map(label => label.textContent.trim()).join(' ') || element.getAttribute('aria-label'),
          placeholder: element.getAttribute('placeholder'), required: element.required === true,
          text: element.textContent.trim(), href: element.href,
          action: element.tagName === 'FORM' ? element.action : undefined,
          method: element.tagName === 'FORM' ? element.method : undefined,
          options: element.tagName === 'SELECT' ? Array.from(element.options).map(option => ({ value: option.value, label: option.text })) : undefined,
        })),
      };
    })()`);
  } finally {
    await browser.close();
  }
}

/**
 * 開發用的 app 內即時看板。
 *
 * 啟用後，安心助手每做一次模型推論，就把延遲、prefill／生成速度與 token 數畫到畫面最上方，
 * 不必接電腦、不必跑壓測腳本，直接在手機上看。資料全部來自 app 自己的模型回應（llama-server 的
 * timings）與瀏覽器 Battery API。
 *
 * 做不到的：記憶體 PSS／CPU／電池溫度／熱節流這些要靠電腦端 adb（dumpsys、/proc）抓，WebView
 * 內的網頁拿不到——那組請用 `pnpm stress:phone`（會把看板畫到手機上），或日後新增 Flutter 原生 bridge。
 *
 * 啟用：網址加 ?hud=1（會記在 localStorage，之後不用再帶）；關閉：?hud=0。
 */

type Sample = {
  at: number;
  model: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  prefillTps: number | null;
  decodeTps: number | null;
};

/** 記憶體等系統資源：WebView 自己讀不到，由電腦端 monitor 經除錯通道注入（見 scripts/monitor-phone.js）。 */
type Resources = {
  at: number;
  modelRssMb: number | null;
  appRssMb: number | null;
  sysAvailMb: number | null;
};

const STORAGE_KEY = 'townpass:dev-hud';
const MAX_SAMPLES = 50;
const RESOURCE_STALE_MS = 8000;
const samples: Sample[] = [];
let overlay: HTMLElement | null = null;
let battery: { level: number | null; charging: boolean | null } = { level: null, charging: null };
let resources: Resources | null = null;
let frame = 0;

/** 由電腦端 monitor 透過 window.__devHud.setResources(...) 注入即時記憶體數字。 */
function setResources(input: {
  modelRssMb?: number | null;
  appRssMb?: number | null;
  sysAvailMb?: number | null;
}): void {
  resources = {
    at: Date.now(),
    modelRssMb: finite(input.modelRssMb),
    appRssMb: finite(input.appRssMb),
    sysAvailMb: finite(input.sysAvailMb),
  };
  scheduleRender();
}

/** 只在瀏覽器且確實啟用時才動作；node（測試）與未啟用時一律 no-op。 */
function enabled(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  try {
    const flag = new URLSearchParams(window.location.search).get('hud');
    if (flag === '1' || flag === 'true') localStorage.setItem(STORAGE_KEY, '1');
    if (flag === '0' || flag === 'false') localStorage.removeItem(STORAGE_KEY);
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** 由模型層呼叫。帶入該次推論的延遲與原始回應，看板自己挑需要的欄位。 */
export function recordInference(input: { model: string; latencyMs: number; body: unknown }): void {
  if (!overlay) return; // 看板沒掛上（未啟用或非瀏覽器）就不留任何資料。
  const body = (input.body ?? {}) as Record<string, unknown>;
  const timings = (body.timings ?? {}) as Record<string, unknown>;
  const usage = (body.usage ?? {}) as Record<string, unknown>;
  samples.push({
    at: Date.now(),
    model: input.model,
    latencyMs: Math.round(input.latencyMs),
    promptTokens: finite(timings.prompt_n) ?? finite(usage.prompt_tokens),
    completionTokens: finite(timings.predicted_n) ?? finite(usage.completion_tokens),
    cachedTokens: finite(timings.cache_n),
    prefillTps: finite(timings.prompt_per_second),
    decodeTps: finite(timings.predicted_per_second),
  });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  scheduleRender();
}

const pct = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
};
const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const esc = (value: unknown): string =>
  String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
const show = (value: number | null, suffix = '', digits = 0): string =>
  value === null ? '—' : `${digits ? value.toFixed(digits) : Math.round(value)}${suffix}`;

/** 一張大數字卡片：上面大字是值，下面小字是標籤。 */
function tile(value: string, label: string, accent = '#e8f0ff'): string {
  return (
    `<div style="flex:1 1 72px;min-width:72px;background:rgba(255,255,255,.07);border-radius:10px;padding:7px 10px">` +
    `<div style="font-size:23px;font-weight:800;line-height:1.1;color:${accent}">${esc(value)}</div>` +
    `<div style="font-size:12px;opacity:.65;margin-top:3px">${esc(label)}</div>` +
    `</div>`
  );
}

function render(): void {
  if (!overlay) return;
  const last = samples.at(-1);
  const model = last?.model ?? '';
  const header =
    `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">` +
    `<span style="font-size:15px;font-weight:700;color:#7fc1ff">🛠 開發看板</span>` +
    `<span style="font-size:13px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(model)}</span>` +
    `</div>`;
  const note = `<div style="font-size:12px;opacity:.55;margin-top:1px">CPU／溫度／熱節流需用電腦端 pnpm stress:phone ·?hud=0 關閉</div>`;
  const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);

  // 模型效能（app 自己量得到）：有推論時顯示大數字卡＋累積統計，否則顯示提示。
  let perf: string;
  if (!last) {
    perf = `<div style="font-size:15px;opacity:.85;padding:4px 0">尚無推論——送一則訊息給安心助手就會出現</div>`;
  } else {
    const latencies = samples.map((s) => s.latencyMs);
    const decodes = samples.map((s) => s.decodeTps).filter((v): v is number => v !== null);
    const hero =
      `<div style="display:flex;gap:8px">` +
      tile(last.decodeTps !== null ? last.decodeTps.toFixed(1) : '—', '生成 tok/s', '#8affc1') +
      tile(secs(last.latencyMs), '本次延遲', '#ffe08a') +
      (last.prefillTps !== null ? tile(last.prefillTps.toFixed(1), 'prefill tok/s') : '') +
      (last.completionTokens !== null
        ? tile(
            `${last.completionTokens}${last.promptTokens !== null ? `／${last.promptTokens}` : ''}`,
            '輸出／輸入 tok',
          )
        : '') +
      `</div>`;
    const agg =
      `<div style="font-size:13px;opacity:.8">共 ${samples.length} 次` +
      ` ·延遲 p50 ${secs(pct(latencies, 50))} / p90 ${secs(pct(latencies, 90))} / max ${secs(Math.max(...latencies))}` +
      (decodes.length
        ? ` ·生成平均 ${show(mean(decodes), '', 1)}（最低 ${show(Math.min(...decodes), '', 1)}）tok/s`
        : '') +
      (battery.level !== null
        ? ` ·電量 ${Math.round(battery.level * 100)}%${battery.charging ? ' ⚡' : ''}`
        : '') +
      `</div>`;
    perf = hero + agg;
  }

  // 記憶體（WebView 讀不到，由電腦端 monitor 注入）。沒有 monitor 時整塊不出現。
  let mem = '';
  if (resources) {
    const stale = Date.now() - resources.at > RESOURCE_STALE_MS;
    const gb = (mb: number | null) => (mb === null ? '—' : (mb / 1024).toFixed(2));
    const cards =
      tile(gb(resources.modelRssMb), '模型 RAM GB', '#ff9db0') +
      tile(gb(resources.sysAvailMb), '系統可用 GB') +
      (resources.appRssMb !== null ? tile(gb(resources.appRssMb), 'App RAM GB') : '');
    mem =
      `<div style="font-size:12px;opacity:.6;margin-top:2px">記憶體（電腦端監看${stale ? ' · 停更' : ''}）</div>` +
      `<div style="display:flex;gap:8px${stale ? ';opacity:.45' : ''}">${cards}</div>`;
  }

  overlay.innerHTML = header + perf + mem + note;
}

function scheduleRender(): void {
  if (frame || typeof requestAnimationFrame === 'undefined') {
    if (typeof requestAnimationFrame === 'undefined') render();
    return;
  }
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

async function trackBattery(): Promise<void> {
  const getBattery = (navigator as unknown as { getBattery?: () => Promise<unknown> }).getBattery;
  if (typeof getBattery !== 'function') return;
  try {
    const b = (await getBattery.call(navigator)) as {
      level: number;
      charging: boolean;
      addEventListener?: (type: string, listener: () => void) => void;
    };
    const update = () => {
      battery = { level: b.level, charging: b.charging };
      scheduleRender();
    };
    update();
    b.addEventListener?.('levelchange', update);
    b.addEventListener?.('chargingchange', update);
  } catch {
    /* Battery API 不可用就略過，其他數字照常顯示。 */
  }
}

/** 由 main.ts 在啟動時呼叫一次。未啟用或非瀏覽器時什麼都不做。 */
export function mountDevHud(): void {
  if (overlay || !enabled()) return;
  overlay = document.createElement('div');
  overlay.id = 'dev-hud';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:2147483647;pointer-events:none;' +
    'display:flex;flex-direction:column;gap:7px;padding:12px 14px;' +
    'font:500 14px/1.5 system-ui,-apple-system,"Noto Sans TC",sans-serif;color:#e8f0ff;' +
    'background:#0b1426;border-bottom:2px solid #39f;box-shadow:0 4px 16px rgba(0,0,0,.55)';
  document.body.appendChild(overlay);
  // 讓電腦端 monitor 能注入記憶體數字（見 scripts/monitor-phone.js）。
  (window as unknown as { __devHud?: { setResources: typeof setResources } }).__devHud = {
    setResources,
  };
  render();
  void trackBattery();
}

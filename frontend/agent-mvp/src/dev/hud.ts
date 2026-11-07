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
  sysTotalMb: number | null;
};

const STORAGE_KEY = 'townpass:dev-hud';
const COLLAPSED_KEY = 'townpass:dev-hud-collapsed';
const MAX_SAMPLES = 50;
const RESOURCE_STALE_MS = 8000;
const samples: Sample[] = [];
let overlay: HTMLElement | null = null;
let battery: { level: number | null; charging: boolean | null } = { level: null, charging: null };
let resources: Resources | null = null;
let collapsed = false;
let frame = 0;

/** 展開／收合狀態記在 localStorage，重新整理後維持。 */
function toggleCollapsed(): void {
  collapsed = !collapsed;
  try {
    if (collapsed) localStorage.setItem(COLLAPSED_KEY, '1');
    else localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    /* 存不了就只在這次有效。 */
  }
  render();
}

/** 由電腦端 monitor 透過 window.__devHud.setResources(...) 注入即時記憶體數字。 */
function setResources(input: {
  modelRssMb?: number | null;
  appRssMb?: number | null;
  sysAvailMb?: number | null;
  sysTotalMb?: number | null;
}): void {
  resources = {
    at: Date.now(),
    modelRssMb: finite(input.modelRssMb),
    appRssMb: finite(input.appRssMb),
    sysAvailMb: finite(input.sysAvailMb),
    sysTotalMb: finite(input.sysTotalMb),
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
  const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);
  const gb = (mb: number | null) => (mb === null ? '—' : (mb / 1024).toFixed(2));
  // 「我們」＝模型行程＋App 行程（兩者 RSS 相加）。
  const ours =
    resources && (resources.modelRssMb !== null || resources.appRssMb !== null)
      ? (resources.modelRssMb ?? 0) + (resources.appRssMb ?? 0)
      : null;
  const total = resources?.sysTotalMb ?? null;
  const share = ours !== null && total ? Math.round((ours / total) * 100) : null;

  // 收合時標題列旁顯示一行摘要，展開時顯示模型名稱。
  const summary = collapsed
    ? [
        last?.decodeTps != null ? `${last.decodeTps.toFixed(1)} tok/s` : null,
        last ? secs(last.latencyMs) : null,
        ours !== null
          ? `我們 ${gb(ours)}${total ? `／${gb(total)}` : ''} GB${share !== null ? `（${share}%）` : ''}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || '尚無推論'
    : model;

  // 標題列是整個看板唯一可點的地方（其餘 pointer-events:none，點擊穿透到 app）。
  const header =
    `<button type="button" data-hud-toggle aria-expanded="${!collapsed}" aria-label="${collapsed ? '展開' : '收合'}開發看板" ` +
    `style="pointer-events:auto;display:flex;align-items:center;gap:10px;width:100%;min-height:44px;margin:-6px 0;padding:0;` +
    `border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer">` +
    `<span style="font-size:15px;font-weight:700;color:#7fc1ff;white-space:nowrap">🛠 開發看板</span>` +
    `<span style="flex:1;min-width:0;font-size:13px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(summary)}</span>` +
    `<span aria-hidden="true" style="font-size:13px;font-weight:700;color:#7fc1ff;white-space:nowrap">${collapsed ? '展開 ▾' : '收合 ▴'}</span>` +
    `</button>`;

  if (collapsed) {
    overlay.style.padding = '8px 14px';
    replaceContent(header);
    return;
  }
  overlay.style.padding = '12px 14px';

  const note = `<div style="font-size:12px;opacity:.55;margin-top:1px">CPU／溫度／熱節流需用電腦端 pnpm stress:phone ·?hud=0 關閉</div>`;

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
    const { modelRssMb, appRssMb, sysAvailMb } = resources;
    const cards =
      tile(
        `${gb(ours)}${share !== null ? ` · ${share}%` : ''}`,
        '我們佔用 GB（模型＋App）',
        '#ff9db0',
      ) +
      tile(gb(total), '手機總 RAM GB') +
      tile(gb(sysAvailMb), '系統可用 GB', '#8affc1');

    // 一條分段長條：模型／App／其他已用／可用，加起來＝手機總 RAM。
    let bar = '';
    if (total) {
      const others =
        sysAvailMb !== null
          ? Math.max(0, total - sysAvailMb - (modelRssMb ?? 0) - (appRssMb ?? 0))
          : null;
      const seg = (mb: number | null, color: string) =>
        mb
          ? `<div style="width:${((mb / total) * 100).toFixed(2)}%;background:${color}"></div>`
          : '';
      // 「可用」在長條上是沒填色的底，圖例用空心框表示，和「其他已用」的實心灰分開。
      const dot = (color: string, hollow = false) =>
        `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;` +
        (hollow ? `border:1.5px solid ${color}` : `background:${color}`) +
        `"></span>`;
      bar =
        `<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)">` +
        seg(modelRssMb, '#ff9db0') +
        seg(appRssMb, '#7fc1ff') +
        seg(others, '#6b7486') +
        `</div>` +
        `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;opacity:.85">` +
        `<span>${dot('#ff9db0')}模型 ${gb(modelRssMb)}</span>` +
        `<span>${dot('#7fc1ff')}App ${gb(appRssMb)}</span>` +
        `<span>${dot('#6b7486')}其他已用 ${gb(others)}</span>` +
        `<span>${dot('rgba(255,255,255,.6)', true)}可用 ${gb(sysAvailMb)}</span>` +
        `</div>`;
    }
    mem =
      `<div style="font-size:12px;opacity:.6;margin-top:2px">記憶體（電腦端監看${stale ? ' · 停更' : ''}）</div>` +
      `<div style="display:flex;flex-direction:column;gap:6px${stale ? ';opacity:.45' : ''}">` +
      `<div style="display:flex;gap:8px">${cards}</div>${bar}</div>`;
  }

  replaceContent(header + perf + mem + note);
}

/** 重畫時若焦點在切換鈕上，換完內容後把焦點還回去（monitor 每秒注入會一直重畫）。 */
function replaceContent(html: string): void {
  if (!overlay) return;
  const hadFocus = document.activeElement?.hasAttribute('data-hud-toggle') ?? false;
  overlay.innerHTML = html;
  if (hadFocus) overlay.querySelector<HTMLElement>('[data-hud-toggle]')?.focus();
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
  try {
    collapsed = localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    collapsed = false;
  }
  overlay = document.createElement('div');
  overlay.id = 'dev-hud';
  overlay.setAttribute('role', 'region');
  overlay.setAttribute('aria-label', '開發看板');
  // 內容每次重畫都會換掉，所以點擊用委派掛在外層。
  overlay.addEventListener('click', (event) => {
    if ((event.target as Element | null)?.closest('[data-hud-toggle]')) toggleCollapsed();
  });
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

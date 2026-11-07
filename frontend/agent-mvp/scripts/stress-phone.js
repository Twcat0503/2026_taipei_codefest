#!/usr/bin/env node
/**
 * 手機端壓力測試：手機上的 LFM3（llama-server 子行程）與安心助手的完整流程。
 *
 * 量測
 *   - 每筆請求：延遲、prompt／生成 token 數、prefill 與生成速度（llama-server 的 timings）
 *   - 背景取樣：App 與模型行程的 RSS／PSS、CPU、系統可用記憶體、電池溫度與電量、熱節流狀態
 *
 * 模式
 *   llm    直接對手機模型送 agent 的路由請求（不經畫面），量模型吞吐量；可設定同時請求數
 *   agent  透過 WebView 除錯通道操作安心助手畫面，量民眾實際等待的端到端時間
 *   both   先 llm 再 agent
 *
 * 前置條件
 *   - debug 版 App 已開啟安心助手頁（http://127.0.0.1:5173），USB 連著且有 adb reverse
 *   - 手機模型已下載；腳本會透過頁面的 llm_start 取得接點（模型沒在跑時會啟動它）
 *
 * 用法
 *   node scripts/stress-phone.js --mode llm --requests 40 --concurrency 1
 *   node scripts/stress-phone.js --mode agent --rounds 3
 *   node scripts/stress-phone.js --mode llm --duration 600        # 持續 10 分鐘，觀察發熱與記憶體
 *
 * 開發用：執行時會把即時看板畫到手機正在顯示的這一頁上（進度、延遲、生成速度、記憶體、
 *   溫度與熱節流），開發時不必盯著電腦終端機也能看。用 --hud false 關閉。
 *
 * 模型金鑰只留在記憶體，不寫檔、不輸出。結果寫在 stress-results/<時間>/（已列入 .gitignore）。
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { routerPrompt } from '../src/agent/prompts.ts';

const exec = promisify(execFile);

// ── 參數 ──
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--'))
      pairs.push([token.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]);
    return pairs;
  }, []),
);
const MODE = args.mode ?? 'both';
const REQUESTS = Number(args.requests ?? 30);
const CONCURRENCY = Math.max(1, Number(args.concurrency ?? 1));
const DURATION_S = Number(args.duration ?? 0);
const ROUNDS = Number(args.rounds ?? 2);
const SAMPLE_MS = Number(args['sample-ms'] ?? 3000);
const MAX_TOKENS = Number(args['max-tokens'] ?? 256);
const ADB =
  process.env.ADB ??
  (process.platform === 'darwin'
    ? '/opt/homebrew/share/android-commandlinetools/platform-tools/adb'
    : 'adb');
const PACKAGE = process.env.PACKAGE ?? 'com.example.townpass';
const DEVTOOLS_PORT = Number(process.env.DEVTOOLS_PORT ?? 9333);
const OUT = args.out ?? `stress-results/${new Date().toISOString().replace(/[:.]/g, '-')}`;

if (!['llm', 'agent', 'both'].includes(MODE)) throw new Error(`--mode 必須是 llm、agent 或 both`);

// ── adb ──
async function adb(...argv) {
  const { stdout } = await exec(ADB, argv, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}
const shell = (command) => adb('shell', command);
const pidOf = async (name) =>
  (await shell(`pidof ${name}`).catch(() => '')).trim().split(/\s+/)[0] || null;

/** USB 不穩時 adb 轉接會消失；每次用到前都重新建立。 */
async function ensureForwards(appPid, llamaPort) {
  // Only re-point the page when asked; the phone may be using a preview build on another port.
  if (process.env.PAGE_PORT)
    await adb('reverse', 'tcp:5173', `tcp:${process.env.PAGE_PORT}`).catch(() => {});
  await adb('forward', `tcp:${DEVTOOLS_PORT}`, `localabstract:webview_devtools_remote_${appPid}`);
  if (llamaPort) return Number((await adb('forward', 'tcp:0', `tcp:${llamaPort}`)).trim());
  return null;
}

// ── WebView 除錯通道 ──
async function connectPage() {
  const pages = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`)).json();
  const page = pages.find((p) => p.url.includes(':5173'));
  if (!page) throw new Error('找不到安心助手頁面：請先在 App 裡打開安心助手');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (message) => {
    const msg = JSON.parse(message.data);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.result?.exceptionDetails) entry.reject(new Error(msg.result.exceptionDetails.text));
    else entry.resolve(msg.result?.result?.value);
  };
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
  return { evaluate, close: () => ws.close() };
}

/** 用頁面的 bridge 呼叫 llm_start。requestId 是自己的，不會干擾安心助手本身的模型狀態。 */
async function phoneModelCredentials(page) {
  const reply = await page.evaluate(`new Promise((resolve, reject) => {
    const bridge = window.flutterObject;
    if (!bridge) return reject(new Error('not in app'));
    const requestId = 'stress-' + crypto.randomUUID();
    const onMessage = (event) => {
      try {
        const reply = JSON.parse(event.data);
        if (reply.name === 'llm_start' && reply.data?.requestId === requestId) {
          bridge.removeEventListener('message', onMessage);
          resolve(reply.data);
        }
      } catch {}
    };
    bridge.addEventListener('message', onMessage);
    bridge.postMessage(JSON.stringify({ name: 'llm_start', data: { requestId } }));
    setTimeout(() => reject(new Error('llm_start timeout')), 20 * 60 * 1000);
  })`);
  if (reply?.phase !== 'running' || !reply.baseUrl || !reply.apiKey)
    throw new Error(`手機模型沒有在執行：${reply?.phase ?? 'unknown'} ${reply?.error ?? ''}`);
  return {
    port: Number(new URL(reply.baseUrl).port),
    model: reply.model,
    key: reply.apiKey,
    config: {
      threads: reply.threads,
      contextSize: reply.contextSize,
      kvCacheType: reply.kvCacheType,
      flashAttention: reply.flashAttention,
    },
  };
}

// ── 背景取樣 ──
const samples = [];
async function takeSample(t0, pids) {
  const raw = await shell(
    [
      `grep VmRSS /proc/${pids.app}/status`,
      pids.llama ? `grep VmRSS /proc/${pids.llama}/status` : 'echo',
      `dumpsys meminfo ${pids.app} | grep -m1 'TOTAL PSS'`,
      pids.llama ? `dumpsys meminfo ${pids.llama} | grep -m1 'TOTAL PSS'` : 'echo',
      `grep MemAvailable /proc/meminfo`,
      `dumpsys battery | grep -E 'level|temperature'`,
      `dumpsys thermalservice | grep -m1 'Thermal Status'`,
      `top -b -n 1 -q -o PID,%CPU -p ${[pids.app, pids.llama].filter(Boolean).join(',')}`,
    ].join(' ; echo "|||" ; '),
  ).catch(() => null);
  if (!raw) return;
  const [rssApp, rssLlama, pssApp, pssLlama, memAvail, battery, thermal, top] = raw.split('|||');
  const kb = (text) => Number(text?.match(/(\d+)/)?.[1] ?? NaN);
  const pss = (text) => Number(text?.match(/TOTAL PSS:\s*(\d+)/)?.[1] ?? NaN);
  const cpu = Object.fromEntries(
    (top ?? '')
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols.length >= 2)
      .map(([pid, value]) => [pid, Number(value)]),
  );
  samples.push({
    t_s: ((Date.now() - t0) / 1000).toFixed(1),
    app_rss_mb: (kb(rssApp) / 1024).toFixed(1),
    llama_rss_mb: (kb(rssLlama) / 1024).toFixed(1),
    app_pss_mb: (pss(pssApp) / 1024).toFixed(1),
    llama_pss_mb: (pss(pssLlama) / 1024).toFixed(1),
    sys_available_mb: (kb(memAvail) / 1024).toFixed(0),
    app_cpu_pct: cpu[pids.app] ?? '',
    llama_cpu_pct: cpu[pids.llama] ?? '',
    battery_pct: battery.match(/level:\s*(\d+)/)?.[1] ?? '',
    battery_temp_c: (Number(battery.match(/temperature:\s*(\d+)/)?.[1] ?? NaN) / 10).toFixed(1),
    thermal_status: thermal.match(/Thermal Status:\s*(\d+)/)?.[1] ?? '',
  });
}
function startSampler(t0, pids) {
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const started = Date.now();
      await takeSample(t0, pids);
      await pushHud(t0);
      await new Promise((r) => setTimeout(r, Math.max(0, SAMPLE_MS - (Date.now() - started))));
    }
  })();
  return async () => {
    stopped = true;
    await loop;
  };
}

// ── 工作負載 ──
/** 和 agent 第一次推論（路由）相同的提示與結構化輸出；需求涵蓋快速選項與常見說法。 */
const UTTERANCES = [
  '附近的無障礙廁所',
  '附近有身障車位的停車場',
  '路燈壞了我要陳情',
  '我要繳水費',
  '查詢臨櫃叫號',
  '幫我找「神奇柑仔店」',
  '我想申請身障補助',
  '有哪些服務？',
  '大安區的 YouBike',
  '我懷孕了可以申請什麼',
  '家門口淹水了要通報',
  '今天天氣如何',
];
const ROUTER_EXAMPLES = [
  ['幫我查詢圖書', 'library'],
  ['我想知道有哪些申辦服務', 'services'],
  ['怎麼繳水費', 'services'],
  ['我想看到我這期的帳單與繳費狀態', 'bills'],
  ['有什麼優惠券', 'perks'],
  ['附近有 YouBike 嗎', 'places'],
  ['大安區的無障礙廁所', 'places'],
  ['請幫我寫一首詩', 'unsupported'],
];
const DOMAINS = ['library', 'services', 'perks', 'places', 'bills', 'unsupported'];
function routerRequest(model, utterance) {
  return {
    model,
    messages: [
      {
        role: 'system',
        content: `${routerPrompt}\nReturn only JSON matching the supplied schema.`,
      },
      ...ROUTER_EXAMPLES.flatMap(([request, domain]) => [
        { role: 'user', content: JSON.stringify({ original_request: request }) },
        {
          role: 'assistant',
          content: JSON.stringify({ name: 'select_agent', arguments: { domain } }),
        },
      ]),
      { role: 'user', content: JSON.stringify({ original_request: utterance }) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'agent_decision',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            name: { const: 'select_agent' },
            arguments: {
              type: 'object',
              properties: { domain: { type: 'string', enum: DOMAINS } },
              required: ['domain'],
              additionalProperties: false,
            },
          },
          required: ['name', 'arguments'],
          additionalProperties: false,
        },
      },
    },
    stream: false,
    temperature: 0,
    max_tokens: MAX_TOKENS,
  };
}

async function runLlm(credentials, localPort, t0) {
  const rows = [];
  const deadline = DURATION_S > 0 ? Date.now() + DURATION_S * 1000 : Infinity;
  let next = 0;
  const take = () => {
    if (DURATION_S > 0 ? Date.now() >= deadline : next >= REQUESTS) return null;
    return next++;
  };
  const worker = async (workerId) => {
    for (let i = take(); i !== null; i = take()) {
      const utterance = UTTERANCES[i % UTTERANCES.length];
      const started = Date.now();
      const row = {
        n: i + 1,
        worker: workerId,
        mode: 'llm',
        request: utterance,
        t_s: ((started - t0) / 1000).toFixed(1),
      };
      try {
        const response = await fetch(`http://127.0.0.1:${localPort}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${credentials.key}`,
          },
          body: JSON.stringify(routerRequest(credentials.model, utterance)),
          signal: AbortSignal.timeout(180_000),
        });
        const body = await response.json();
        row.ok = response.ok;
        row.status = response.status;
        row.latency_ms = Date.now() - started;
        row.prompt_tokens = body.timings?.prompt_n ?? body.usage?.prompt_tokens ?? '';
        row.cached_tokens = body.timings?.cache_n ?? '';
        row.completion_tokens = body.timings?.predicted_n ?? body.usage?.completion_tokens ?? '';
        row.prefill_tps = body.timings?.prompt_per_second?.toFixed?.(1) ?? '';
        row.decode_tps = body.timings?.predicted_per_second?.toFixed?.(1) ?? '';
        const content = body.choices?.[0]?.message?.content ?? '';
        row.answer = content.match(/"domain"\s*:\s*"(\w+)"/)?.[1] ?? content.slice(0, 40);
      } catch (error) {
        row.ok = false;
        row.latency_ms = Date.now() - started;
        row.error = error instanceof Error ? error.message : String(error);
      }
      rows.push(row);
      recordHud(row);
      await pushHud(t0);
      process.stdout.write(
        `  llm #${row.n} ${row.ok ? '✓' : '✗'} ${row.latency_ms} ms  ${row.decode_tps ? `${row.decode_tps} tok/s` : (row.error ?? '')}  ${row.request} → ${row.answer ?? ''}\n`,
      );
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w + 1)));
  return rows;
}

async function runAgent(page, t0) {
  const rows = [];
  const ready = await page.evaluate(`document.body.innerText.includes('已連接手機模型')`);
  if (!ready) throw new Error('安心助手的手機模型尚未連接：請先在頁面按「啟動手機模型」');
  let n = 0;
  for (let round = 1; round <= ROUNDS; round++)
    for (const utterance of UTTERANCES) {
      const started = Date.now();
      const row = {
        n: ++n,
        worker: 1,
        mode: 'agent',
        request: utterance,
        t_s: ((started - t0) / 1000).toFixed(1),
      };
      try {
        const result = await page.evaluate(`(async () => {
          const ta = document.querySelector('#request');
          if (!ta || ta.disabled) return { error: 'input disabled' };
          ta.value = ${JSON.stringify(utterance)};
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('form.composer').requestSubmit();
          await new Promise((r) => setTimeout(r, 300));
          const section = () => document.querySelector('section.assistant-message');
          for (let i = 0; i < 600 && section()?.getAttribute('aria-busy') === 'true'; i++)
            await new Promise((r) => setTimeout(r, 200));
          const s = section();
          return {
            notice: s.querySelector('[role=status]')?.textContent.trim().slice(0, 24),
            cards: s.querySelectorAll('.result-card').length,
            failed: [...s.querySelectorAll('.trace code')].some((c) => c.textContent.includes('failed')),
          };
        })()`);
        row.latency_ms = Date.now() - started;
        row.ok = !result.error && !result.failed;
        row.answer = result.error ?? `${result.notice}（${result.cards} 張卡片）`;
      } catch (error) {
        row.ok = false;
        row.latency_ms = Date.now() - started;
        row.error = error instanceof Error ? error.message : String(error);
      }
      rows.push(row);
      recordHud(row);
      await pushHud(t0);
      process.stdout.write(
        `  agent #${row.n} ${row.ok ? '✓' : '✗'} ${row.latency_ms} ms  ${utterance} → ${row.answer ?? row.error}\n`,
      );
    }
  return rows;
}

// ── 統計與輸出 ──
const pct = (values, p) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const num = (list, key) => list.map((r) => Number(r[key])).filter(Number.isFinite);
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
const round = (value, digits = 1) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function summarize(rows, wallSeconds) {
  const ok = rows.filter((r) => r.ok);
  const latency = num(ok, 'latency_ms');
  return {
    requests: rows.length,
    ok: ok.length,
    failed: rows.length - ok.length,
    wall_s: round(wallSeconds),
    throughput_req_per_min: round((ok.length / wallSeconds) * 60, 2),
    latency_ms: {
      p50: pct(latency, 50),
      p90: pct(latency, 90),
      p99: pct(latency, 99),
      max: Math.max(...latency),
    },
    prefill_tok_per_s_avg: round(mean(num(ok, 'prefill_tps'))),
    decode_tok_per_s_avg: round(mean(num(ok, 'decode_tps'))),
    decode_tok_per_s_min: round(Math.min(...num(ok, 'decode_tps'))),
    prompt_tokens_avg: round(mean(num(ok, 'prompt_tokens')), 0),
    completion_tokens_avg: round(mean(num(ok, 'completion_tokens')), 0),
  };
}
function summarizeSamples() {
  const series = (key) => num(samples, key);
  const stat = (key) => {
    const values = series(key);
    return values.length
      ? {
          start: values[0],
          peak: Math.max(...values),
          end: values.at(-1),
          growth: round(values.at(-1) - values[0]),
        }
      : null;
  };
  return {
    samples: samples.length,
    app_pss_mb: stat('app_pss_mb'),
    llama_pss_mb: stat('llama_pss_mb'),
    app_rss_mb: stat('app_rss_mb'),
    llama_rss_mb: stat('llama_rss_mb'),
    sys_available_mb_min: Math.min(...series('sys_available_mb')),
    llama_cpu_pct_avg: round(mean(series('llama_cpu_pct'))),
    llama_cpu_pct_peak: Math.max(...series('llama_cpu_pct')),
    battery_temp_c: stat('battery_temp_c'),
    battery_pct: stat('battery_pct'),
    thermal_status_peak: Math.max(...series('thermal_status')),
  };
}
const csv = (rows) => {
  if (!rows.length) return '';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) =>
    v === undefined || v === null
      ? ''
      : /[",\n]/.test(String(v))
        ? `"${String(v).replace(/"/g, '""')}"`
        : String(v);
  return (
    [keys.join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\n') + '\n'
  );
};

// ── 手機上的即時看板（開發用）──
// 壓測腳本本來就握著這一頁的除錯通道，順手把目前進度與資源狀況畫到手機畫面上，
// 開發時不必盯著電腦終端機也能看。看板掛在 <body>（Vue 的 #app 之外，重繪不會被移除），
// pointer-events:none 讓點擊穿透，不影響 agent 模式對畫面的操作。用 --hud false 可關閉。
const HUD = args.hud !== 'false';
const hud = {
  device: '',
  model: '',
  mode: MODE,
  total: DURATION_S > 0 ? null : REQUESTS,
  duration: DURATION_S,
  done: 0,
  ok: 0,
  fail: 0,
  latencies: [],
  decodes: [],
  last: '等待第一筆請求…',
  phase: 'running',
};
const escHtml = (value) =>
  String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
function recordHud(row) {
  hud.done += 1;
  if (row.ok) hud.ok += 1;
  else hud.fail += 1;
  if (Number.isFinite(row.latency_ms)) hud.latencies.push(row.latency_ms);
  const decode = Number(row.decode_tps);
  if (Number.isFinite(decode)) hud.decodes.push(decode);
  hud.last = `#${row.n} ${row.ok ? '✓' : '✗'} ${row.latency_ms} ms  ${row.request} → ${row.answer ?? row.error ?? ''}`;
}
function hudHtml(t0) {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  const progress = hud.total
    ? `${hud.done}/${hud.total} 筆`
    : `${elapsed}s / ${hud.duration || '∞'}s`;
  const latLine = hud.latencies.length
    ? `p50 ${pct(hud.latencies, 50)}·p90 ${pct(hud.latencies, 90)}·max ${Math.max(...hud.latencies)} ms`
    : '—';
  const decodeAvg = hud.decodes.length ? round(mean(hud.decodes)) : null;
  const s = samples;
  const col = (key) => num(s, key);
  const peak = (key) => (col(key).length ? Math.max(...col(key)) : null);
  const now = (key) => (s.length ? Number(s.at(-1)[key]) : null);
  const show = (value, suffix = '') =>
    value === null || !Number.isFinite(value) ? '—' : `${value}${suffix}`;
  const llamaPeak = peak('llama_pss_mb');
  const sysMin = col('sys_available_mb').length ? Math.min(...col('sys_available_mb')) : null;
  const cpuPeak = peak('llama_cpu_pct');
  const tempNow = now('battery_temp_c');
  const tempPeak = peak('battery_temp_c');
  const battNow = now('battery_pct');
  const thermalPeak = peak('thermal_status') ?? 0;
  const hot = thermalPeak > 0;
  const head = hud.phase === 'done' ? '✅ 壓測完成' : '● 壓測進行中';
  return [
    `<div style="display:flex;justify-content:space-between;gap:8px;font-weight:700;color:${hud.phase === 'done' ? '#8affc1' : '#7fc1ff'}"><span>${head}</span><span style="opacity:.85">${escHtml(hud.device)} · ${escHtml(hud.model)}</span></div>`,
    `<div>${escHtml(hud.mode)} · ${progress} · ✓${hud.ok} ✗${hud.fail} · 延遲 ${latLine}${decodeAvg != null ? ` · 生成 ${decodeAvg} tok/s` : ''}</div>`,
    `<div>記憶體 模型峰值 ${show(llamaPeak, ' MB')} · 系統可用最低 ${show(sysMin, ' MB')} · CPU峰值 ${show(cpuPeak, '%')}</div>`,
    `<div style="${hot ? 'color:#ffb4b4' : ''}">溫度 ${show(tempNow)}→峰值 ${show(tempPeak, '°C')} · 電量 ${show(battNow, '%')} · 熱節流 ${thermalPeak}${hot ? ' ⚠️' : ''}</div>`,
    `<div style="opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(hud.last)}</div>`,
  ].join('');
}
let hudBusy = false;
async function pushHud(t0) {
  if (!HUD || hudBusy) return;
  hudBusy = true;
  try {
    const expr = `(() => {
      let el = document.getElementById('stress-hud');
      if (!el) {
        el = document.createElement('div');
        el.id = 'stress-hud';
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;pointer-events:none;display:flex;flex-direction:column;gap:3px;padding:10px 12px;font:600 14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8f0ff;background:rgba(9,16,32,.93);border-bottom:2px solid #39f;box-shadow:0 2px 12px rgba(0,0,0,.45)';
        document.body.appendChild(el);
      }
      el.innerHTML = ${JSON.stringify(hudHtml(t0))};
    })()`;
    await page.evaluate(expr);
  } catch {
    // 看板失敗不該影響壓測本身
  } finally {
    hudBusy = false;
  }
}

// ── 主流程 ──
const appPid = await pidOf(PACKAGE);
if (!appPid) throw new Error(`手機上沒有在執行 ${PACKAGE}`);
await ensureForwards(appPid);
const page = await connectPage();
console.log('取得手機模型接點…（模型沒在跑時會啟動，第一次可能要數分鐘）');
const credentials = await phoneModelCredentials(page);
const llamaPid = await pidOf('libllama_server.so');
const localPort = await ensureForwards(appPid, credentials.port);
const device = (await shell('getprop ro.product.model')).trim();
const soc = (await shell('getprop ro.soc.model').catch(() => '')).trim();
console.log(
  `裝置 ${device}${soc ? `（${soc}）` : ''}；模型 ${credentials.model}；設定 ${JSON.stringify(credentials.config)}`,
);
console.log(
  `模式 ${MODE}；${DURATION_S ? `持續 ${DURATION_S} 秒` : `${REQUESTS} 筆`}；同時 ${CONCURRENCY} 筆；取樣每 ${SAMPLE_MS} ms\n`,
);

if (HUD) console.log('手機畫面右上看板會顯示即時進度與資源（--hud false 可關閉）');

const t0 = Date.now();
const pids = { app: appPid, llama: llamaPid };
hud.device = device;
hud.model = credentials.model;
await takeSample(t0, pids);
await pushHud(t0);
const stopSampler = startSampler(t0, pids);
const results = {};
let rows = [];
try {
  if (MODE !== 'agent') {
    const started = Date.now();
    const llmRows = await runLlm(credentials, localPort, t0);
    results.llm = summarize(llmRows, (Date.now() - started) / 1000);
    rows = rows.concat(llmRows);
  }
  if (MODE !== 'llm') {
    const started = Date.now();
    const agentRows = await runAgent(page, t0);
    results.agent = summarize(agentRows, (Date.now() - started) / 1000);
    rows = rows.concat(agentRows);
  }
} finally {
  await stopSampler();
  await takeSample(t0, pids);
  hud.phase = 'done';
  await pushHud(t0);
  page.close();
  await adb('forward', '--remove', `tcp:${localPort}`).catch(() => {});
}

const summary = {
  when: new Date(t0).toISOString(),
  device,
  soc,
  model: credentials.model,
  model_config: credentials.config,
  settings: {
    mode: MODE,
    requests: REQUESTS,
    duration_s: DURATION_S,
    concurrency: CONCURRENCY,
    rounds: ROUNDS,
    max_tokens: MAX_TOKENS,
  },
  ...results,
  resources: summarizeSamples(),
};
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/requests.csv`, csv(rows));
await writeFile(`${OUT}/samples.csv`, csv(samples));
await writeFile(`${OUT}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);

const line = (label, s) =>
  s
    ? `${label}: ${s.ok}/${s.requests} 成功｜${s.throughput_req_per_min} 筆/分｜延遲 p50 ${s.latency_ms.p50} ms、p90 ${s.latency_ms.p90} ms、最大 ${s.latency_ms.max} ms` +
      (Number.isFinite(s.decode_tok_per_s_avg) && s.decode_tok_per_s_avg !== null
        ? `｜prefill ${s.prefill_tok_per_s_avg} tok/s、生成 ${s.decode_tok_per_s_avg} tok/s（最低 ${s.decode_tok_per_s_min}）｜平均 prompt ${s.prompt_tokens_avg}、輸出 ${s.completion_tokens_avg} tokens`
        : '')
    : '';
const r = summary.resources;
console.log(`\n── 結果 ──`);
if (results.llm) console.log(line('模型直連', results.llm));
if (results.agent) console.log(line('安心助手', results.agent));
console.log(
  `記憶體 PSS：模型 ${r.llama_pss_mb?.start}→峰值 ${r.llama_pss_mb?.peak} MB（增 ${r.llama_pss_mb?.growth}）；App ${r.app_pss_mb?.start}→峰值 ${r.app_pss_mb?.peak} MB（增 ${r.app_pss_mb?.growth}）；系統可用最低 ${r.sys_available_mb_min} MB`,
);
console.log(
  `CPU（模型行程）平均 ${r.llama_cpu_pct_avg}%、峰值 ${r.llama_cpu_pct_peak}%｜電池溫度 ${r.battery_temp_c?.start}→${r.battery_temp_c?.peak}°C｜電量 ${r.battery_pct?.start}→${r.battery_pct?.end}%｜熱節流狀態峰值 ${r.thermal_status_peak}（0＝正常）`,
);
console.log(`\n明細：${OUT}/requests.csv、${OUT}/samples.csv、${OUT}/summary.json`);

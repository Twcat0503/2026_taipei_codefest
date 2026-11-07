#!/usr/bin/env node
/**
 * 被動記憶體監看：透過 adb 定時讀手機上的模型行程 RSS、App RSS 與系統可用記憶體，
 * 再經 WebView 除錯通道注入安心助手頁面的開發看板（window.__devHud.setResources）。
 *
 * 和壓測腳本不同，這支不送任何請求、不施加負載，只是把 app 自己讀不到的記憶體數字補上去，
 * 讓你在手機畫面就能看到 RAM 佔用。平常開發時可以一直掛著。
 *
 * 前置條件
 *   - 手機 USB 連著、adb 可用
 *   - debug 版 App 已開著安心助手頁（127.0.0.1:5173），且該頁已啟用看板（網址帶過一次 ?hud=1）
 *
 * 用法
 *   node scripts/monitor-phone.js                 # 每 2 秒更新一次
 *   node scripts/monitor-phone.js --sample-ms 1000
 *
 * Ctrl-C 結束。結束時會把看板上的記憶體區塊標成「停更」。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--'))
      pairs.push([token.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]);
    return pairs;
  }, []),
);
const SAMPLE_MS = Math.max(500, Number(args['sample-ms'] ?? 2000));
const ADB =
  process.env.ADB ??
  (process.platform === 'darwin'
    ? '/opt/homebrew/share/android-commandlinetools/platform-tools/adb'
    : 'adb');
const PACKAGE = process.env.PACKAGE ?? 'com.example.townpass';
const MODEL_PROC = process.env.MODEL_PROC ?? 'libllama_server.so';
const DEVTOOLS_PORT = Number(process.env.DEVTOOLS_PORT ?? 9333);

async function adb(...argv) {
  const { stdout } = await exec(ADB, argv, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}
const shell = (command) => adb('shell', command);
const pidOf = async (name) =>
  (await shell(`pidof ${name}`).catch(() => '')).trim().split(/\s+/)[0] || null;

/** 連上安心助手頁面的除錯通道，取得 evaluate()。 */
async function connectPage() {
  const appPid = await pidOf(PACKAGE);
  if (!appPid) throw new Error(`手機上沒有在執行 ${PACKAGE}`);
  await adb('forward', `tcp:${DEVTOOLS_PORT}`, `localabstract:webview_devtools_remote_${appPid}`);
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
  return { appPid, evaluate, close: () => ws.close() };
}

/** 一次 adb shell 把三個記憶體數字都讀回來，省往返。 */
async function readMemory(appPid, modelPid) {
  const raw = await shell(
    [
      `grep VmRSS /proc/${appPid}/status`,
      modelPid ? `grep VmRSS /proc/${modelPid}/status` : 'echo',
      `grep MemAvailable /proc/meminfo`,
      `grep MemTotal /proc/meminfo`,
    ].join(' ; echo "|||" ; '),
  ).catch(() => null);
  if (!raw) return null;
  const [appRss, modelRss, memAvail, memTotal] = raw.split('|||');
  const mb = (text) => {
    const kb = Number(text?.match(/(\d+)/)?.[1] ?? NaN);
    return Number.isFinite(kb) ? kb / 1024 : null;
  };
  return {
    appRssMb: mb(appRss),
    modelRssMb: modelPid ? mb(modelRss) : null,
    sysAvailMb: mb(memAvail),
    sysTotalMb: mb(memTotal),
  };
}

const page = await connectPage();
const ready = await page.evaluate(`!!(window.__devHud && window.__devHud.setResources)`);
if (!ready)
  throw new Error('安心助手頁面沒有啟用開發看板：請先用 http://127.0.0.1:5173/?hud=1 開一次');
console.log(`開始監看（每 ${SAMPLE_MS} ms）。Ctrl-C 結束。\n`);

let running = true;
process.on('SIGINT', () => {
  running = false;
});

while (running) {
  const started = Date.now();
  const modelPid = await pidOf(MODEL_PROC);
  const mem = await readMemory(page.appPid, modelPid);
  if (mem) {
    await page.evaluate(`window.__devHud?.setResources(${JSON.stringify(mem)})`).catch(() => {});
    const g = (mb) => (mb === null ? '—' : (mb / 1024).toFixed(2));
    process.stdout.write(
      `\r我們 ${g((mem.modelRssMb ?? 0) + (mem.appRssMb ?? 0))}／總共 ${g(mem.sysTotalMb)} GB（模型 ${g(mem.modelRssMb)}、App ${g(mem.appRssMb)}）｜系統可用 ${g(mem.sysAvailMb)} GB${modelPid ? '' : '（模型未執行）'}        `,
    );
  }
  await new Promise((r) => setTimeout(r, Math.max(0, SAMPLE_MS - (Date.now() - started))));
}

page.close();
await adb('forward', '--remove', `tcp:${DEVTOOLS_PORT}`).catch(() => {});
console.log('\n已停止監看。');
process.exit(0);

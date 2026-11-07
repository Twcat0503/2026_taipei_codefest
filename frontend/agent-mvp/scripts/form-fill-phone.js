#!/usr/bin/env node
/**
 * 在手機上的模型跑填表評測（tests/form-fill.eval.ts）。
 *
 * 前置條件（同 stress-phone.js）：debug 版 App 已開啟安心助手頁（http://127.0.0.1:5173），
 * USB 連著且有 adb reverse tcp:5173 tcp:5173；手機模型已下載（沒在跑時會啟動）。
 *
 * 用法
 *   node scripts/form-fill-phone.js
 *   FORM_EVAL_CONDITIONS=generic node scripts/form-fill-phone.js
 *
 * 透過頁面 bridge 的 llm_start 取得接點；模型金鑰只放在子行程的環境變數（記憶體），
 * 不寫檔、不輸出。結果寫在 form-fill-eval.phone.json（已列入 .gitignore）。
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ADB =
  process.env.ADB ??
  (process.platform === 'darwin'
    ? '/opt/homebrew/share/android-commandlinetools/platform-tools/adb'
    : 'adb');
const PACKAGE = process.env.PACKAGE ?? 'com.example.townpass';
const DEVTOOLS_PORT = Number(process.env.DEVTOOLS_PORT ?? 9333);
const adb = async (...argv) => (await exec(ADB, argv, { timeout: 30_000 })).stdout;

const appPid = (await adb('shell', `pidof ${PACKAGE}`).catch(() => '')).trim().split(/\s+/)[0];
if (!appPid) throw new Error(`手機上沒有在執行 ${PACKAGE}`);
await adb('forward', `tcp:${DEVTOOLS_PORT}`, `localabstract:webview_devtools_remote_${appPid}`);

const pages = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`)).json();
const target = pages.find((p) => p.url.includes(':5173'));
if (!target) throw new Error('找不到安心助手頁面：請先在 App 裡打開安心助手');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const ask = () =>
  new Promise((resolve, reject) => {
    ws.onmessage = (message) => {
      const msg = JSON.parse(message.data);
      if (msg.id !== 1) return;
      if (msg.result?.exceptionDetails) reject(new Error(msg.result.exceptionDetails.text));
      else resolve(msg.result?.result?.value);
    };
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          awaitPromise: true,
          returnByValue: true,
          expression: `new Promise((resolve, reject) => {
          const bridge = window.flutterObject;
          if (!bridge) return reject(new Error('not in app'));
          const requestId = 'form-eval-' + crypto.randomUUID();
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
        })`,
        },
      }),
    );
  });

// The model may still be starting (or restarting after the system stopped it): wait for it.
let reply = await ask();
for (let attempt = 0; attempt < 24 && reply?.phase !== 'running'; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  reply = await ask();
}
ws.close();
if (reply?.phase !== 'running' || !reply.baseUrl || !reply.apiKey)
  throw new Error(`手機模型沒有在執行：${reply?.phase ?? 'unknown'} ${reply?.error ?? ''}`);

const remote = new URL(reply.baseUrl);
const localPort = Number((await adb('forward', 'tcp:0', `tcp:${remote.port}`)).trim());
const device = (await adb('shell', 'getprop ro.product.model')).trim();
console.log(`裝置 ${device}；模型 ${reply.model}；本機轉接埠 ${localPort}`);

const child = spawn(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.eval.config.ts',
    process.env.FORM_EVAL_FILE ?? 'tests/form-fill.eval.ts',
    '--testTimeout',
    '200000',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      MODEL_ENDPOINT: `http://127.0.0.1:${localPort}${remote.pathname.replace(/\/$/, '')}/chat/completions`,
      MODEL_NAME: reply.model,
      MODEL_API_KEY: reply.apiKey,
      MODEL_OLLAMA_HINTS: '0',
      MODEL_TIMEOUT_MS: '90000',
      MODEL_HOST: `${device} (phone)`,
      FORM_EVAL_OUT: process.env.FORM_EVAL_OUT ?? 'form-fill-eval.phone.json',
    },
  },
);
const code = await new Promise((resolve) => child.on('exit', resolve));
await adb('forward', '--remove', `tcp:${localPort}`).catch(() => {});
process.exit(code ?? 1);

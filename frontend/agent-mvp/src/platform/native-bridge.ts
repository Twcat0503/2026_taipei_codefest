import type { FlutterBridge } from './llm-bridge';

/**
 * Generic, correlated request/reply helpers for the Flutter WebView bridge (`window.flutterObject`).
 *
 * Wire format: `postMessage(JSON.stringify({ name, data }))` out; replies arrive as `message` events
 * whose `event.data` is a JSON string `{ name, data }`. A reply belongs to a request when both the
 * `name` and `data.requestId` match. NativeLlmBridge in ./llm-bridge.ts applies the same rules to the
 * LLM handlers on its own and could migrate to this module later.
 */

export type NativeData = Record<string, unknown>;
export type NativeHandler = (data: NativeData) => void;

type NativeEvent = { data: unknown };
type Subscription = { name: string; requestId: string; handler: NativeHandler };

const MAX_MESSAGE_LENGTH = 10000;
const MAX_REQUEST_ID_LENGTH = 64;
const DEFAULT_TIMEOUT_MS = 3000;

const subscriptions = new Set<Subscription>();
let attached: { bridge: FlutterBridge; detach: () => void } | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function currentBridge(): FlutterBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = window.flutterObject;
  return bridge && typeof bridge.postMessage === 'function' ? bridge : undefined;
}

/** Whether the page runs inside the Flutter app (a usable `window.flutterObject` exists). */
export function hasNativeBridge(): boolean {
  return currentBridge() !== undefined;
}

/** A fresh request ID (a UUID, 36 characters). */
export function newNativeRequestId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // randomUUID needs a secure context; plain-HTTP development origins such as
  // http://10.0.2.2:5173 do not have it, but getRandomValues is always there.
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function receive(event: NativeEvent | undefined) {
  const raw = event?.data;
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_LENGTH) return;
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return; // Malformed or unrelated bridge message.
  }
  if (!isRecord(message)) return;
  const { name, data } = message;
  if (typeof name !== 'string' || !isRecord(data)) return;
  const requestId = data.requestId;
  if (typeof requestId !== 'string' || requestId.length > MAX_REQUEST_ID_LENGTH) return;
  for (const subscription of [...subscriptions]) {
    if (subscription.name !== name || subscription.requestId !== requestId) continue;
    try {
      subscription.handler(data);
    } catch {
      /* A faulty handler must not stop the other listeners. */
    }
  }
}

function attachTo(bridge: FlutterBridge): { bridge: FlutterBridge; detach: () => void } {
  if (bridge.addEventListener && bridge.removeEventListener) {
    bridge.addEventListener('message', receive);
    return { bridge, detach: () => bridge.removeEventListener?.('message', receive) };
  }
  // Without the event API, chain the handler that is already installed on `onmessage`.
  const previous = bridge.onmessage;
  const chained = (event: { data: string }) => {
    try {
      previous?.call(bridge, event);
    } finally {
      receive(event);
    }
  };
  bridge.onmessage = chained;
  return {
    bridge,
    detach: () => {
      if (bridge.onmessage === chained) bridge.onmessage = previous ?? null;
    },
  };
}

/** Attaches the single message listener to the current bridge, re-attaching if it was replaced. */
function ensureAttached(): FlutterBridge | undefined {
  const bridge = currentBridge();
  if (!bridge) return undefined;
  if (attached?.bridge === bridge) return bridge;
  try {
    attached?.detach();
  } catch {
    /* The replaced bridge may already be gone. */
  }
  attached = undefined;
  try {
    attached = attachTo(bridge);
  } catch {
    return undefined;
  }
  return bridge;
}

/** Fire-and-forget. Returns false when there is no bridge or `postMessage` throws. */
export function postNative(name: string, data: unknown): boolean {
  const bridge = currentBridge();
  if (!bridge) return false;
  try {
    bridge.postMessage(JSON.stringify({ name, data }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Calls `handler` with the `data` of every reply named `name` that echoes `requestId`, for flows
 * where one request gets several replies. Returns the unsubscribe function.
 */
export function listenNative(name: string, requestId: string, handler: NativeHandler): () => void {
  ensureAttached();
  const subscription: Subscription = { name, requestId, handler };
  subscriptions.add(subscription);
  return () => {
    subscriptions.delete(subscription);
  };
}

/**
 * Sends `name` with a fresh `requestId` and resolves with the `data` of the first matching reply.
 * Rejects with Error('NATIVE_BRIDGE_UNAVAILABLE'), Error('NATIVE_BRIDGE_TIMEOUT') or an AbortError.
 */
export function requestNative(
  name: string,
  data: NativeData = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<NativeData> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    if (!ensureAttached()) {
      reject(new Error('NATIVE_BRIDGE_UNAVAILABLE'));
      return;
    }
    const requestId = newNativeRequestId();
    let settled = false;
    const finish = (error?: Error, reply?: NativeData) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unlisten();
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(reply ?? {});
    };
    const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('NATIVE_BRIDGE_TIMEOUT')), timeoutMs);
    const unlisten = listenNative(name, requestId, (reply) => finish(undefined, reply));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (!postNative(name, { ...data, requestId })) finish(new Error('NATIVE_BRIDGE_UNAVAILABLE'));
  });
}

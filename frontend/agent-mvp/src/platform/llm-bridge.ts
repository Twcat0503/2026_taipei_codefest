export type LlmBridgeName = 'llm_start' | 'llm_status' | 'llm_stop';
type NativeMessage = { data: string };
export type FlutterBridge = {
  postMessage(message: string): void;
  addEventListener?(name: 'message', listener: (event: NativeMessage) => void): void;
  removeEventListener?(name: 'message', listener: (event: NativeMessage) => void): void;
  onmessage?: ((event: NativeMessage) => void) | null;
};
declare global {
  interface Window {
    flutterObject?: FlutterBridge;
  }
}

export interface LlmBridge {
  call(
    name: LlmBridgeName,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown>;
  dispose(): void;
}

/** Correlated replies prevent cancelled/retried starts from accepting a late API key. */
export class NativeLlmBridge implements LlmBridge {
  private pending = new Map<
    string,
    { name: LlmBridgeName; finish: (data: unknown, error?: Error) => void }
  >();
  private bridge?: FlutterBridge;
  private previous?: FlutterBridge['onmessage'];
  private fallback?: (event: NativeMessage) => void;
  private receive = (event: NativeMessage) => {
    try {
      if (typeof event.data !== 'string' || event.data.length > 10000) return;
      const reply = JSON.parse(event.data);
      const id = reply?.data?.requestId;
      if (typeof id !== 'string') return;
      const entry = this.pending.get(id);
      if (entry && entry.name === reply.name) entry.finish(reply.data);
    } catch {
      /* Ignore malformed or unrelated bridge messages. */
    }
  };
  private attach() {
    const bridge = window.flutterObject;
    if (!bridge || typeof bridge.postMessage !== 'function')
      throw new Error('PHONE_BRIDGE_UNAVAILABLE');
    if (this.bridge === bridge) return;
    this.dispose();
    this.bridge = bridge;
    if (bridge.addEventListener && bridge.removeEventListener)
      bridge.addEventListener('message', this.receive);
    else {
      this.previous = bridge.onmessage;
      this.fallback = (event) => {
        this.previous?.(event);
        this.receive(event);
      };
      bridge.onmessage = this.fallback;
    }
  }
  call(
    name: LlmBridgeName,
    { signal, timeoutMs = 5000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<unknown> {
    try {
      signal?.throwIfAborted();
      this.attach();
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const abort = () => finish(undefined, new DOMException('Aborted', 'AbortError'));
      const timer = setTimeout(
        () => finish(undefined, new Error('PHONE_BRIDGE_TIMEOUT')),
        timeoutMs,
      );
      const finish = (data: unknown, error?: Error) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(data);
      };
      this.pending.set(requestId, { name, finish });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.bridge!.postMessage(JSON.stringify({ name, data: { requestId } }));
      } catch {
        finish(undefined, new Error('PHONE_BRIDGE_FAILED'));
      }
    });
  }
  dispose() {
    for (const entry of [...this.pending.values()])
      entry.finish(undefined, new Error('PHONE_BRIDGE_DISPOSED'));
    if (this.bridge?.removeEventListener) this.bridge.removeEventListener('message', this.receive);
    else if (this.bridge && this.bridge.onmessage === this.fallback)
      this.bridge.onmessage = this.previous ?? null;
    this.bridge = undefined;
    this.previous = undefined;
    this.fallback = undefined;
  }
}

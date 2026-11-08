import { NativeLlmBridge, type LlmBridge } from '../platform/llm-bridge';
import { LocalModel, validateEndpoint } from './model';
import type { ModelAdapter, VisionRequest } from './types';

export type PhonePhase = 'idle' | 'downloading' | 'starting' | 'running' | 'stopping' | 'error';
export type PhoneState = {
  phase: PhonePhase;
  ready: boolean;
  error: 'unavailable' | 'permission' | 'start' | 'status' | 'stop' | 'auth' | null;
};
const idle = (): PhoneState => ({ phase: 'idle', ready: false, error: null });
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function status(value: unknown) {
  if (!record(value)) throw new Error('PHONE_INVALID_STATUS');
  if (value.error === 'origin_not_allowed') throw new Error('PHONE_ORIGIN_DENIED');
  if (
    !['idle', 'downloading', 'starting', 'running', 'error'].includes(String(value.phase)) ||
    typeof value.phase !== 'string' ||
    typeof value.running !== 'boolean' ||
    value.running !== (value.phase === 'running')
  )
    throw new Error('PHONE_INVALID_STATUS');
  return value;
}

/** Credentials stay in this adapter, never in Vue state, storage, traces or model messages. */
export class PhoneModel implements ModelAdapter {
  readonly mode = 'phone' as const;
  readonly requestTimeoutMs = 90000;
  private transport: LocalModel | null = null;
  private credentials: { endpoint: string; model: string; key: string } | null = null;
  private generation = 0;
  private startup: AbortController | null = null;
  private stopping: Promise<void> | null = null;
  private inference = new Set<AbortController>();
  private current = idle();
  constructor(
    private publish: (state: PhoneState) => void = () => {},
    private bridge: LlmBridge = new NativeLlmBridge(),
    private pollMs = 1000,
  ) {}
  get state(): PhoneState {
    return { ...this.current };
  }
  private set(state: PhoneState) {
    this.current = state;
    this.publish({ ...state });
  }
  private forget() {
    this.transport = null;
    this.credentials = null;
  }

  async refresh() {
    const generation = this.generation;
    try {
      const next = status(await this.bridge.call('llm_status'));
      if (generation !== this.generation) return;
      const sameSession =
        next.running &&
        this.credentials &&
        next.baseUrl === this.credentials.endpoint.replace(/\/chat\/completions$/, '') &&
        next.model === this.credentials.model;
      if (!sameSession) this.forget();
      this.set({
        phase: next.phase as PhonePhase,
        ready: !!sameSession,
        error: next.phase === 'error' ? 'status' : null,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.forget();
      this.set({
        phase: 'error',
        ready: false,
        error:
          error instanceof Error && error.message === 'PHONE_ORIGIN_DENIED'
            ? 'permission'
            : 'status',
      });
      throw new Error('PHONE_STATUS_FAILED');
    }
  }

  async start() {
    if (this.startup || this.stopping || this.inference.size)
      throw new Error('PHONE_OPERATION_PENDING');
    const generation = ++this.generation;
    const controller = new AbortController();
    this.startup = controller;
    this.forget();
    this.set({ phase: 'starting', ready: false, error: null });
    let poll: ReturnType<typeof setTimeout> | undefined;
    const pollStatus = async () => {
      if (controller.signal.aborted || generation !== this.generation) return;
      try {
        await this.refresh();
      } catch {
        /* Start has its own timeout and definitive reply. */
      }
      if (!controller.signal.aborted && generation === this.generation)
        poll = setTimeout(pollStatus, this.pollMs);
    };
    poll = setTimeout(pollStatus, this.pollMs);
    try {
      const next = status(
        await this.bridge.call('llm_start', {
          signal: controller.signal,
          timeoutMs: 20 * 60 * 1000,
        }),
      );
      controller.signal.throwIfAborted();
      if (generation !== this.generation) throw new DOMException('Aborted', 'AbortError');
      if (
        !next.running ||
        typeof next.baseUrl !== 'string' ||
        typeof next.model !== 'string' ||
        !next.model.trim() ||
        next.model.length > 128 ||
        typeof next.apiKey !== 'string' ||
        !/^[a-f0-9]{64}$/.test(next.apiKey)
      )
        throw new Error('PHONE_INVALID_START');
      const base = new URL(next.baseUrl);
      if (base.pathname !== '/v1' || base.search || base.hash || base.username || base.password)
        throw new Error('PHONE_INVALID_ENDPOINT');
      const endpoint = validateEndpoint(`${next.baseUrl}/chat/completions`);
      this.credentials = { endpoint, model: next.model, key: next.apiKey };
      this.transport = new LocalModel(endpoint, next.model, this.requestTimeoutMs, 'json-schema', {
        getApiKey: () => this.credentials?.key,
        ollamaHints: false,
      });
      ++this.generation; // Invalidate any in-flight status poll from startup.
      this.set({ phase: 'running', ready: true, error: null });
    } catch (error) {
      if (generation === this.generation) {
        this.forget();
        this.set({
          phase: 'error',
          ready: false,
          error:
            error instanceof Error && error.message === 'PHONE_ORIGIN_DENIED'
              ? 'permission'
              : error instanceof Error && error.message === 'PHONE_BRIDGE_UNAVAILABLE'
                ? 'unavailable'
                : 'start',
        });
        // A timed-out reply must not leave an unowned download/server running.
        await this.bridge.call('llm_stop', { timeoutMs: 15000 }).catch(() => {});
      }
      throw new Error(controller.signal.aborted ? 'PHONE_START_CANCELLED' : 'PHONE_START_FAILED');
    } finally {
      controller.abort();
      if (poll) clearTimeout(poll);
      if (this.startup === controller) this.startup = null;
    }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    ++this.generation;
    this.startup?.abort();
    this.forget();
    for (const controller of this.inference) controller.abort();
    this.set({ phase: 'stopping', ready: false, error: null });
    this.stopping = this.bridge
      .call('llm_stop', { timeoutMs: 15000 })
      .then((value) => {
        const next = status(value);
        if (next.phase !== 'idle' || next.running) throw new Error('PHONE_NOT_STOPPED');
        this.set(idle());
      })
      .catch(() => {
        this.set({ phase: 'error', ready: false, error: 'stop' });
        throw new Error('PHONE_STOP_FAILED');
      })
      .finally(() => {
        this.stopping = null;
      });
    return this.stopping;
  }

  async complete(input: Parameters<ModelAdapter['complete']>[0]) {
    input.signal.throwIfAborted();
    if (!this.transport || !this.current.ready) throw new Error('PHONE_NOT_READY');
    const controller = new AbortController();
    const generation = this.generation;
    const cancel = () => {
      controller.abort();
      if (input.stopOnAbort !== false) void this.stop().catch(() => {});
    };
    input.signal.addEventListener('abort', cancel, { once: true });
    this.inference.add(controller);
    try {
      const result = await this.transport.complete({ ...input, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (generation !== this.generation) throw new Error('PHONE_SESSION_CHANGED');
      return result;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'MODEL_HTTP_401' &&
        generation === this.generation
      ) {
        this.forget();
        this.set({ phase: 'error', ready: false, error: 'auth' });
      }
      throw error;
    } finally {
      this.inference.delete(controller);
      input.signal.removeEventListener('abort', cancel);
    }
  }
  async *streamText(input: {
    system: string;
    instruction: string;
    signal: AbortSignal;
  }): AsyncGenerator<string> {
    input.signal.throwIfAborted();
    if (!this.transport || !this.current.ready) throw new Error('PHONE_NOT_READY');
    const controller = new AbortController();
    const generation = this.generation;
    const cancel = () => controller.abort();
    input.signal.addEventListener('abort', cancel, { once: true });
    this.inference.add(controller);
    try {
      for await (const text of this.transport.streamText({ ...input, signal: controller.signal })) {
        controller.signal.throwIfAborted();
        if (generation !== this.generation) throw new Error('PHONE_SESSION_CHANGED');
        yield text;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'MODEL_HTTP_401' &&
        generation === this.generation
      ) {
        this.forget();
        this.set({ phase: 'error', ready: false, error: 'auth' });
      }
      throw error;
    } finally {
      controller.abort();
      this.inference.delete(controller);
      input.signal.removeEventListener('abort', cancel);
    }
  }
  async vision(input: VisionRequest): Promise<string> {
    input.signal.throwIfAborted();
    if (!this.transport?.vision || !this.current.ready) throw new Error('PHONE_NOT_READY');
    const controller = new AbortController();
    const generation = this.generation;
    const cancel = () => {
      controller.abort();
      void this.stop().catch(() => {});
    };
    input.signal.addEventListener('abort', cancel, { once: true });
    this.inference.add(controller);
    try {
      const result = await this.transport.vision({ ...input, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (generation !== this.generation) throw new Error('PHONE_SESSION_CHANGED');
      return result;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'MODEL_HTTP_401' &&
        generation === this.generation
      ) {
        this.forget();
        this.set({ phase: 'error', ready: false, error: 'auth' });
      }
      throw error;
    } finally {
      this.inference.delete(controller);
      input.signal.removeEventListener('abort', cancel);
    }
  }
  dispose() {
    ++this.generation;
    this.startup?.abort();
    for (const controller of this.inference) controller.abort();
    this.forget();
    this.bridge.dispose();
  }
}

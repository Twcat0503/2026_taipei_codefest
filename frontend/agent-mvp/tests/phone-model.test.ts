import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhoneModel } from '../src/agent/phone-model';
import { NativeLlmBridge, type FlutterBridge, type LlmBridge } from '../src/platform/llm-bridge';
import { routingTool } from '../src/agent/tools';

const key = 'a'.repeat(64); // Fictional fixture, never a service credential.
const running = {
  phase: 'running',
  running: true,
  baseUrl: 'http://127.0.0.1:5555/v1',
  model: 'fixture-model',
  apiKey: key,
};
const stopped = { phase: 'idle', running: false };
const completion = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"name":"select_agent","arguments":{"domain":"bills"}}' } }],
    }),
  );
const input = (signal = new AbortController().signal) => ({
  messages: [{ role: 'user' as const, content: '查帳單' }],
  tools: [routingTool],
  signal,
});
const bridge = (): LlmBridge => ({
  call: vi.fn(async (name) => (name === 'llm_stop' ? stopped : running)),
  dispose: vi.fn(),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('native LLM bridge correlation', () => {
  function setup() {
    const listeners = new Set<(event: { data: string }) => void>();
    const native: FlutterBridge = {
      postMessage: vi.fn(),
      addEventListener: (_name, fn) => {
        listeners.add(fn);
      },
      removeEventListener: (_name, fn) => {
        listeners.delete(fn);
      },
    };
    vi.stubGlobal('window', { flutterObject: native });
    const reply = (name: string, data: unknown) => {
      for (const fn of listeners) fn({ data: JSON.stringify({ name, data }) });
    };
    return { native, reply, listeners };
  }
  it('correlates request ID and method, discarding unrelated replies', async () => {
    const { native, reply, listeners } = setup();
    const rpc = new NativeLlmBridge();
    const pending = rpc.call('llm_start');
    const sent = JSON.parse(vi.mocked(native.postMessage).mock.calls[0]![0]);
    reply('llm_stop', { ...running, requestId: sent.data.requestId });
    reply('llm_start', { ...running, requestId: 'old-request' });
    reply('llm_start', { ...running, requestId: sent.data.requestId });
    expect(await pending).toMatchObject({ phase: 'running' });
    rpc.dispose();
    expect(listeners.size).toBe(0);
  });
  it('rejects cancellation, timeout, missing bridge and synchronous bridge errors', async () => {
    const { native } = setup();
    const rpc = new NativeLlmBridge();
    const controller = new AbortController();
    const pending = rpc.call('llm_start', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    await expect(rpc.call('llm_status', { timeoutMs: 5 })).rejects.toThrow('PHONE_BRIDGE_TIMEOUT');
    vi.mocked(native.postMessage).mockImplementation(() => {
      throw new Error('sensitive native detail');
    });
    await expect(rpc.call('llm_status')).rejects.toThrow('PHONE_BRIDGE_FAILED');
    rpc.dispose();
    vi.stubGlobal('window', {});
    await expect(rpc.call('llm_start')).rejects.toThrow('PHONE_BRIDGE_UNAVAILABLE');
  });
  it('supports onmessage without replacing a previous handler permanently', async () => {
    const previous = vi.fn();
    const native: FlutterBridge = { onmessage: previous, postMessage: vi.fn() };
    vi.stubGlobal('window', { flutterObject: native });
    const rpc = new NativeLlmBridge();
    const pending = rpc.call('llm_status');
    const sent = JSON.parse(vi.mocked(native.postMessage).mock.calls[0]![0]);
    native.onmessage!({
      data: JSON.stringify({
        name: 'llm_status',
        data: { ...stopped, requestId: sent.data.requestId },
      }),
    });
    await expect(pending).resolves.toMatchObject(stopped);
    expect(previous).toHaveBeenCalled();
    rpc.dispose();
    expect(native.onmessage).toBe(previous);
  });
});

describe('phone model lifecycle', () => {
  it('uses dynamic endpoint, model and bearer auth without Ollama-specific hints or stored credentials', async () => {
    const publish = vi.fn();
    const fetcher = vi.fn(async () => completion());
    const store = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('localStorage', { setItem: store });
    const phone = new PhoneModel(publish, bridge());
    await phone.start();
    expect(phone.state.ready).toBe(true);
    expect((await phone.complete(input())).calls[0]?.arguments.domain).toBe('bills');
    const [url, options] = vi.mocked(fetcher).mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:5555/v1/chat/completions');
    expect(options.headers).toMatchObject({ Authorization: `Bearer ${key}` });
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('fixture-model');
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(body)).not.toContain(key);
    expect(JSON.stringify(publish.mock.calls)).not.toContain(key);
    expect(store).not.toHaveBeenCalled();
    await phone.stop();
    expect(phone.state).toEqual({ phase: 'idle', ready: false, error: null });
    await expect(phone.complete(input())).rejects.toThrow('PHONE_NOT_READY');
  });
  it.each([
    'https://remote.example/v1',
    'http://localhost.evil.test/v1',
    'http://user:pass@localhost/v1',
    'http://localhost/v1?token=x',
  ])('rejects unsafe startup endpoint %s', async (baseUrl) => {
    const rpc = bridge();
    vi.mocked(rpc.call).mockResolvedValueOnce({ ...running, baseUrl });
    const phone = new PhoneModel(() => {}, rpc);
    await expect(phone.start()).rejects.toThrow('PHONE_START_FAILED');
    expect(phone.state.ready).toBe(false);
  });
  it('rejects denied origins and does not expose native error details', async () => {
    const rpc = bridge();
    vi.mocked(rpc.call).mockResolvedValueOnce({
      phase: 'error',
      running: false,
      error: 'origin_not_allowed',
    });
    const phone = new PhoneModel(() => {}, rpc);
    await expect(phone.start()).rejects.toThrow('PHONE_START_FAILED');
    expect(phone.state.error).toBe('permission');
  });
  it('invalidates authorization on 401 and requires a new start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const phone = new PhoneModel(() => {}, bridge());
    await phone.start();
    await expect(phone.complete(input())).rejects.toThrow('MODEL_HTTP_401');
    expect(phone.state.error).toBe('auth');
    await expect(phone.complete(input())).rejects.toThrow('PHONE_NOT_READY');
  });
  it('cancels startup and ignores a late reply containing credentials', async () => {
    let resolve!: (value: unknown) => void;
    const rpc = bridge();
    vi.mocked(rpc.call).mockImplementation(async (name) =>
      name === 'llm_start'
        ? new Promise((r) => {
            resolve = r;
          })
        : stopped,
    );
    const phone = new PhoneModel(() => {}, rpc);
    const start = phone.start();
    await phone.stop();
    resolve(running);
    await expect(start).rejects.toThrow('PHONE_START_CANCELLED');
    expect(phone.state.ready).toBe(false);
    expect(phone.state.phase).toBe('idle');
  });
  it('aborts inference and asks native code to stop on cancellation', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      'fetch',
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
          started();
        }),
    );
    const rpc = bridge();
    const phone = new PhoneModel(() => {}, rpc);
    await phone.start();
    const controller = new AbortController();
    const pending = phone.complete(input(controller.signal));
    await ready;
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    await phone.stop();
    expect(rpc.call).toHaveBeenCalledWith('llm_stop', expect.anything());
    expect(phone.state.ready).toBe(false);
  });
  it('does not claim idle when stop is not acknowledged', async () => {
    const rpc = bridge();
    const phone = new PhoneModel(() => {}, rpc);
    await phone.start();
    vi.mocked(rpc.call).mockRejectedValueOnce(new Error('native timeout'));
    await expect(phone.stop()).rejects.toThrow('PHONE_STOP_FAILED');
    expect(phone.state).toMatchObject({ phase: 'error', error: 'stop', ready: false });
  });
  it('requires new credentials when status reports a restarted server', async () => {
    const rpc = bridge();
    const phone = new PhoneModel(() => {}, rpc);
    await phone.start();
    vi.mocked(rpc.call).mockResolvedValueOnce({
      ...running,
      baseUrl: 'http://127.0.0.1:7777/v1',
      apiKey: undefined,
    });
    await phone.refresh();
    expect(phone.state.ready).toBe(false);
    await expect(phone.complete(input())).rejects.toThrow('PHONE_NOT_READY');
  });
});

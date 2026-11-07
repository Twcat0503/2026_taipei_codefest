import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlutterBridge } from '../src/platform/llm-bridge';

type NativeEvent = { data: string };
type Sent = { name: string; data: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const module of ['announcer', 'haptics', 'speech']) vi.doUnmock(`../src/platform/${module}`);
  vi.resetModules();
});

/** The platform modules keep singleton state, so every test imports its own fresh copy. */
async function fresh<T>(load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  return load();
}

/** A fake `window.flutterObject` with the event API; `emit` plays a native reply. */
function fakeBridge() {
  const listeners = new Set<(event: NativeEvent) => void>();
  const bridge: FlutterBridge = {
    postMessage: vi.fn(),
    addEventListener: (_name, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_name, listener) => {
      listeners.delete(listener);
    },
  };
  const sent = (): Sent[] =>
    vi.mocked(bridge.postMessage).mock.calls.map(([raw]) => JSON.parse(raw));
  const emitRaw = (raw: unknown) => {
    for (const listener of [...listeners]) listener({ data: raw as string });
  };
  const emit = (name: string, data: unknown) => emitRaw(JSON.stringify({ name, data }));
  return { bridge, listeners, sent, emit, emitRaw };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
}

function fakeElement() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    style: { cssText: '' },
    textContent: '',
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
    },
  };
}
type FakeElement = ReturnType<typeof fakeElement>;

function fakeDocument() {
  const appended: FakeElement[] = [];
  const listeners = new Map<string, Array<() => void>>();
  const doc = {
    body: {
      appendChild: (element: FakeElement) => {
        appended.push(element);
      },
    },
    documentElement: Object.assign(fakeElement(), { lang: 'zh-Hant-TW' }),
    visibilityState: 'visible',
    createElement: vi.fn(() => fakeElement()),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }),
  };
  const fire = (type: string) => listeners.get(type)?.forEach((listener) => listener());
  return { doc: doc as unknown as Document, raw: doc, appended, fire };
}

describe('native bridge', () => {
  async function setup() {
    const harness = fakeBridge();
    vi.stubGlobal('window', { flutterObject: harness.bridge });
    const native = await fresh(() => import('../src/platform/native-bridge'));
    return { ...harness, ...native };
  }

  it('correlates replies by name and request ID, resolving with the first match', async () => {
    const { requestNative, sent, emit, listeners } = await setup();
    const pending = requestNative('a11y_state', { extra: 1, requestId: 'forged' });
    const [request] = sent();
    expect(request).toMatchObject({ name: 'a11y_state', data: { extra: 1 } });
    const requestId = request!.data.requestId as string;
    expect(requestId).toMatch(UUID);
    emit('haptic', { requestId, ok: true });
    emit('a11y_state', { requestId: 'someone-else', boldText: true });
    emit('a11y_state', { boldText: true });
    emit('a11y_state', { requestId, boldText: false });
    emit('a11y_state', { requestId, boldText: true });
    await expect(pending).resolves.toEqual({ requestId, boldText: false });
    void requestNative('a11y_state');
    expect(listeners.size).toBe(1);
  });

  it('keeps concurrent requests apart', async () => {
    const { requestNative, sent, emit } = await setup();
    const first = requestNative('a11y_state');
    const second = requestNative('a11y_state');
    const [one, two] = sent().map((message) => message.data.requestId);
    expect(one).not.toBe(two);
    emit('a11y_state', { requestId: two, which: 'second' });
    emit('a11y_state', { requestId: one, which: 'first' });
    await expect(first).resolves.toMatchObject({ which: 'first' });
    await expect(second).resolves.toMatchObject({ which: 'second' });
  });

  it('times out after 3 s by default and after timeoutMs when given', async () => {
    vi.useFakeTimers();
    const { requestNative } = await setup();
    let outcome = 'pending';
    const first = requestNative('a11y_state').catch((error: Error) => {
      outcome = error.message;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(outcome).toBe('NATIVE_BRIDGE_TIMEOUT');
    const second = expect(requestNative('a11y_state', {}, { timeoutMs: 100 })).rejects.toThrow(
      'NATIVE_BRIDGE_TIMEOUT',
    );
    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects when the bridge is missing or postMessage throws', async () => {
    const { requestNative, postNative, hasNativeBridge, bridge } = await setup();
    expect(hasNativeBridge()).toBe(true);
    vi.mocked(bridge.postMessage).mockImplementation(() => {
      throw new Error('sensitive native detail');
    });
    expect(postNative('haptic', { type: 'light' })).toBe(false);
    await expect(requestNative('a11y_state')).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
    vi.stubGlobal('window', {});
    expect(hasNativeBridge()).toBe(false);
    expect(postNative('haptic', { type: 'light' })).toBe(false);
    await expect(requestNative('a11y_state')).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
    vi.unstubAllGlobals();
    expect(hasNativeBridge()).toBe(false);
    await expect(requestNative('a11y_state')).rejects.toThrow('NATIVE_BRIDGE_UNAVAILABLE');
  });

  it('rejects with an AbortError on cancellation and ignores later replies', async () => {
    const { requestNative, sent, emit } = await setup();
    const controller = new AbortController();
    const pending = requestNative('a11y_state', {}, { signal: controller.signal });
    const requestId = sent()[0]!.data.requestId;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    emit('a11y_state', { requestId });
    const aborted = AbortSignal.abort();
    await expect(requestNative('a11y_state', {}, { signal: aborted })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(sent()).toHaveLength(1);
  });

  it('delivers every reply of a request until unsubscribed', async () => {
    const { listenNative, emit } = await setup();
    const first = vi.fn();
    const faulty = vi.fn(() => {
      throw new Error('handler failure');
    });
    const last = vi.fn();
    const off = listenNative('tts', 'r1', first);
    listenNative('tts', 'r1', faulty);
    listenNative('tts', 'r1', last);
    emit('tts', { requestId: 'r1', event: 'start' });
    emit('tts', { requestId: 'r2', event: 'start' });
    emit('haptic', { requestId: 'r1', ok: true });
    emit('tts', { requestId: 'r1', event: 'done' });
    expect(first.mock.calls).toEqual([
      [{ requestId: 'r1', event: 'start' }],
      [{ requestId: 'r1', event: 'done' }],
    ]);
    expect(last).toHaveBeenCalledTimes(2);
    off();
    off();
    emit('tts', { requestId: 'r1', event: 'error' });
    expect(first).toHaveBeenCalledTimes(2);
    expect(last).toHaveBeenCalledTimes(3);
  });

  it('allows a handler to unsubscribe itself while a reply is dispatched', async () => {
    const { listenNative, emit } = await setup();
    const other = vi.fn();
    const once = vi.fn(() => off());
    const off = listenNative('tts', 'r1', once);
    listenNative('tts', 'r1', other);
    emit('tts', { requestId: 'r1', event: 'start' });
    emit('tts', { requestId: 'r1', event: 'done' });
    expect(once).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it('ignores malformed, unrelated and oversized messages', async () => {
    const { listenNative, emit, emitRaw } = await setup();
    const handler = vi.fn();
    const maxId = 'r'.repeat(64);
    const tooLongId = 'r'.repeat(65);
    const atLimit = vi.fn();
    const overLimit = vi.fn();
    listenNative('tts', 'r1', handler);
    listenNative('tts', maxId, atLimit);
    listenNative('tts', tooLongId, overLimit);
    const text = (value: unknown) => JSON.stringify(value);
    for (const raw of [
      'not json',
      '',
      'null',
      '[]',
      '"tts"',
      text({ name: 'tts' }),
      text({ name: 'tts', data: 'r1' }),
      text({ name: 'tts', data: ['r1'] }),
      text({ name: 'tts', data: { event: 'start' } }),
      text({ name: 'tts', data: { requestId: 1 } }),
      text({ name: 7, data: { requestId: 'r1' } }),
      text({ data: { requestId: 'r1' } }),
      text({ name: 'tts', data: { requestId: 'r1', padding: 'x'.repeat(10000) } }),
      { name: 'tts', data: { requestId: 'r1' } },
      undefined,
      null,
    ])
      emitRaw(raw);
    emit('tts', { requestId: tooLongId });
    expect(handler).not.toHaveBeenCalled();
    expect(overLimit).not.toHaveBeenCalled();
    emit('tts', { requestId: maxId });
    emit('tts', { requestId: 'r1' });
    expect(atLimit).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('chains a previous onmessage handler once, and restores it when the bridge is replaced', async () => {
    const previous = vi.fn();
    const old: FlutterBridge = { postMessage: vi.fn(), onmessage: previous };
    const win = { flutterObject: old };
    vi.stubGlobal('window', win);
    const { listenNative, requestNative } = await fresh(
      () => import('../src/platform/native-bridge'),
    );
    const handler = vi.fn();
    listenNative('tts', 'r1', handler);
    const chained = old.onmessage;
    expect(chained).not.toBe(previous);
    const event = { data: JSON.stringify({ name: 'tts', data: { requestId: 'r1' } }) };
    chained!(event);
    expect(previous).toHaveBeenCalledWith(event);
    expect(handler).toHaveBeenCalledTimes(1);
    listenNative('tts', 'r2', vi.fn());
    expect(old.onmessage).toBe(chained);
    previous.mockImplementationOnce(() => {
      throw new Error('previous handler failure');
    });
    expect(() => chained!(event)).toThrow('previous handler failure');
    expect(handler).toHaveBeenCalledTimes(2);

    const next: FlutterBridge = {
      postMessage: vi.fn((raw: string) => {
        const { name, data } = JSON.parse(raw);
        queueMicrotask(() =>
          next.onmessage?.({ data: JSON.stringify({ name, data: { requestId: data.requestId } }) }),
        );
      }),
    };
    win.flutterObject = next;
    await expect(requestNative('a11y_state')).resolves.toHaveProperty('requestId');
    expect(old.onmessage).toBe(previous);
  });

  it('re-attaches the listener when window.flutterObject is replaced', async () => {
    const one = fakeBridge();
    const two = fakeBridge();
    const win = { flutterObject: one.bridge };
    vi.stubGlobal('window', win);
    const { listenNative, requestNative } = await fresh(
      () => import('../src/platform/native-bridge'),
    );
    listenNative('tts', 'r1', vi.fn());
    expect(one.listeners.size).toBe(1);
    win.flutterObject = two.bridge;
    const handler = vi.fn();
    listenNative('tts', 'r1', handler);
    expect(one.listeners.size).toBe(0);
    expect(two.listeners.size).toBe(1);
    one.emit('tts', { requestId: 'r1' });
    expect(handler).not.toHaveBeenCalled();
    two.emit('tts', { requestId: 'r1' });
    expect(handler).toHaveBeenCalledTimes(1);
    const pending = requestNative('a11y_state');
    expect(one.sent()).toHaveLength(0);
    two.emit('a11y_state', { requestId: two.sent()[0]!.data.requestId, ok: true });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it('sends {name, data} as JSON through postNative', async () => {
    const { postNative, sent } = await setup();
    expect(postNative('haptic', { type: 'light' })).toBe(true);
    expect(sent()).toEqual([{ name: 'haptic', data: { type: 'light' } }]);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(postNative('haptic', circular)).toBe(false);
  });

  it('creates request IDs from crypto.randomUUID, or from getRandomValues without a secure context', async () => {
    const { newNativeRequestId } = await setup();
    expect(newNativeRequestId()).toMatch(UUID);
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-id' });
    expect(newNativeRequestId()).toBe('fixed-id');
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => real.getRandomValues(bytes),
    });
    const ids = new Set(Array.from({ length: 20 }, () => newNativeRequestId()));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(UUID);
    vi.stubGlobal('crypto', undefined);
    expect(newNativeRequestId()).toMatch(UUID);
  });
});

describe('native text-to-speech lifecycle', () => {
  async function setup() {
    vi.useFakeTimers();
    const harness = fakeBridge();
    vi.stubGlobal('window', { flutterObject: harness.bridge });
    const speech = await fresh(() => import('../src/platform/speech'));
    const speakMessages = () =>
      harness.sent().filter((message) => message.name === 'tts' && message.data.action === 'speak');
    const lastSpeakId = () => speakMessages().at(-1)!.data.requestId as string;
    const callbacks = () => ({ finished: vi.fn(), failed: vi.fn() });
    return { ...harness, speech, lastSpeakId, speakMessages, callbacks };
  }

  it('is available in the app and speaks through the bridge', async () => {
    const { speech, sent, callbacks } = await setup();
    expect(speech.canReadAloud()).toBe(true);
    const { finished, failed } = callbacks();
    speech.readAloud('你好', 'zh-Hant-TW', 0.9, finished, failed);
    speech.readAloud('hello', 'en', 1.25, finished, failed);
    const speaks = sent().filter((message) => message.data.action === 'speak');
    expect(speaks.map((message) => message.data)).toEqual([
      { requestId: expect.any(String), action: 'speak', text: '你好', lang: 'zh-TW', rate: 0.9 },
      { requestId: expect.any(String), action: 'speak', text: 'hello', lang: 'en-US', rate: 1.25 },
    ]);
    expect(speaks[0]!.data.requestId).not.toBe(speaks[1]!.data.requestId);
    speech.readAloud('x', 'en', Number.NaN, finished, failed);
    expect(sent().at(-1)!.data.rate).toBe(1);
  });

  it('stops the current reading before it starts a new one', async () => {
    const { speech, sent, callbacks } = await setup();
    const { finished, failed } = callbacks();
    speech.readAloud('first', 'en', 1, finished, failed);
    speech.readAloud('second', 'en', 1, finished, failed);
    // Nothing was being read before the first call, so only the second one needs a stop.
    expect(sent().map((message) => message.data.action)).toEqual(['speak', 'stop', 'speak']);
    for (const stop of sent().filter((message) => message.data.action === 'stop'))
      expect(stop.data).toEqual({ requestId: expect.any(String), action: 'stop' });
  });

  it('calls finished once for start then done, and ignores everything after', async () => {
    const { speech, emit, lastSpeakId, callbacks } = await setup();
    const { finished, failed } = callbacks();
    speech.readAloud('hello', 'en', 1, finished, failed);
    const requestId = lastSpeakId();
    emit('tts', { requestId, event: 'start' });
    expect(finished).not.toHaveBeenCalled();
    emit('tts', { requestId, event: 'done' });
    emit('tts', { requestId, event: 'done' });
    emit('tts', { requestId, event: 'stopped' });
    emit('tts', { requestId, event: 'error', error: 'late' });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(failed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats a stopped event of the current request as finished', async () => {
    const { speech, emit, lastSpeakId, callbacks } = await setup();
    const { finished, failed } = callbacks();
    speech.readAloud('hello', 'en', 1, finished, failed);
    const requestId = lastSpeakId();
    emit('tts', { requestId, event: 'start' });
    emit('tts', { requestId, event: 'stopped' });
    expect(finished).toHaveBeenCalledTimes(1);
    emit('tts', { requestId, event: 'done' });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('calls failed once for an error event', async () => {
    const { speech, emit, lastSpeakId, callbacks } = await setup();
    const { finished, failed } = callbacks();
    speech.readAloud('hello', 'en', 1, finished, failed);
    const requestId = lastSpeakId();
    emit('tts', { requestId, event: 'start' });
    emit('tts', { requestId, event: 'error', error: 'engine_failure' });
    emit('tts', { requestId, event: 'error', error: 'again' });
    emit('tts', { requestId, event: 'done' });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores events of a stale request after a new readAloud', async () => {
    const { speech, emit, lastSpeakId, callbacks } = await setup();
    const one = callbacks();
    const two = callbacks();
    speech.readAloud('first', 'en', 1, one.finished, one.failed);
    const staleId = lastSpeakId();
    speech.readAloud('second', 'en', 1, two.finished, two.failed);
    const currentId = lastSpeakId();
    expect(currentId).not.toBe(staleId);
    for (const event of ['start', 'stopped', 'error', 'done'])
      emit('tts', { requestId: staleId, event });
    expect(one.finished).not.toHaveBeenCalled();
    expect(one.failed).not.toHaveBeenCalled();
    expect(two.finished).not.toHaveBeenCalled();
    expect(two.failed).not.toHaveBeenCalled();
    emit('tts', { requestId: currentId, event: 'start' });
    emit('tts', { requestId: currentId, event: 'done' });
    expect(two.finished).toHaveBeenCalledTimes(1);
    expect(two.failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(one.failed).not.toHaveBeenCalled();
    expect(one.finished).not.toHaveBeenCalled();
  });

  it('fails and sends a stop when no start event arrives within 5 seconds', async () => {
    const { speech, sent, emit, lastSpeakId, callbacks } = await setup();
    const { finished, failed } = callbacks();
    speech.readAloud('hello', 'en', 1, finished, failed);
    const requestId = lastSpeakId();
    const before = sent().length;
    await vi.advanceTimersByTimeAsync(4999);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(sent().slice(before)).toEqual([
      { name: 'tts', data: { requestId: expect.any(String), action: 'stop' } },
    ]);
    emit('tts', { requestId, event: 'start' });
    emit('tts', { requestId, event: 'stopped' });
    emit('tts', { requestId, event: 'done' });
    emit('tts', { requestId, event: 'error' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
  });

  it('does not time out once the reading has started', async () => {
    const { speech, emit, lastSpeakId, callbacks } = await setup();
    const { finished, failed } = callbacks();
    speech.readAloud('a long text', 'en', 1, finished, failed);
    const requestId = lastSpeakId();
    await vi.advanceTimersByTimeAsync(4000);
    emit('tts', { requestId, event: 'start' });
    await vi.advanceTimersByTimeAsync(120000);
    expect(failed).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    emit('tts', { requestId, event: 'done' });
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('sends a stop and silences the request when stopReading is called', async () => {
    const { speech, sent, emit, lastSpeakId, callbacks } = await setup();
    const { finished, failed } = callbacks();
    speech.readAloud('hello', 'en', 1, finished, failed);
    const requestId = lastSpeakId();
    emit('tts', { requestId, event: 'start' });
    speech.stopReading();
    const stop = sent().at(-1)!;
    expect(stop).toEqual({ name: 'tts', data: { requestId: expect.any(String), action: 'stop' } });
    expect(stop.data.requestId).not.toBe(requestId);
    emit('tts', { requestId, event: 'stopped' });
    emit('tts', { requestId, event: 'done' });
    emit('tts', { requestId, event: 'error' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(finished).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it('posts nothing to the bridge when stopReading is called while idle', async () => {
    const { speech, sent } = await setup();
    speech.stopReading();
    expect(sent()).toEqual([]);
  });

  it('fails right away when the bridge cannot be reached', async () => {
    const { speech, bridge, callbacks } = await setup();
    vi.mocked(bridge.postMessage).mockImplementation(() => {
      throw new Error('disconnected');
    });
    const { finished, failed } = callbacks();
    speech.readAloud('hello', 'en', 1, finished, failed);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('browser text-to-speech', () => {
  class FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const localChinese = { localService: true, lang: 'zh-TW' };
  const remoteEnglish = { localService: false, lang: 'en-US' };

  function browserWith(extra: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const spoken: FakeUtterance[] = [];
    const synth = {
      cancel: vi.fn(() => {
        calls.push('cancel');
      }),
      speak: vi.fn((utterance: FakeUtterance) => {
        calls.push('speak');
        spoken.push(utterance);
      }),
      getVoices: vi.fn(() => [remoteEnglish, localChinese]),
    };
    vi.stubGlobal('window', {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: FakeUtterance,
      ...extra,
    });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    return { synth, calls, spoken };
  }

  it('keeps using speechSynthesis outside the app', async () => {
    const { synth, calls, spoken } = browserWith();
    const speech = await fresh(() => import('../src/platform/speech'));
    expect(speech.canReadAloud()).toBe(true);
    const finished = vi.fn();
    const failed = vi.fn();
    speech.readAloud('hello', 'en', 0.8, finished, failed);
    expect(calls).toEqual(['cancel', 'speak']);
    const english = spoken[0]!;
    expect(english).toMatchObject({ text: 'hello', lang: 'en-US', rate: 0.8, voice: null });
    english.onend!();
    expect(finished).toHaveBeenCalledTimes(1);
    speech.readAloud('你好', 'zh-Hant-TW', 1, finished, failed);
    const chinese = spoken[1]!;
    expect(chinese).toMatchObject({ lang: 'zh-TW', voice: localChinese });
    chinese.onerror!();
    expect(failed).toHaveBeenCalledTimes(1);
    synth.cancel.mockClear();
    speech.stopReading();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('reports failure without speechSynthesis', async () => {
    vi.stubGlobal('window', {});
    const speech = await fresh(() => import('../src/platform/speech'));
    expect(speech.canReadAloud()).toBe(false);
    const finished = vi.fn();
    const failed = vi.fn();
    speech.readAloud('hello', 'en', 1, finished, failed);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
    expect(() => speech.stopReading()).not.toThrow();
  });

  it('prefers the native bridge over speechSynthesis in the app', async () => {
    const { bridge } = fakeBridge();
    const { synth } = browserWith({ flutterObject: bridge });
    const speech = await fresh(() => import('../src/platform/speech'));
    speech.readAloud('hello', 'en', 1, vi.fn(), vi.fn());
    speech.stopReading();
    expect(synth.speak).not.toHaveBeenCalled();
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(bridge.postMessage).toHaveBeenCalled();
  });
});

describe('haptics', () => {
  const patterns = {
    selection: [10],
    light: [15],
    medium: [25],
    heavy: [40],
    success: [30, 60, 30],
    warning: [60, 80, 60],
    error: [80, 60, 80, 60, 80],
  } as const;
  const types = Object.keys(patterns) as Array<keyof typeof patterns>;

  async function load(storage = memoryStorage()) {
    vi.stubGlobal('localStorage', storage);
    return fresh(() => import('../src/platform/haptics'));
  }

  it.each(types)('posts %s to the app as a haptic message', async (type) => {
    const { bridge, sent } = fakeBridge();
    const vibrate = vi.fn();
    vi.stubGlobal('window', { flutterObject: bridge });
    vi.stubGlobal('navigator', { vibrate });
    const { haptic } = await load();
    haptic(type);
    expect(sent()).toEqual([{ name: 'haptic', data: { type } }]);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it.each(types)('vibrates %s with its pattern in a browser', async (type) => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { vibrate });
    const { haptic } = await load();
    haptic(type);
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(patterns[type]);
  });

  it('does nothing when the preference is off', async () => {
    const { bridge, sent } = fakeBridge();
    const vibrate = vi.fn();
    vi.stubGlobal('window', { flutterObject: bridge });
    vi.stubGlobal('navigator', { vibrate });
    const { haptic, hapticsEnabled } = await load(memoryStorage({ 'tp-haptics': 'off' }));
    expect(hapticsEnabled()).toBe(false);
    haptic('success');
    vi.stubGlobal('window', {});
    haptic('success');
    expect(sent()).toEqual([]);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('is on by default and remembers the preference', async () => {
    const storage = memoryStorage();
    const { hapticsEnabled, setHapticsEnabled } = await load(storage);
    expect(hapticsEnabled()).toBe(true);
    setHapticsEnabled(false);
    expect(storage.setItem).toHaveBeenLastCalledWith('tp-haptics', 'off');
    expect(hapticsEnabled()).toBe(false);
    setHapticsEnabled(true);
    expect(storage.setItem).toHaveBeenLastCalledWith('tp-haptics', 'on');
    expect(hapticsEnabled()).toBe(true);
  });

  it('falls back to the default when storage is blocked', async () => {
    const blocked = () => {
      throw new Error('storage denied');
    };
    const { hapticsEnabled, setHapticsEnabled } = await load({
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
    } as unknown as ReturnType<typeof memoryStorage>);
    expect(hapticsEnabled()).toBe(true);
    expect(() => setHapticsEnabled(false)).not.toThrow();
  });

  it('never throws', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    const { haptic } = await load();
    expect(() => haptic('error')).not.toThrow();
    vi.stubGlobal('navigator', {});
    expect(() => haptic('error')).not.toThrow();
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('window', undefined);
    expect(() => haptic('error')).not.toThrow();
    const { bridge } = fakeBridge();
    vi.mocked(bridge.postMessage).mockImplementation(() => {
      throw new Error('disconnected');
    });
    vi.stubGlobal('window', { flutterObject: bridge });
    expect(() => haptic('error')).not.toThrow();
    expect(() => haptic('unknown' as never)).not.toThrow();
    expect(bridge.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe('accessibility state', () => {
  /** A bridge that answers every a11y_state request, like the Flutter side does. */
  function answeringBridge(
    reply: Record<string, unknown> | ((call: number) => Record<string, unknown>),
  ) {
    const harness = fakeBridge();
    let calls = 0;
    vi.mocked(harness.bridge.postMessage).mockImplementation((raw) => {
      const request = JSON.parse(raw);
      if (request.name !== 'a11y_state') return;
      const payload = typeof reply === 'function' ? reply(calls) : reply;
      calls += 1;
      queueMicrotask(() =>
        harness.emit('a11y_state', { requestId: request.data.requestId, ...payload }),
      );
    });
    return harness;
  }
  const load = () => fresh(() => import('../src/platform/a11y'));
  const defaults = {
    screenReader: null,
    boldText: false,
    highContrast: false,
    reduceMotion: false,
    invertColors: false,
    textScale: 1,
  };

  it('maps the native reply and mirrors it onto the root element', async () => {
    const { bridge, sent } = answeringBridge({
      screenReader: true,
      boldText: true,
      highContrast: true,
      reduceMotion: true,
      invertColors: true,
      textScale: 1.3,
      ignoredExtra: 'x',
    });
    vi.stubGlobal('window', { flutterObject: bridge });
    const { loadA11yState, applyA11yState, a11yState } = await load();
    const state = await loadA11yState();
    expect(state).toEqual({
      screenReader: true,
      boldText: true,
      highContrast: true,
      reduceMotion: true,
      invertColors: true,
      textScale: 1.3,
    });
    expect({ ...a11yState }).toEqual(state);
    expect(sent()).toEqual([{ name: 'a11y_state', data: { requestId: expect.any(String) } }]);
    const root = fakeElement();
    applyA11yState(state, root);
    expect(Object.fromEntries(root.attributes)).toEqual({
      'data-a11y-motion': 'reduce',
      'data-a11y-bold': 'true',
      'data-a11y-contrast': 'true',
    });
    applyA11yState({ ...state, boldText: false }, root);
    expect(root.attributes.has('data-a11y-bold')).toBe(false);
    expect(root.attributes.get('data-a11y-motion')).toBe('reduce');
    applyA11yState(defaults, root);
    expect(root.attributes.size).toBe(0);
  });

  it('ignores fields with an invalid type', async () => {
    const { bridge } = answeringBridge({
      screenReader: 'yes',
      boldText: 'true',
      highContrast: 1,
      reduceMotion: null,
      invertColors: {},
      textScale: 'big',
    });
    vi.stubGlobal('window', { flutterObject: bridge });
    const { loadA11yState } = await load();
    expect(await loadA11yState()).toEqual(defaults);
  });

  it('keeps the valid fields of a partly invalid reply', async () => {
    const { bridge } = answeringBridge((call) =>
      call === 0
        ? { screenReader: null, boldText: true, highContrast: 'yes', textScale: 0 }
        : { screenReader: false, invertColors: true, textScale: -2 },
    );
    vi.stubGlobal('window', { flutterObject: bridge });
    const { loadA11yState } = await load();
    expect(await loadA11yState()).toEqual({ ...defaults, boldText: true });
    expect(await loadA11yState()).toEqual({ ...defaults, screenReader: false, invertColors: true });
  });

  it('uses the browser media queries for fields the app did not provide', async () => {
    const { bridge } = answeringBridge({ reduceMotion: 'maybe', highContrast: false });
    vi.stubGlobal('window', {
      flutterObject: bridge,
      matchMedia: (query: string) => ({ matches: query !== '(prefers-contrast: more)' }),
    });
    const { loadA11yState } = await load();
    const state = await loadA11yState();
    expect(state.reduceMotion).toBe(true);
    expect(state.highContrast).toBe(false);
  });

  it('falls back to matchMedia in a browser, with the screen reader unknown', async () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    }));
    vi.stubGlobal('window', { matchMedia });
    const { loadA11yState } = await load();
    expect(await loadA11yState()).toEqual({ ...defaults, reduceMotion: true });
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(matchMedia).toHaveBeenCalledWith('(prefers-contrast: more)');
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(await loadA11yState()).toEqual({ ...defaults, reduceMotion: true, highContrast: true });
  });

  it('falls back to defaults without matchMedia, or when it throws', async () => {
    vi.stubGlobal('window', {});
    const { loadA11yState } = await load();
    expect(await loadA11yState()).toEqual(defaults);
    vi.stubGlobal('window', {
      matchMedia: () => {
        throw new Error('unsupported');
      },
    });
    expect(await loadA11yState()).toEqual(defaults);
    vi.unstubAllGlobals();
    expect(await loadA11yState()).toEqual(defaults);
  });

  it('falls back to matchMedia when the app does not answer within 1.5 seconds', async () => {
    vi.useFakeTimers();
    const { bridge, sent } = fakeBridge();
    vi.stubGlobal('window', {
      flutterObject: bridge,
      matchMedia: (query: string) => ({ matches: query === '(prefers-contrast: more)' }),
    });
    const { loadA11yState } = await load();
    let state: unknown;
    const pending = loadA11yState().then((value) => (state = value));
    await vi.advanceTimersByTimeAsync(1499);
    expect(state).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(state).toEqual({ ...defaults, highContrast: true });
    expect(sent()).toHaveLength(1);
  });

  it('falls back to matchMedia when the bridge throws', async () => {
    const { bridge } = fakeBridge();
    vi.mocked(bridge.postMessage).mockImplementation(() => {
      throw new Error('disconnected');
    });
    vi.stubGlobal('window', {
      flutterObject: bridge,
      matchMedia: () => ({ matches: true }),
    });
    const { loadA11yState } = await load();
    expect(await loadA11yState()).toEqual({ ...defaults, reduceMotion: true, highContrast: true });
  });

  it('does not let an older load overwrite a newer one', async () => {
    const { bridge, sent, emit } = fakeBridge();
    vi.stubGlobal('window', { flutterObject: bridge });
    const { loadA11yState, a11yState } = await load();
    const older = loadA11yState();
    const newer = loadA11yState();
    const [olderId, newerId] = sent().map((message) => message.data.requestId);
    emit('a11y_state', { requestId: newerId, highContrast: true });
    expect((await newer).highContrast).toBe(true);
    emit('a11y_state', { requestId: olderId, highContrast: false });
    expect((await older).highContrast).toBe(true);
    expect(a11yState.highContrast).toBe(true);
  });

  it('keeps the screen reader setting in memory: no storage, logging or network', async () => {
    const local = memoryStorage();
    const session = memoryStorage();
    const fetcher = vi.fn();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('fetch', fetcher);
    const consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const { bridge, sent } = answeringBridge({ screenReader: true, highContrast: true });
    const { doc } = fakeDocument();
    vi.stubGlobal('window', { flutterObject: bridge });
    vi.stubGlobal('document', doc);
    const { initAccessibility, loadA11yState, a11yState } = await load();
    await initAccessibility();
    await loadA11yState();
    expect(a11yState.screenReader).toBe(true);
    expect(local.setItem).not.toHaveBeenCalled();
    expect(session.setItem).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    for (const spy of consoleCalls) expect(spy).not.toHaveBeenCalled();
    expect(sent().length).toBeGreaterThan(0);
    expect(JSON.stringify(sent())).not.toContain('screenReader');
  });
});

describe('initAccessibility', () => {
  it('mounts the announcer, applies the state and reloads when the page becomes visible', async () => {
    let call = 0;
    const harness = fakeBridge();
    vi.mocked(harness.bridge.postMessage).mockImplementation((raw) => {
      const { data } = JSON.parse(raw);
      const highContrast = call === 0;
      call += 1;
      queueMicrotask(() => harness.emit('a11y_state', { requestId: data.requestId, highContrast }));
    });
    const { doc, raw, appended, fire } = fakeDocument();
    vi.stubGlobal('window', { flutterObject: harness.bridge });
    vi.stubGlobal('document', doc);
    const { initAccessibility } = await fresh(() => import('../src/platform/a11y'));
    await initAccessibility();
    expect(appended).toHaveLength(2);
    expect(raw.documentElement.attributes.get('data-a11y-contrast')).toBe('true');
    raw.visibilityState = 'hidden';
    fire('visibilitychange');
    expect(harness.sent()).toHaveLength(1);
    raw.visibilityState = 'visible';
    fire('visibilitychange');
    await vi.waitFor(() =>
      expect(raw.documentElement.attributes.has('data-a11y-contrast')).toBe(false),
    );
    expect(harness.sent()).toHaveLength(2);
    await initAccessibility();
    expect(raw.addEventListener).toHaveBeenCalledTimes(1);
    expect(appended).toHaveLength(2);
  });

  it('never blocks or breaks app start, even without window or document', async () => {
    const { initAccessibility } = await fresh(() => import('../src/platform/a11y'));
    await expect(initAccessibility()).resolves.toBeUndefined();
  });

  it('survives a broken document and bridge', async () => {
    const { bridge } = fakeBridge();
    vi.mocked(bridge.postMessage).mockImplementation(() => {
      throw new Error('disconnected');
    });
    vi.stubGlobal('window', { flutterObject: bridge });
    vi.stubGlobal('document', {
      get body(): never {
        throw new Error('no body');
      },
      addEventListener: () => {
        throw new Error('no events');
      },
    });
    const { initAccessibility } = await fresh(() => import('../src/platform/a11y'));
    await expect(initAccessibility()).resolves.toBeUndefined();
  });
});

describe('announcer', () => {
  const load = () => fresh(() => import('../src/platform/announcer'));

  it('creates two visually hidden live regions, once', async () => {
    vi.useFakeTimers();
    const { mountAnnouncer } = await load();
    const { doc, appended } = fakeDocument();
    mountAnnouncer(doc);
    mountAnnouncer(doc);
    expect(appended).toHaveLength(2);
    const [polite, assertive] = appended;
    expect(Object.fromEntries(polite!.attributes)).toEqual({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-a11y-announcer': 'polite',
    });
    expect(Object.fromEntries(assertive!.attributes)).toEqual({
      role: 'alert',
      'aria-live': 'assertive',
      'aria-atomic': 'true',
      'data-a11y-announcer': 'assertive',
    });
    for (const region of appended)
      expect(region.style.cssText.split(';')).toEqual(
        expect.arrayContaining([
          'position:absolute',
          'width:1px',
          'height:1px',
          'margin:-1px',
          'overflow:hidden',
          'clip:rect(0 0 0 0)',
          'clip-path:inset(50%)',
          'white-space:nowrap',
          'border:0',
          'padding:0',
        ]),
      );
  });

  it('does not mount without a body', async () => {
    vi.useFakeTimers();
    const { mountAnnouncer, announce } = await load();
    const { doc, raw, appended } = fakeDocument();
    (raw as { body: unknown }).body = null;
    mountAnnouncer(doc);
    announce('Saved');
    expect(appended).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sets the text after about 50 ms, so repeated messages are announced again', async () => {
    vi.useFakeTimers();
    const { mountAnnouncer, announce } = await load();
    const { doc, appended } = fakeDocument();
    mountAnnouncer(doc);
    const polite = appended[0]!;
    announce('Saved');
    expect(polite.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(49);
    expect(polite.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(polite.textContent).toBe('Saved');
    announce('Saved');
    expect(polite.textContent).toBe('');
    await vi.advanceTimersByTimeAsync(50);
    expect(polite.textContent).toBe('Saved');
    announce('Next');
    await vi.advanceTimersByTimeAsync(50);
    expect(polite.textContent).toBe('Next');
  });

  it('announces only the latest of several messages sent within the delay', async () => {
    vi.useFakeTimers();
    const { mountAnnouncer, announce } = await load();
    const { doc, appended } = fakeDocument();
    mountAnnouncer(doc);
    announce('first');
    announce('second');
    await vi.advanceTimersByTimeAsync(50);
    expect(appended[0]!.textContent).toBe('second');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends assertive messages to the alert region only', async () => {
    vi.useFakeTimers();
    const { mountAnnouncer, announce } = await load();
    const { doc, appended } = fakeDocument();
    mountAnnouncer(doc);
    const [polite, assertive] = appended;
    announce('Payment failed', { assertive: true });
    announce('Loaded');
    await vi.advanceTimersByTimeAsync(50);
    expect(assertive!.textContent).toBe('Payment failed');
    expect(polite!.textContent).toBe('Loaded');
    announce('Retry', { assertive: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(assertive!.textContent).toBe('Retry');
    expect(polite!.textContent).toBe('Loaded');
  });

  it('ignores empty messages and messages before mounting', async () => {
    vi.useFakeTimers();
    const { mountAnnouncer, announce } = await load();
    expect(() => announce('too early')).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    const { doc, appended } = fakeDocument();
    mountAnnouncer(doc);
    announce('Saved');
    await vi.advanceTimersByTimeAsync(50);
    announce('');
    announce('   ');
    announce(undefined as unknown as string);
    expect(vi.getTimerCount()).toBe(0);
    expect(appended[0]!.textContent).toBe('Saved');
    await vi.advanceTimersByTimeAsync(50);
    expect(appended[0]!.textContent).toBe('Saved');
  });
});

describe('feedback', () => {
  async function setup(preferences: Record<string, string> = {}, lang = 'zh-Hant-TW') {
    const announce = vi.fn();
    const haptic = vi.fn();
    const readAloud = vi.fn();
    vi.resetModules();
    vi.doMock('../src/platform/announcer', () => ({ announce, mountAnnouncer: vi.fn() }));
    vi.doMock('../src/platform/haptics', () => ({ haptic }));
    vi.doMock('../src/platform/speech', () => ({ readAloud }));
    vi.stubGlobal('localStorage', memoryStorage(preferences));
    vi.stubGlobal('document', { documentElement: { lang } });
    const feedbackModule = await import('../src/platform/feedback');
    const { a11yState } = await import('../src/platform/a11y');
    return { announce, haptic, readAloud, a11yState, ...feedbackModule };
  }

  it('announces the message and plays the matching haptic', async () => {
    const { feedback, announce, haptic, readAloud } = await setup();
    feedback('success', 'Saved');
    expect(announce).toHaveBeenLastCalledWith('Saved', { assertive: false });
    expect(haptic).toHaveBeenLastCalledWith('success');
    feedback('warning', 'Almost full');
    expect(announce).toHaveBeenLastCalledWith('Almost full', { assertive: false });
    expect(haptic).toHaveBeenLastCalledWith('warning');
    feedback('error', 'Payment failed');
    expect(announce).toHaveBeenLastCalledWith('Payment failed', { assertive: true });
    expect(haptic).toHaveBeenLastCalledWith('error');
    feedback('selection', 'Selected water bill');
    expect(announce).toHaveBeenLastCalledWith('Selected water bill', { assertive: false });
    expect(haptic).toHaveBeenLastCalledWith('selection');
    feedback('info', 'Updated just now');
    expect(announce).toHaveBeenLastCalledWith('Updated just now', { assertive: false });
    expect(haptic).toHaveBeenCalledTimes(4);
    expect(announce).toHaveBeenCalledTimes(5);
    expect(readAloud).not.toHaveBeenCalled();
  });

  it('plays haptics without a message and announces nothing', async () => {
    const { feedback, announce, haptic, readAloud } = await setup({ 'tp-voice-feedback': 'on' });
    feedback('selection');
    feedback('success', '  ');
    expect(haptic).toHaveBeenCalledTimes(2);
    expect(announce).not.toHaveBeenCalled();
    expect(readAloud).not.toHaveBeenCalled();
  });

  it('speaks only when voice feedback is on and no screen reader is known to run', async () => {
    const { feedback, announce, haptic, readAloud, a11yState, setVoiceFeedbackEnabled } =
      await setup();
    feedback('success', 'Saved');
    expect(readAloud).not.toHaveBeenCalled();
    setVoiceFeedbackEnabled(true);
    feedback('success', 'Saved');
    expect(readAloud).toHaveBeenCalledExactlyOnceWith(
      'Saved',
      'zh-Hant-TW',
      1,
      expect.any(Function),
      expect.any(Function),
    );
    a11yState.screenReader = false;
    feedback('info', 'Updated');
    expect(readAloud).toHaveBeenCalledTimes(2);
    a11yState.screenReader = true;
    feedback('error', 'Failed');
    expect(readAloud).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith('Failed', { assertive: true });
    expect(haptic).toHaveBeenLastCalledWith('error');
  });

  it('stores the voice preference, off by default', async () => {
    const { voiceFeedbackEnabled, setVoiceFeedbackEnabled } = await setup();
    expect(voiceFeedbackEnabled()).toBe(false);
    setVoiceFeedbackEnabled(true);
    expect(voiceFeedbackEnabled()).toBe(true);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('tp-voice-feedback', 'on');
    setVoiceFeedbackEnabled(false);
    expect(voiceFeedbackEnabled()).toBe(false);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('tp-voice-feedback', 'off');
  });

  it('speaks English when the page language is English', async () => {
    const { feedback, readAloud } = await setup({ 'tp-voice-feedback': 'on' }, 'en');
    feedback('info', 'Hello');
    expect(readAloud.mock.calls[0]![1]).toBe('en');
  });

  it('never throws, and one failing channel does not stop the others', async () => {
    const { feedback, announce, haptic, readAloud } = await setup({ 'tp-voice-feedback': 'on' });
    announce.mockImplementation(() => {
      throw new Error('no live region');
    });
    haptic.mockImplementation(() => {
      throw new Error('no vibrator');
    });
    expect(() => feedback('error', 'Failed')).not.toThrow();
    expect(readAloud).toHaveBeenCalledTimes(1);
    readAloud.mockImplementation(() => {
      throw new Error('no voice');
    });
    expect(() => feedback('error', 'Failed')).not.toThrow();
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('localStorage', undefined);
    expect(() => feedback('error', 'Failed')).not.toThrow();
  });
});

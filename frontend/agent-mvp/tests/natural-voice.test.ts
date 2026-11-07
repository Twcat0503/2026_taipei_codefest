import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlutterBridge } from '../src/platform/llm-bridge';
import { segmentText } from '../src/platform/natural-voice';

type Sent = { name: string; data: Record<string, unknown> };
type BridgeListener = (event: { data: string }) => void;
type WindowListener = (event: { data?: unknown }) => void;
type SynthesisRequest = { url: string; init: RequestInit; input: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = 'c'.repeat(64); // Fictional fixture, never a service credential.
const BASE_URL = 'http://127.0.0.1:41234/v1';
const READY = {
  phase: 'running',
  running: true,
  baseUrl: BASE_URL,
  model: 'bluemagpie-q8_0',
  apiKey: KEY,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

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

/** A synthesis response; `blob()` is a plain async function so tests do not depend on stream timing. */
function wav({ status = 200, type = 'audio/wav', size = 4800 } = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: async () => new Blob([new Uint8Array(size)], { type }),
  } as unknown as Response;
}

/** A synthesis that never answers until it is aborted, like a model that is still working. */
function hang({ init }: SynthesisRequest) {
  return new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

const sentence = (mark: string, length: number) => mark.repeat(length - 1) + '。';
/** Three sentences of 50 characters: each one is a segment of its own. */
const threeSegments = [sentence('甲', 50), sentence('乙', 50), sentence('丙', 50)].join('');

/**
 * A fake app around fresh copies of the modules: the WebView bridge (`flutterObject` events carry the
 * system `tts` replies, `window` message events carry the BlueMagpie replies), the loopback server
 * (`fetch`), `<audio>`, object URLs and storage. Timers are fake; `flush` lets pending promises run.
 */
async function setup({
  enabled = false,
  start,
}: { enabled?: boolean; start?: object | 'silent' } = {}) {
  vi.useFakeTimers();
  const storage = memoryStorage(enabled ? { 'tp-natural-voice': 'on' } : {});
  vi.stubGlobal('localStorage', storage);

  const bridgeListeners = new Set<BridgeListener>();
  // Like the DOM: a listener is registered per type and capture flag, and removed with the same pair.
  const windowListeners = new Map<string, Set<WindowListener>>();
  const slot = (type: string, capture: unknown) =>
    `${type}|${capture === true ? 'capture' : 'bubble'}`;
  const listenersOf = (type: string) => [
    ...(windowListeners.get(slot(type, true)) ?? []),
    ...(windowListeners.get(slot(type, false)) ?? []),
  ];
  const native: { start: object | 'silent' } = { start: start ?? READY };
  const emitWindow = (name: string, data: unknown) => emitWindowRaw(JSON.stringify({ name, data }));
  const emitWindowRaw = (raw: unknown) => {
    for (const listener of listenersOf('message')) listener({ data: raw });
  };
  const bridge: FlutterBridge = {
    postMessage: vi.fn((raw: string) => {
      const message: Sent = JSON.parse(raw);
      // The app answers a start on a later tick, like a real native call.
      if (message.name === 'tts_start' && native.start !== 'silent') {
        const reply = { requestId: message.data.requestId, ...native.start };
        void Promise.resolve().then(() => emitWindow('tts_start', reply));
      }
    }),
    addEventListener: (_name, listener) => {
      bridgeListeners.add(listener);
    },
    removeEventListener: (_name, listener) => {
      bridgeListeners.delete(listener);
    },
  };
  const fakeWindow = {
    flutterObject: bridge,
    addEventListener: vi.fn((type: string, listener: WindowListener, capture?: boolean) => {
      const key = slot(type, capture);
      windowListeners.set(key, (windowListeners.get(key) ?? new Set()).add(listener));
    }),
    removeEventListener: vi.fn((type: string, listener: WindowListener, capture?: boolean) => {
      windowListeners.get(slot(type, capture))?.delete(listener);
    }),
  };
  vi.stubGlobal('window', fakeWindow);

  const server: { respond: (request: SynthesisRequest) => Response | Promise<Response> } = {
    respond: () => wav(),
  };
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const { input } = JSON.parse(String(init.body)) as { input: string };
    return server.respond({ url, init, input });
  });
  vi.stubGlobal('fetch', fetcher);

  const audio = {
    blocked: false,
    /** Every element the module created; it must never be more than one. */
    instances: [] as FakeAudio[],
    /** What each `play()` call started: the `src` of the element at that moment. */
    played: [] as string[],
    /** While set, `play()` stays pending, like a start the WebView has not answered yet. */
    hold: false,
    pending: undefined as { resolve: () => void; reject: (error: Error) => void } | undefined,
    get element() {
      return audio.instances[0]!;
    },
  };
  class FakeAudio {
    private source = '';
    playbackRate = 1;
    defaultPlaybackRate = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(() => {
      audio.played.push(this.src);
      if (audio.blocked) return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
      if (audio.hold)
        return new Promise<void>((resolve, reject) => {
          audio.pending = { resolve, reject };
        });
      return Promise.resolve();
    });
    pause = vi.fn();
    removeAttribute = vi.fn((name: string) => {
      if (name === 'src') this.src = '';
    });
    // The load algorithm puts the playback rate back to the default.
    load = vi.fn(() => {
      this.playbackRate = this.defaultPlaybackRate;
    });
    constructor() {
      audio.instances.push(this);
    }
    get src() {
      return this.source;
    }
    set src(value: string) {
      this.source = value;
      // Like the element: a new source runs the load algorithm, which interrupts a start that is
      // still pending and puts the playback rate back to the default.
      this.playbackRate = this.defaultPlaybackRate;
      audio.pending?.reject(new DOMException('Interrupted by a new load request', 'AbortError'));
      audio.pending = undefined;
    }
    end() {
      this.onended?.();
    }
    fail() {
      this.onerror?.();
    }
  }
  vi.stubGlobal('Audio', FakeAudio);
  const urls = { created: [] as string[], revoked: [] as string[], blobs: [] as Blob[] };
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:fake/${urls.created.length}`;
    urls.created.push(url);
    urls.blobs.push(blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    urls.revoked.push(url);
  });

  vi.resetModules();
  const natural = await import('../src/platform/natural-voice');
  const speech = await import('../src/platform/speech');

  const sent = (): Sent[] =>
    vi.mocked(bridge.postMessage).mock.calls.map(([raw]) => JSON.parse(raw));
  const sentNamed = (name: string) => sent().filter((message) => message.name === name);
  const speaks = () => sentNamed('tts').filter((message) => message.data.action === 'speak');
  const emitBridge = (name: string, data: unknown) => {
    for (const listener of [...bridgeListeners]) listener({ data: JSON.stringify({ name, data }) });
  };
  return {
    natural,
    speech,
    storage,
    native,
    server,
    fetcher,
    audio,
    urls,
    bridge,
    bridgeListeners,
    fakeWindow,
    sent,
    sentNamed,
    speaks,
    emitBridge,
    emitWindow,
    emitWindowRaw,
    listenerCount: (type: string) => listenersOf(type).length,
    fireWindow: (type: string) => {
      for (const listener of listenersOf(type)) listener({});
    },
    firePageHide: () => {
      for (const listener of listenersOf('pagehide')) listener({});
    },
    flush: () => vi.advanceTimersByTimeAsync(0),
    callbacks: () => ({ finished: vi.fn(), failed: vi.fn(), fallback: vi.fn() }),
    /** The service is ready and the preference is on. */
    ready: async () => {
      const prepared = await natural.prepareNaturalVoice();
      expect(prepared).toBe(true);
    },
  };
}

describe('natural voice preference', () => {
  it('is off by default and remembers the choice', async () => {
    const { natural, storage } = await setup();
    expect(natural.naturalVoiceEnabled()).toBe(false);
    natural.setNaturalVoiceEnabled(true);
    expect(storage.setItem).toHaveBeenLastCalledWith('tp-natural-voice', 'on');
    expect(natural.naturalVoiceEnabled()).toBe(true);
    natural.setNaturalVoiceEnabled(false);
    expect(storage.setItem).toHaveBeenLastCalledWith('tp-natural-voice', 'off');
    expect(natural.naturalVoiceEnabled()).toBe(false);
  });

  it('stays off when storage is blocked', async () => {
    const { natural } = await setup();
    const blocked = () => {
      throw new Error('storage denied');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(natural.naturalVoiceEnabled()).toBe(false);
    expect(() => natural.setNaturalVoiceEnabled(true)).not.toThrow();
  });
});

describe('segmentation', () => {
  const scalars = (text: string) => Array.from(text).length;
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  function expectUsable(segments: string[]) {
    for (const segment of segments) {
      expect(scalars(segment)).toBeLessThanOrEqual(80);
      expect(bytes(segment)).toBeLessThanOrEqual(320);
      expect(segment.trim()).toBe(segment);
      expect(segment).not.toBe('');
      expect(segment).not.toMatch(/[<>\p{Cc}\p{Cs}]/u);
    }
  }
  const letters = (segments: string[]) => segments.join('').replace(/\s+/g, '');

  it('keeps a short text as one segment', () => {
    expect(segmentText('你好，請問有什麼事？')).toEqual(['你好，請問有什麼事？']);
  });

  it('ends segments at sentence ends and packs short sentences together', () => {
    const text = Array.from({ length: 6 }, (_, i) => sentence(String(i + 1), 30)).join('');
    const segments = segmentText(text);
    // 30 + 30 = 60 fits in 80, 30 + 30 + 30 = 90 does not.
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(scalars(segment)).toBe(60);
      expect(segment.endsWith('。')).toBe(true);
    }
    expect(segments.join('')).toBe(text);
  });

  it.each([
    ['unpunctuated Chinese', '字'.repeat(500)],
    ['Chinese with commas but no sentence end', `${'字'.repeat(37)}，`.repeat(9)],
    ['four-byte characters', '\u{20000}'.repeat(250)],
    ['mixed Latin and Chinese', '開啟 Wi-Fi 設定後，請再按一次「連線」按鈕。'.repeat(20)],
    ['English without punctuation', 'reading aloud works '.repeat(40).trim()],
    ['one very long English word', 'a'.repeat(200)],
  ])('never exceeds 80 scalars or 320 bytes: %s', (_name, text) => {
    const segments = segmentText(text);
    expect(segments.length).toBeGreaterThan(1);
    expectUsable(segments);
    expect(letters(segments)).toBe(letters([text]));
  });

  it('really uses the full 320 bytes of four-byte characters', () => {
    const segments = segmentText('\u{20000}'.repeat(80));
    expect(segments).toHaveLength(1);
    expect(bytes(segments[0]!)).toBe(320);
    expect(segmentText('\u{20000}'.repeat(81))).toHaveLength(2);
  });

  it('cuts a long sentence at commas rather than in the middle of a clause', () => {
    // 120 characters in one sentence; a cut at 80 would land inside the third clause.
    const clause = (mark: string) => `${mark.repeat(29)}，`;
    const text = `${clause('一')}${clause('二')}${clause('三')}${'四'.repeat(29)}。`;
    expect(segmentText(text)).toEqual([
      `${clause('一')}${clause('二')}`,
      `${clause('三')}${'四'.repeat(29)}。`,
    ]);
  });

  it('does not cut English words when it has to cut by length', () => {
    // Without punctuation the 80th character falls inside a word (the words are 6 letters + a space).
    const segments = segmentText('abcdef '.repeat(40).trim());
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments)
      expect(segment.split(' ').every((word) => word === 'abcdef')).toBe(true);
  });

  it('removes <, >, control characters and lone surrogates', () => {
    expect(segmentText('a<b>c\u0000d\u0007e\ud800f 5<10 \u007f\u009f')).toEqual([
      'a b c d e f 5 10',
    ]);
    expectUsable(segmentText('<<<>>>你好<script>alert(1)</script>\u001b[0m再見'));
  });

  it('skips blank segments and segments without anything to say', () => {
    expect(segmentText('')).toEqual([]);
    expect(segmentText('  \n\t\n  \u2028 ')).toEqual([]);
    expect(segmentText('。。。\n？！\n——\n<>\n你好\n★★★')).toEqual(['你好']);
  });

  it('ends a segment at every line break', () => {
    expect(segmentText('第一行\r\n第二行\u2028第三行\n\n第四行')).toEqual([
      '第一行',
      '第二行',
      '第三行',
      '第四行',
    ]);
  });

  it('keeps decimals together but ends a sentence at a dot followed by a space', () => {
    expect(segmentText('字'.repeat(77) + '3.5公里')).toEqual(['字'.repeat(77) + '3.5', '公里']);
    expect(segmentText('字'.repeat(70) + 'ok. ' + '字'.repeat(20))).toEqual([
      '字'.repeat(70) + 'ok.',
      '字'.repeat(20),
    ]);
  });
});

describe('bridge requests', () => {
  const status = { phase: 'running', running: true };

  it('posts the request with a fresh ID and resolves with the matching reply only', async () => {
    const { natural, sent, emitWindow, emitWindowRaw, listenerCount, bridgeListeners } =
      await setup({ start: 'silent' });
    const pending = natural.requestTts('tts_status', 10000);
    const [request] = sent();
    expect(request).toEqual({
      name: 'tts_status',
      data: { requestId: expect.stringMatching(UUID) },
    });
    const requestId = request!.data.requestId as string;
    emitWindow('tts_start', { requestId, ...status }); // another name
    emitWindow('tts_status', { requestId: 'someone-else', ...status }); // another request
    emitWindow('tts_status', status); // no request ID
    emitWindowRaw('not json');
    emitWindowRaw({ name: 'tts_status', data: { requestId, ...status } }); // not a string
    emitWindowRaw(
      JSON.stringify({ name: 'tts_status', data: { requestId, ...status, x: 'x'.repeat(10000) } }),
    );
    expect(listenerCount('message')).toBe(1);
    emitWindow('tts_status', { requestId, ...status });
    await expect(pending).resolves.toMatchObject({ requestId, phase: 'running', running: true });
    expect(listenerCount('message')).toBe(0);
    // The replies come as window messages; nothing listens on the flutterObject.
    expect(bridgeListeners.size).toBe(0);
  });

  it('keeps concurrent requests apart', async () => {
    const { natural, sent, emitWindow } = await setup({ start: 'silent' });
    const first = natural.requestTts('tts_status', 10000);
    const second = natural.requestTts('tts_status', 10000);
    const [one, two] = sent().map((message) => message.data.requestId);
    expect(one).not.toBe(two);
    emitWindow('tts_status', { requestId: two, phase: 'idle', running: false });
    emitWindow('tts_status', { requestId: one, ...status });
    await expect(first).resolves.toMatchObject({ running: true });
    await expect(second).resolves.toMatchObject({ running: false });
  });

  it('accepts null for the optional fields', async () => {
    const { natural, sent, emitWindow } = await setup({ start: 'silent' });
    const pending = natural.requestTts('tts_stop', 10000);
    emitWindow('tts_stop', {
      requestId: sent()[0]!.data.requestId,
      phase: 'idle',
      running: false,
      baseUrl: null,
      apiKey: null,
      model: null,
      error: null,
    });
    await expect(pending).resolves.toMatchObject({ phase: 'idle', running: false });
  });

  it.each([
    ['an unknown phase', { phase: 'bogus', running: true }],
    ['a phase that is not a string', { phase: 1, running: true }],
    ['running that is not a boolean', { phase: 'running', running: 'yes' }],
    ['running missing', { phase: 'running' }],
    ['an apiKey that is not a string', { ...status, apiKey: 12345 }],
    ['a baseUrl that is not a string', { ...status, baseUrl: {} }],
    ['a model that is not a string', { ...status, model: ['bluemagpie-q8_0'] }],
    ['an error that is not a string', { phase: 'error', running: false, error: 7 }],
  ])('rejects a reply with %s', async (_name, reply) => {
    const { natural, sent, emitWindow, listenerCount } = await setup({ start: 'silent' });
    const pending = natural.requestTts('tts_status', 10000);
    const assertion = expect(pending).rejects.toThrow('TTS_BRIDGE_BAD_REPLY');
    emitWindow('tts_status', { requestId: sent()[0]!.data.requestId, ...reply });
    await assertion;
    expect(listenerCount('message')).toBe(0);
  });

  it('times out when the app never answers', async () => {
    const { natural, listenerCount } = await setup({ start: 'silent' });
    let outcome = 'pending';
    const pending = natural.requestTts('tts_status', 10000).catch((error: Error) => {
      outcome = error.message;
    });
    await vi.advanceTimersByTimeAsync(9999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(outcome).toBe('TTS_BRIDGE_TIMEOUT');
    expect(listenerCount('message')).toBe(0);
  });

  it('rejects without a bridge, without window events, or when the bridge throws', async () => {
    const { natural, bridge, fakeWindow, listenerCount } = await setup();
    vi.stubGlobal('window', {});
    await expect(natural.requestTts('tts_start', 1000)).rejects.toThrow('TTS_BRIDGE_UNAVAILABLE');
    vi.stubGlobal('window', { flutterObject: bridge });
    await expect(natural.requestTts('tts_start', 1000)).rejects.toThrow('TTS_BRIDGE_UNAVAILABLE');
    vi.stubGlobal('window', fakeWindow);
    vi.mocked(bridge.postMessage).mockImplementation(() => {
      throw new Error('disconnected');
    });
    await expect(natural.requestTts('tts_start', 1000)).rejects.toThrow('TTS_BRIDGE_UNAVAILABLE');
    expect(listenerCount('message')).toBe(0);
  });
});

describe('preparing the service', () => {
  it('starts once for concurrent calls and caches the endpoint', async () => {
    const { natural, sentNamed } = await setup({ enabled: true });
    const first = natural.prepareNaturalVoice();
    const second = natural.prepareNaturalVoice();
    expect(sentNamed('tts_start')).toHaveLength(1);
    expect(sentNamed('tts_start')[0]!.data).toEqual({ requestId: expect.stringMatching(UUID) });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    await expect(natural.prepareNaturalVoice()).resolves.toBe(true);
    expect(sentNamed('tts_start')).toHaveLength(1);
  });

  it('waits up to 240 s for the first start, then lets a later call start again', async () => {
    const { natural, sentNamed } = await setup({ enabled: true, start: 'silent' });
    let result: boolean | undefined;
    void natural.prepareNaturalVoice().then((ready) => (result = ready));
    await vi.advanceTimersByTimeAsync(239999);
    expect(result).toBeUndefined();
    void natural.prepareNaturalVoice();
    expect(sentNamed('tts_start')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(false);
    void natural.prepareNaturalVoice();
    expect(sentNamed('tts_start')).toHaveLength(2);
  });

  it('ignores a start reply for another request, so a forged reply cannot install a service', async () => {
    const { natural, sent, emitWindow, fetcher, flush } = await setup({
      enabled: true,
      start: 'silent',
    });
    const pending = natural.prepareNaturalVoice();
    emitWindow('tts_start', { requestId: 'forged', ...READY });
    await flush();
    expect(natural.speakNaturalVoice('你好', 1, vi.fn(), vi.fn())).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    emitWindow('tts_start', { requestId: sent()[0]!.data.requestId, ...READY });
    await expect(pending).resolves.toBe(true);
  });

  it('is not ready when the reply has the wrong types', async () => {
    const { natural, fetcher } = await setup({
      enabled: true,
      start: { ...READY, running: 'yes' },
    });
    await expect(natural.prepareNaturalVoice()).resolves.toBe(false);
    expect(natural.speakNaturalVoice('你好', 1, vi.fn(), vi.fn())).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['another host', { ...READY, baseUrl: 'http://10.0.2.2:41234/v1' }],
    ['https', { ...READY, baseUrl: 'https://127.0.0.1:41234/v1' }],
    ['a credential in the URL', { ...READY, baseUrl: 'http://127.0.0.1:41234@example.com/v1' }],
    ['a trailing slash', { ...READY, baseUrl: 'http://127.0.0.1:41234/v1/' }],
    ['port 0', { ...READY, baseUrl: 'http://127.0.0.1:0/v1' }],
    ['a port above 65535', { ...READY, baseUrl: 'http://127.0.0.1:99999/v1' }],
    ['a short key', { ...READY, apiKey: 'c'.repeat(63) }],
    ['an upper-case key', { ...READY, apiKey: 'C'.repeat(64) }],
    ['no key', { ...READY, apiKey: undefined }],
    ['another model', { ...READY, model: 'some-other-model' }],
    ['phase starting', { ...READY, phase: 'starting' }],
    ['phase error', { ...READY, phase: 'error' }],
    ['not running', { ...READY, running: false }],
    ['an error', { ...READY, error: 'origin_not_allowed' }],
  ])('is not ready for %s', async (_name, reply) => {
    const { natural, fetcher } = await setup({ enabled: true, start: reply });
    await expect(natural.prepareNaturalVoice()).resolves.toBe(false);
    expect(natural.speakNaturalVoice('你好', 1, vi.fn(), vi.fn())).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('starts again after a failure', async () => {
    const { natural, native, sentNamed } = await setup({ enabled: true });
    native.start = { phase: 'error', running: false, error: 'origin_not_allowed' };
    await expect(natural.prepareNaturalVoice()).resolves.toBe(false);
    native.start = READY;
    await expect(natural.prepareNaturalVoice()).resolves.toBe(true);
    expect(sentNamed('tts_start')).toHaveLength(2);
  });

  it('does nothing without the app', async () => {
    const { natural } = await setup({ enabled: true });
    vi.stubGlobal('window', {});
    await expect(natural.prepareNaturalVoice()).resolves.toBe(false);
  });
});

describe('releasing the service', () => {
  it('posts nothing when the service was never requested', async () => {
    const { natural, sent } = await setup({ enabled: true });
    natural.releaseNaturalVoice();
    expect(sent()).toEqual([]);
  });

  it('asks the app to stop once and forgets the key', async () => {
    const { natural, ready, sentNamed, sent, native, listenerCount } = await setup({
      enabled: true,
    });
    await ready();
    natural.releaseNaturalVoice();
    natural.releaseNaturalVoice();
    expect(sentNamed('tts_stop')).toHaveLength(1);
    expect(sentNamed('tts_stop')[0]!.data).toEqual({ requestId: expect.stringMatching(UUID) });
    // Best effort: nobody waits for the reply, and the request gives up after 10 s.
    expect(listenerCount('message')).toBe(1);
    await vi.advanceTimersByTimeAsync(9999);
    expect(listenerCount('message')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(listenerCount('message')).toBe(0);
    // Not ready any more: the next reading prepares again and uses the system voice.
    native.start = 'silent';
    expect(natural.speakNaturalVoice('你好', 1, vi.fn(), vi.fn())).toBe(false);
    expect(sent().map((message) => message.name)).toEqual(['tts_start', 'tts_stop', 'tts_start']);
  });

  it('does not let a start that was still under way come back to life', async () => {
    const { natural, sent, emitWindow, sentNamed } = await setup({
      enabled: true,
      start: 'silent',
    });
    const pending = natural.prepareNaturalVoice();
    natural.releaseNaturalVoice();
    expect(sentNamed('tts_stop')).toHaveLength(1);
    emitWindow('tts_start', { requestId: sent()[0]!.data.requestId, ...READY });
    await expect(pending).resolves.toBe(false);
    expect(natural.speakNaturalVoice('你好', 1, vi.fn(), vi.fn())).toBe(false);
  });

  it('stops the service and forgets the key when the page is hidden', async () => {
    const { natural, ready, listenerCount, firePageHide, sentNamed } = await setup({
      enabled: true,
    });
    expect(listenerCount('pagehide')).toBe(0);
    await ready();
    await natural.prepareNaturalVoice();
    expect(listenerCount('pagehide')).toBe(1);
    firePageHide();
    expect(sentNamed('tts_stop')).toHaveLength(1);
    expect(natural.speakNaturalVoice('你好', 1, vi.fn(), vi.fn())).toBe(false);
  });
});

describe('speaking with the natural voice', () => {
  it('leaves everything to the caller when the preference is off', async () => {
    const { natural, sent, fetcher, callbacks } = await setup();
    const { finished, fallback } = callbacks();
    expect(natural.speakNaturalVoice('你好', 1, finished, fallback)).toBe(false);
    expect(sent()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('prepares in the background and leaves this reading to the caller when not ready', async () => {
    const { natural, sentNamed, fetcher, flush, callbacks } = await setup({ enabled: true });
    const { finished, fallback } = callbacks();
    expect(natural.speakNaturalVoice('你好', 1, finished, fallback)).toBe(false);
    expect(natural.speakNaturalVoice('你好', 1, finished, fallback)).toBe(false);
    expect(sentNamed('tts_start')).toHaveLength(1);
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    // Once it is ready, the next reading uses it.
    expect(natural.speakNaturalVoice('你好', 1, finished, fallback)).toBe(true);
  });

  it('leaves a text with nothing to say to the caller', async () => {
    const { natural, ready, fetcher, callbacks } = await setup({ enabled: true });
    await ready();
    const { finished, fallback } = callbacks();
    expect(natural.speakNaturalVoice(' <> \n。。。', 1, finished, fallback)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('synthesizes with the documented request, plays the clip and releases its URL', async () => {
    const { natural, ready, fetcher, audio, urls, flush, callbacks } = await setup({
      enabled: true,
    });
    await ready();
    const { finished, fallback } = callbacks();
    const text = '你好，請問有什麼事？';
    expect(natural.speakNaturalVoice(text, 0.9, finished, fallback)).toBe(true);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/audio/speech`);
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'bluemagpie-q8_0',
      input: text,
      voice: 'default',
      response_format: 'wav',
    });
    expect(audio.played).toEqual([urls.created[0]]);
    const clip = audio.element;
    expect(clip.src).toBe(urls.created[0]);
    expect(clip.play).toHaveBeenCalledTimes(1);
    // The reading speed setting applies to the clip.
    expect(clip.playbackRate).toBe(0.9);
    expect(finished).not.toHaveBeenCalled();
    expect(urls.revoked).toEqual([]);
    clip.end();
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(urls.revoked).toEqual(urls.created);
    expect(clip.pause).toHaveBeenCalled();
    // The element lets go of the clip: no source and no handlers are left, and the media resource is
    // unloaded (removing the attribute alone does not do that).
    expect(clip.load).toHaveBeenCalled();
    expect(clip.src).toBe('');
    expect(clip.onended).toBeNull();
    expect(clip.onerror).toBeNull();
  });

  it.each([
    [0.7, 0.7],
    [1, 1],
    [Number.NaN, 1],
    [-3, 1],
    [0.1, 0.5],
    [9, 2],
  ])('plays at speed %s as %s', async (rate, expected) => {
    const { natural, ready, audio, flush, callbacks } = await setup({ enabled: true });
    await ready();
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好', rate, finished, fallback);
    await flush();
    expect(audio.element.playbackRate).toBe(expected);
  });

  it('plays the segments in order and synthesizes the next one while a clip plays', async () => {
    const { natural, ready, fetcher, audio, urls, flush, callbacks } = await setup({
      enabled: true,
    });
    await ready();
    const segments = segmentText(threeSegments);
    expect(segments).toHaveLength(3);
    const inputs = () => fetcher.mock.calls.map(([, init]) => JSON.parse(String(init.body)).input);
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    // The first clip plays; the second segment is already being synthesized, the third is not.
    expect(inputs()).toEqual(segments.slice(0, 2));
    expect(audio.played).toHaveLength(1);
    audio.element.end();
    await flush();
    expect(inputs()).toEqual(segments);
    expect(audio.played).toHaveLength(2);
    expect(urls.revoked).toEqual([urls.created[0]]);
    audio.element.end();
    await flush();
    expect(audio.played).toHaveLength(3);
    expect(finished).not.toHaveBeenCalled();
    audio.element.end();
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(urls.revoked).toEqual(urls.created);
  });

  it.each([
    ['an HTML page', { type: 'text/html' }],
    ['no type', { type: '' }],
    ['mp3', { type: 'audio/mpeg' }],
    ['a header only', { size: 44 }],
    ['an empty body', { size: 0 }],
    ['more than 30 seconds', { size: 2880045 }],
  ])('hands the text to the caller for audio that is %s', async (_name, response) => {
    const { natural, ready, server, audio, urls, flush, callbacks, sentNamed } = await setup({
      enabled: true,
    });
    await ready();
    server.respond = () => wav(response);
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好，請問有什麼事？', 1, finished, fallback);
    await flush();
    expect(fallback).toHaveBeenCalledExactlyOnceWith('你好，請問有什麼事？');
    expect(finished).not.toHaveBeenCalled();
    expect(audio.played).toHaveLength(0);
    expect(urls.created).toEqual([]);
    // A bad clip says nothing about the key: the service stays ready.
    expect(natural.speakNaturalVoice('再試一次', 1, finished, fallback)).toBe(true);
    expect(sentNamed('tts_start')).toHaveLength(1);
  });

  it('accepts the exact limits of a clip and a media type with parameters', async () => {
    const { natural, ready, server, audio, flush, callbacks } = await setup({ enabled: true });
    await ready();
    server.respond = () => wav({ size: 2880044, type: 'audio/wav; charset=binary' });
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好', 1, finished, fallback);
    await flush();
    expect(audio.played).toHaveLength(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('gives the text that was not spoken to the caller when a later segment fails', async () => {
    const { natural, ready, server, fetcher, audio, flush, callbacks } = await setup({
      enabled: true,
    });
    await ready();
    const segments = segmentText(threeSegments);
    server.respond = ({ input }) => (input === segments[1] ? wav({ status: 502 }) : wav());
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    // The failure is only noticed when the second clip would start; the first one plays on.
    expect(fallback).not.toHaveBeenCalled();
    audio.element.end();
    await flush();
    expect(fallback).toHaveBeenCalledExactlyOnceWith(`${segments[1]} ${segments[2]}`);
    expect(finished).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(audio.played).toHaveLength(1);
  });

  it('gives the whole text to the caller when the first segment fails', async () => {
    const { natural, ready, server, callbacks, flush } = await setup({ enabled: true });
    await ready();
    server.respond = () => Promise.reject(new TypeError('Failed to fetch'));
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    expect(fallback).toHaveBeenCalledExactlyOnceWith(segmentText(threeSegments).join(' '));
    expect(finished).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'forgets the service after a %s, so the next reading prepares again',
    async (status) => {
      const { natural, ready, server, sentNamed, callbacks, flush } = await setup({
        enabled: true,
      });
      await ready();
      server.respond = () => wav({ status });
      const { finished, fallback } = callbacks();
      natural.speakNaturalVoice('你好', 1, finished, fallback);
      await flush();
      expect(fallback).toHaveBeenCalledExactlyOnceWith('你好');
      expect(natural.speakNaturalVoice('你好', 1, finished, fallback)).toBe(false);
      expect(sentNamed('tts_start')).toHaveLength(2);
    },
  );

  it('forgets the service after a network failure', async () => {
    const { natural, ready, server, sentNamed, callbacks, flush } = await setup({ enabled: true });
    await ready();
    server.respond = () => Promise.reject(new TypeError('Failed to fetch'));
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好', 1, finished, fallback);
    await flush();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(natural.speakNaturalVoice('你好', 1, finished, fallback)).toBe(false);
    expect(sentNamed('tts_start')).toHaveLength(2);
  });

  it('gives up on a synthesis after 30 s and forgets the service', async () => {
    const { natural, ready, server, fetcher, sentNamed, callbacks } = await setup({
      enabled: true,
    });
    await ready();
    server.respond = hang;
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好', 1, finished, fallback);
    await vi.advanceTimersByTimeAsync(29999);
    expect(fallback).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0]![1].signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher.mock.calls[0]![1].signal!.aborted).toBe(true);
    expect(fallback).toHaveBeenCalledExactlyOnceWith('你好');
    expect(natural.speakNaturalVoice('你好', 1, finished, fallback)).toBe(false);
    expect(sentNamed('tts_start')).toHaveLength(2);
  });

  it.each([400, 415, 429, 502])('keeps the service after a %s', async (status) => {
    const { natural, ready, server, sentNamed, callbacks, flush } = await setup({ enabled: true });
    await ready();
    server.respond = () => wav({ status });
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好', 1, finished, fallback);
    await flush();
    expect(fallback).toHaveBeenCalledExactlyOnceWith('你好');
    expect(natural.speakNaturalVoice('你好', 1, finished, fallback)).toBe(true);
    expect(sentNamed('tts_start')).toHaveLength(1);
  });

  it('does not discard a newer service because of a late failure of an old reading', async () => {
    const { natural, ready, native, server, sentNamed, callbacks, flush } = await setup({
      enabled: true,
    });
    await ready();
    let answer: (response: Response) => void = () => {};
    server.respond = () => new Promise<Response>((resolve) => (answer = resolve));
    const old = callbacks();
    natural.speakNaturalVoice('你好', 1, old.finished, old.fallback);
    await flush();
    // The page lets go of the service, and a new one with another key is prepared meanwhile.
    natural.releaseNaturalVoice();
    native.start = { ...READY, apiKey: 'd'.repeat(64) };
    await expect(natural.prepareNaturalVoice()).resolves.toBe(true);
    answer(wav({ status: 401 }));
    await flush();
    expect(old.fallback).not.toHaveBeenCalled();
    server.respond = () => wav();
    const next = callbacks();
    expect(natural.speakNaturalVoice('你好', 1, next.finished, next.fallback)).toBe(true);
    expect(sentNamed('tts_start')).toHaveLength(2);
  });

  it('aborts the synthesis under way when it is stopped, and stays silent', async () => {
    const { natural, ready, server, fetcher, audio, callbacks, flush } = await setup({
      enabled: true,
    });
    await ready();
    server.respond = hang;
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    const { signal } = fetcher.mock.calls[0]![1];
    expect(signal!.aborted).toBe(false);
    natural.stopNaturalVoice();
    expect(signal!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(finished).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(audio.played).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('pauses the clip and aborts the next synthesis when it is stopped while playing', async () => {
    const { natural, ready, fetcher, server, audio, urls, callbacks, flush } = await setup({
      enabled: true,
    });
    await ready();
    const segments = segmentText(threeSegments);
    server.respond = (request) => (request.input === segments[0] ? wav() : hang(request));
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    const clip = audio.element;
    const prefetch = fetcher.mock.calls[1]![1].signal!;
    expect(prefetch.aborted).toBe(false);
    natural.stopNaturalVoice();
    expect(clip.pause).toHaveBeenCalled();
    expect(prefetch.aborted).toBe(true);
    expect(urls.revoked).toEqual(urls.created);
    clip.end(); // A late event of the stopped clip changes nothing.
    await vi.advanceTimersByTimeAsync(60000);
    expect(finished).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(audio.played).toHaveLength(1);
  });

  it('does not start a clip that arrives in the same moment as a stop', async () => {
    const { natural, ready, server, fetcher, audio, urls, callbacks, flush } = await setup({
      enabled: true,
    });
    await ready();
    server.respond = () =>
      ({
        ok: true,
        status: 200,
        blob: async () => {
          // The stop lands right before the reading would continue with the finished clip.
          void Promise.resolve().then(() => natural.stopNaturalVoice());
          return new Blob([new Uint8Array(4800)], { type: 'audio/wav' });
        },
      }) as unknown as Response;
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    expect(audio.played).toHaveLength(0);
    expect(urls.created).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('aborts the next synthesis when a clip fails to play', async () => {
    const { natural, ready, server, fetcher, audio, callbacks, flush } = await setup({
      enabled: true,
    });
    await ready();
    const segments = segmentText(threeSegments);
    server.respond = (request) => (request.input === segments[0] ? wav() : hang(request));
    audio.blocked = true;
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    expect(fallback).toHaveBeenCalledExactlyOnceWith(segments.join(' '));
    expect(fetcher.mock.calls[1]![1].signal!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('does nothing when stopped while idle', async () => {
    const { natural, sent, fetcher } = await setup({ enabled: true });
    expect(() => natural.stopNaturalVoice()).not.toThrow();
    expect(sent()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('replaces the current reading silently when a new one starts', async () => {
    const { natural, ready, audio, urls, callbacks, flush } = await setup({ enabled: true });
    await ready();
    const first = callbacks();
    const second = callbacks();
    natural.speakNaturalVoice('第一段', 1, first.finished, first.fallback);
    await flush();
    natural.speakNaturalVoice('第二段', 1, second.finished, second.fallback);
    await flush();
    expect(audio.played).toHaveLength(2);
    expect(audio.element.pause).toHaveBeenCalled();
    expect(urls.revoked).toEqual([urls.created[0]]);
    audio.element.end();
    audio.element.end();
    await flush();
    expect(first.finished).not.toHaveBeenCalled();
    expect(first.fallback).not.toHaveBeenCalled();
    expect(second.finished).toHaveBeenCalledTimes(1);
  });

  it('hands the text to the caller when the browser refuses to play', async () => {
    const { natural, ready, audio, urls, callbacks, flush } = await setup({ enabled: true });
    await ready();
    audio.blocked = true;
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好', 1, finished, fallback);
    await flush();
    expect(fallback).toHaveBeenCalledExactlyOnceWith('你好');
    expect(urls.revoked).toEqual(urls.created);
  });

  it('starts the caller at the clip that failed to play, not after it', async () => {
    const { natural, ready, audio, callbacks, flush } = await setup({ enabled: true });
    await ready();
    const segments = segmentText(threeSegments);
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    audio.element.end();
    await flush();
    audio.element.fail();
    await flush();
    expect(fallback).toHaveBeenCalledExactlyOnceWith(`${segments[1]} ${segments[2]}`);
    expect(finished).not.toHaveBeenCalled();
  });

  it('gives up on a clip that never ends after 35 s', async () => {
    const { natural, ready, audio, urls, callbacks, flush } = await setup({ enabled: true });
    await ready();
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好', 1, finished, fallback);
    await flush();
    await vi.advanceTimersByTimeAsync(34999);
    expect(fallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fallback).toHaveBeenCalledExactlyOnceWith('你好');
    expect(audio.element.pause).toHaveBeenCalled();
    expect(urls.revoked).toEqual(urls.created);
  });

  it('does not let a throwing callback become an unhandled rejection', async () => {
    const { natural, ready, audio, flush } = await setup({ enabled: true });
    await ready();
    natural.speakNaturalVoice(
      '你好',
      1,
      () => {
        throw new Error('callback failed');
      },
      vi.fn(),
    );
    await flush();
    audio.element.end();
    await flush();
  });

  it('keeps the key in memory only and never logs it', async () => {
    const { natural, ready, storage, sent, audio, flush, callbacks } = await setup({
      enabled: true,
    });
    const session = memoryStorage();
    vi.stubGlobal('sessionStorage', session);
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    await ready();
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    for (let i = 0; i < 3; i += 1) {
      audio.element.end();
      await flush();
    }
    expect(finished).toHaveBeenCalledTimes(1);
    natural.setNaturalVoiceEnabled(true);
    natural.releaseNaturalVoice();
    expect(JSON.stringify(storage.setItem.mock.calls)).not.toContain(KEY);
    expect(storage.setItem.mock.calls.map(([name]) => name)).toEqual(['tp-natural-voice']);
    expect(session.setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(sent())).not.toContain(KEY);
    for (const spy of consoles) expect(spy).not.toHaveBeenCalled();
  });
});

describe('the shared audio element', () => {
  const gestures = ['pointerdown', 'pointerup', 'keydown', 'click'];

  it('plays every clip on one element, swapping the source and releasing each URL', async () => {
    const { natural, ready, audio, urls, flush, callbacks } = await setup({ enabled: true });
    await ready();
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice(threeSegments, 1, finished, fallback);
    await flush();
    for (let i = 0; i < 3; i += 1) {
      audio.element.end();
      await flush();
    }
    expect(finished).toHaveBeenCalledTimes(1);
    expect(audio.instances).toHaveLength(1);
    expect(urls.created).toHaveLength(3);
    // Each clip started the element with its own URL, and every URL was released.
    expect(audio.played).toEqual(urls.created);
    expect(urls.revoked).toEqual(urls.created);
  });

  it('applies the speed of each reading to the shared element, whatever the clip before had', async () => {
    const { natural, ready, audio, flush, callbacks } = await setup({ enabled: true });
    await ready();
    const speeds: number[] = [];
    for (const rate of [0.7, 1.4, 1]) {
      const { finished, fallback } = callbacks();
      natural.speakNaturalVoice('你好', rate, finished, fallback);
      await flush();
      speeds.push(audio.element.playbackRate);
      audio.element.end();
      await flush();
    }
    expect(speeds).toEqual([0.7, 1.4, 1]);
    expect(audio.instances).toHaveLength(1);
  });

  it('keeps the same element for the next reading', async () => {
    const { natural, ready, audio, flush, callbacks } = await setup({ enabled: true });
    await ready();
    const first = callbacks();
    const second = callbacks();
    natural.speakNaturalVoice('第一段', 1, first.finished, first.fallback);
    await flush();
    const element = audio.element;
    element.end();
    await flush();
    natural.speakNaturalVoice('第二段', 1, second.finished, second.fallback);
    await flush();
    element.end();
    await flush();
    expect(audio.instances).toHaveLength(1);
    expect(audio.played).toHaveLength(2);
    expect(first.finished).toHaveBeenCalledTimes(1);
    expect(second.finished).toHaveBeenCalledTimes(1);
  });

  it('creates no element, and listens to nothing, until the natural voice is used', async () => {
    const { natural, listenerCount, audio } = await setup({ enabled: true });
    for (const type of gestures) expect(listenerCount(type)).toBe(0);
    expect(audio.instances).toHaveLength(0);
    natural.armNaturalVoiceAudio();
    for (const type of gestures) expect(listenerCount(type)).toBe(1);
    // Nothing is created before the first interaction either.
    expect(audio.instances).toHaveLength(0);
  });

  it('arms when the service is prepared, once, and listens in the capture phase', async () => {
    const { natural, ready, fakeWindow, listenerCount } = await setup({ enabled: true });
    await ready();
    natural.armNaturalVoiceAudio();
    natural.armNaturalVoiceAudio();
    for (const type of gestures) {
      expect(listenerCount(type)).toBe(1);
      // One registration per event, made in the capture phase.
      expect(fakeWindow.addEventListener.mock.calls.filter(([name]) => name === type)).toEqual([
        [type, expect.any(Function), true],
      ]);
    }
  });

  it('does not arm outside the app', async () => {
    const { natural, audio, fakeWindow } = await setup({ enabled: true });
    vi.stubGlobal('window', { addEventListener: fakeWindow.addEventListener });
    expect(() => natural.armNaturalVoiceAudio()).not.toThrow();
    expect(fakeWindow.addEventListener).not.toHaveBeenCalled();
    expect(audio.instances).toHaveLength(0);
  });

  it.each(gestures)('unlocks the element at the first %s with a silent clip', async (type) => {
    const { natural, audio, urls, fireWindow, listenerCount, flush } = await setup({
      enabled: true,
    });
    natural.armNaturalVoiceAudio();
    fireWindow(type);
    await flush();
    // The element was started on the silent clip, then paused and let go of.
    expect(audio.instances).toHaveLength(1);
    expect(audio.played).toEqual([urls.created[0]]);
    expect(audio.element.pause).toHaveBeenCalled();
    expect(audio.element.src).toBe('');
    expect(urls.revoked).toEqual(urls.created);
    // Done: nothing listens any more, and later interactions change nothing.
    for (const other of gestures) expect(listenerCount(other)).toBe(0);
    fireWindow(type);
    await flush();
    expect(audio.played).toHaveLength(1);
  });

  it('unlocks with a short silent WAV that is built in code', async () => {
    const { natural, urls, fireWindow, flush } = await setup({ enabled: true });
    natural.armNaturalVoiceAudio();
    fireWindow('pointerdown');
    await flush();
    const blob = urls.blobs[0]!;
    expect(blob.type).toBe('audio/wav');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    expect([text(0, 4), text(8, 12), text(12, 16), text(36, 40)]).toEqual([
      'RIFF',
      'WAVE',
      'fmt ',
      'data',
    ]);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true) * 2).toBe(view.getUint32(28, true)); // 16 bit samples
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(bytes.length - 44);
    expect(bytes.slice(44).every((byte) => byte === 0)).toBe(true);
    // A short clip: well under 100 ms.
    expect((bytes.length - 44) / 2 / view.getUint32(24, true)).toBeLessThan(0.1);
    expect(bytes.length).toBeLessThan(4000);
  });

  it('keeps listening after a refused attempt, and tries again at the next interaction', async () => {
    const { natural, audio, urls, fireWindow, listenerCount, flush } = await setup({
      enabled: true,
    });
    natural.armNaturalVoiceAudio();
    audio.blocked = true;
    fireWindow('pointerdown');
    await flush();
    expect(audio.played).toHaveLength(1);
    // The refused attempt let go of the element and its URL, and nothing is unlocked yet.
    expect(audio.element.src).toBe('');
    expect(urls.revoked).toEqual(urls.created);
    for (const type of gestures) expect(listenerCount(type)).toBe(1);
    audio.blocked = false;
    fireWindow('pointerup');
    await flush();
    expect(audio.played).toHaveLength(2);
    for (const type of gestures) expect(listenerCount(type)).toBe(0);
  });

  it('does not start a second attempt while one is under way', async () => {
    const { natural, audio, fireWindow, listenerCount, flush } = await setup({ enabled: true });
    natural.armNaturalVoiceAudio();
    audio.hold = true;
    fireWindow('pointerdown');
    fireWindow('pointerup');
    fireWindow('click');
    await flush();
    expect(audio.played).toHaveLength(1);
    expect(audio.element.pause).not.toHaveBeenCalled();
    audio.pending!.resolve();
    await flush();
    expect(audio.element.pause).toHaveBeenCalled();
    expect(audio.played).toHaveLength(1);
    for (const type of gestures) expect(listenerCount(type)).toBe(0);
  });

  it('leaves the element alone when an interaction comes while a clip is starting on it', async () => {
    const { natural, ready, audio, urls, fireWindow, listenerCount, flush, callbacks } =
      await setup({ enabled: true });
    await ready();
    audio.hold = true;
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好', 1, finished, fallback);
    await flush();
    expect(audio.played).toEqual([urls.created[0]]);
    fireWindow('pointerdown');
    await flush();
    // No second source, no second start: the clip keeps the element.
    expect(audio.played).toEqual([urls.created[0]]);
    expect(audio.element.src).toBe(urls.created[0]);
    audio.pending!.resolve();
    await flush();
    // The clip started, which is proof enough that the element may play.
    for (const type of gestures) expect(listenerCount(type)).toBe(0);
    audio.element.end();
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('lets a clip take the element from an attempt that is still under way', async () => {
    const { natural, ready, audio, urls, fireWindow, listenerCount, flush, callbacks } =
      await setup({ enabled: true });
    await ready();
    audio.hold = true;
    fireWindow('pointerdown');
    expect(audio.played).toEqual([urls.created[0]]);
    audio.hold = false;
    const { finished, fallback } = callbacks();
    natural.speakNaturalVoice('你好', 1, finished, fallback);
    await flush();
    // The clip started on the same element. The interrupted attempt did not fail the clip, and did
    // not reset the element under it; only its own URL was released.
    expect(audio.instances).toHaveLength(1);
    expect(audio.played).toEqual([urls.created[0], urls.created[1]]);
    expect(audio.element.src).toBe(urls.created[1]);
    expect(urls.revoked).toEqual([urls.created[0]]);
    expect(fallback).not.toHaveBeenCalled();
    for (const type of gestures) expect(listenerCount(type)).toBe(0);
    audio.element.end();
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(urls.revoked).toEqual(urls.created);
  });

  it('stops listening when the natural voice is released, and listens again when it is used', async () => {
    const { natural, ready, audio, fireWindow, listenerCount, flush } = await setup({
      enabled: true,
    });
    await ready();
    natural.releaseNaturalVoice();
    for (const type of gestures) expect(listenerCount(type)).toBe(0);
    fireWindow('pointerdown');
    await flush();
    expect(audio.instances).toHaveLength(0);
    await natural.prepareNaturalVoice();
    for (const type of gestures) expect(listenerCount(type)).toBe(1);
  });

  it('does not listen again once the element is unlocked', async () => {
    const { natural, ready, audio, fakeWindow, fireWindow, listenerCount, flush } = await setup({
      enabled: true,
    });
    const registrations = () =>
      fakeWindow.addEventListener.mock.calls.filter(([type]) => gestures.includes(type)).length;
    await ready();
    expect(registrations()).toBe(gestures.length);
    fireWindow('click');
    await flush();
    expect(audio.played).toHaveLength(1);
    natural.releaseNaturalVoice();
    await natural.prepareNaturalVoice();
    natural.armNaturalVoiceAudio();
    for (const type of gestures) expect(listenerCount(type)).toBe(0);
    expect(registrations()).toBe(gestures.length);
  });

  it('survives an element that cannot be created', async () => {
    const { natural, ready, fireWindow, listenerCount, flush } = await setup({ enabled: true });
    await ready();
    vi.stubGlobal('Audio', undefined);
    expect(() => fireWindow('pointerdown')).not.toThrow();
    await flush();
    // Nothing was unlocked, so the next interaction may try again.
    for (const type of gestures) expect(listenerCount(type)).toBe(1);
    const { finished, fallback } = { finished: vi.fn(), fallback: vi.fn() };
    natural.speakNaturalVoice('你好', 1, finished, fallback);
    await flush();
    expect(fallback).toHaveBeenCalledExactlyOnceWith('你好');
  });
});

describe('read-aloud with the natural voice', () => {
  const zh = 'zh-Hant-TW';

  it('uses the natural voice in the app for Chinese when it is ready', async () => {
    const { speech, ready, speaks, fetcher, audio, flush, callbacks } = await setup({
      enabled: true,
    });
    await ready();
    const { finished, failed } = callbacks();
    speech.readAloud('你好，請問有什麼事？', zh, 0.9, finished, failed);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(audio.played).toHaveLength(1);
    expect(speaks()).toEqual([]);
    expect(finished).not.toHaveBeenCalled();
    audio.element.end();
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(speaks()).toEqual([]);
  });

  it('keeps using the system voice when the preference is off', async () => {
    const { speech, speaks, sentNamed, fetcher, emitBridge, callbacks, flush } = await setup();
    const { finished, failed } = callbacks();
    speech.readAloud('你好', zh, 0.9, finished, failed);
    expect(sentNamed('tts_start')).toEqual([]);
    expect(speaks()).toEqual([
      {
        name: 'tts',
        data: {
          requestId: expect.any(String),
          action: 'speak',
          text: '你好',
          lang: 'zh-TW',
          rate: 0.9,
        },
      },
    ]);
    const requestId = speaks()[0]!.data.requestId;
    emitBridge('tts', { requestId, event: 'start' });
    emitBridge('tts', { requestId, event: 'done' });
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps using the system voice for English', async () => {
    const { speech, ready, speaks, fetcher, callbacks } = await setup({ enabled: true });
    await ready();
    const { finished, failed } = callbacks();
    speech.readAloud('hello', 'en', 1, finished, failed);
    expect(speaks().map((message) => message.data.text)).toEqual(['hello']);
    expect(speaks()[0]!.data.lang).toBe('en-US');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('prepares in the background and reads this time with the system voice when not ready', async () => {
    const { speech, sent, speaks, fetcher, emitBridge, audio, flush, callbacks } = await setup({
      enabled: true,
    });
    const { finished, failed } = callbacks();
    speech.readAloud('你好', zh, 1, finished, failed);
    // No waiting: the start is posted, and the system voice speaks right away.
    expect(sent().map((message) => message.name)).toEqual(['tts_start', 'tts']);
    expect(speaks().map((message) => message.data.text)).toEqual(['你好']);
    const requestId = speaks()[0]!.data.requestId;
    emitBridge('tts', { requestId, event: 'start' });
    emitBridge('tts', { requestId, event: 'done' });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    // The service became ready meanwhile: the next reading uses it.
    await flush();
    const next = callbacks();
    speech.readAloud('你好', zh, 1, next.finished, next.failed);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(audio.played).toHaveLength(1);
    expect(speaks()).toHaveLength(1);
  });

  it('reads the rest with the system voice when a segment fails, and settles once', async () => {
    const { speech, ready, server, speaks, sentNamed, emitBridge, audio, flush, callbacks } =
      await setup({ enabled: true });
    await ready();
    const segments = segmentText(threeSegments);
    server.respond = ({ input }) => (input === segments[1] ? wav({ status: 502 }) : wav());
    const { finished, failed } = callbacks();
    speech.readAloud(threeSegments, zh, 0.7, finished, failed);
    await flush();
    audio.element.end();
    await flush();
    expect(speaks()).toEqual([
      {
        name: 'tts',
        data: {
          requestId: expect.any(String),
          action: 'speak',
          text: `${segments[1]} ${segments[2]}`,
          lang: 'zh-TW',
          rate: 0.7,
        },
      },
    ]);
    // Handing over is not the end: nothing is heard yet, and nothing was stopped on the bridge.
    expect(finished).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(sentNamed('tts').map((message) => message.data.action)).toEqual(['speak']);
    const requestId = speaks()[0]!.data.requestId;
    emitBridge('tts', { requestId, event: 'start' });
    emitBridge('tts', { requestId, event: 'done' });
    emitBridge('tts', { requestId, event: 'done' });
    emitBridge('tts', { requestId, event: 'error' });
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('reports a failure of the system voice once, after the natural voice failed', async () => {
    const { speech, ready, server, speaks, emitBridge, flush, callbacks } = await setup({
      enabled: true,
    });
    await ready();
    server.respond = () => wav({ status: 502 });
    const { finished, failed } = callbacks();
    speech.readAloud('你好', zh, 1, finished, failed);
    await flush();
    const requestId = speaks()[0]!.data.requestId;
    emitBridge('tts', { requestId, event: 'error', error: 'engine' });
    emitBridge('tts', { requestId, event: 'error', error: 'engine' });
    emitBridge('tts', { requestId, event: 'done' });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
  });

  it('reports a failure once when the system voice never starts after the natural voice failed', async () => {
    const { speech, ready, server, sentNamed, flush, callbacks } = await setup({ enabled: true });
    await ready();
    server.respond = () => wav({ status: 502 });
    const { finished, failed } = callbacks();
    speech.readAloud('你好', zh, 1, finished, failed);
    await flush();
    await vi.advanceTimersByTimeAsync(4999);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
    // The request that never started is stopped, so it cannot start speaking late.
    expect(sentNamed('tts').map((message) => message.data.action)).toEqual(['speak', 'stop']);
    await vi.advanceTimersByTimeAsync(60000);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('finishes once, and stops the system voice, when the reading is stopped during the fallback', async () => {
    const { speech, ready, server, sentNamed, speaks, emitBridge, flush, callbacks } = await setup({
      enabled: true,
    });
    await ready();
    server.respond = () => wav({ status: 502 });
    const { finished, failed } = callbacks();
    speech.readAloud('你好', zh, 1, finished, failed);
    await flush();
    const requestId = speaks()[0]!.data.requestId;
    emitBridge('tts', { requestId, event: 'start' });
    speech.stopReading();
    expect(finished).toHaveBeenCalledTimes(1);
    // The system voice is the one speaking now, so this one does need a stop on the bridge.
    expect(sentNamed('tts').map((message) => message.data.action)).toEqual(['speak', 'stop']);
    emitBridge('tts', { requestId, event: 'stopped' });
    emitBridge('tts', { requestId, event: 'done' });
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('reads with the system voice when the element refuses to play, and recovers after an interaction', async () => {
    const {
      speech,
      ready,
      speaks,
      emitBridge,
      audio,
      urls,
      fetcher,
      fireWindow,
      listenerCount,
      flush,
      callbacks,
    } = await setup({ enabled: true });
    await ready();
    audio.blocked = true;
    const first = callbacks();
    speech.readAloud('你好', zh, 1, first.finished, first.failed);
    await flush();
    // The clip was refused: the system voice reads the text, and the reading is not over yet.
    expect(speaks().map((message) => message.data.text)).toEqual(['你好']);
    expect(first.finished).not.toHaveBeenCalled();
    const requestId = speaks()[0]!.data.requestId;
    emitBridge('tts', { requestId, event: 'start' });
    emitBridge('tts', { requestId, event: 'done' });
    expect(first.finished).toHaveBeenCalledTimes(1);
    expect(first.failed).not.toHaveBeenCalled();
    // The next interaction unlocks the element: the refused clip did not leave it marked as in use.
    audio.blocked = false;
    fireWindow('pointerup');
    await flush();
    expect(audio.played).toEqual([urls.created[0], urls.created[1]]);
    expect(listenerCount('pointerup')).toBe(0);
    // From then on the natural voice plays.
    const second = callbacks();
    speech.readAloud('你好', zh, 1, second.finished, second.failed);
    await flush();
    expect(speaks()).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(audio.played).toHaveLength(3);
    audio.element.end();
    await flush();
    expect(second.finished).toHaveBeenCalledTimes(1);
    expect(second.failed).not.toHaveBeenCalled();
  });

  it('finishes a natural reading once when stopReading stops it, with nothing on the bridge', async () => {
    const { speech, ready, server, fetcher, sent, callbacks, flush } = await setup({
      enabled: true,
    });
    await ready();
    server.respond = hang;
    const { finished, failed } = callbacks();
    speech.readAloud(threeSegments, zh, 1, finished, failed);
    await flush();
    expect(finished).not.toHaveBeenCalled();
    const before = sent().length;
    speech.stopReading();
    expect(fetcher.mock.calls[0]![1].signal!.aborted).toBe(true);
    // Whoever waits for the reading is told at once, like for a stopped system reading...
    expect(finished).toHaveBeenCalledTimes(1);
    // ...and the system voice was not reading, so there is nothing to stop on the bridge.
    expect(sent()).toHaveLength(before);
    speech.stopReading();
    await vi.advanceTimersByTimeAsync(60000);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(before);
  });

  it('pauses the playing clip with stopReading and finishes the reading once', async () => {
    const { speech, ready, audio, urls, callbacks, flush } = await setup({ enabled: true });
    await ready();
    const { finished, failed } = callbacks();
    speech.readAloud('你好', zh, 1, finished, failed);
    await flush();
    speech.stopReading();
    expect(audio.element.pause).toHaveBeenCalled();
    expect(urls.revoked).toEqual(urls.created);
    expect(finished).toHaveBeenCalledTimes(1);
    // A late event of the stopped clip changes nothing.
    audio.element.end();
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('finishes a natural reading once when it ends by itself, and a later stop adds nothing', async () => {
    const { speech, ready, audio, sent, callbacks, flush } = await setup({ enabled: true });
    await ready();
    const { finished, failed } = callbacks();
    speech.readAloud('你好', zh, 1, finished, failed);
    await flush();
    audio.element.end();
    await flush();
    expect(finished).toHaveBeenCalledTimes(1);
    const before = sent().length;
    speech.stopReading();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(before);
  });

  it('finishes a natural reading once when the system voice replaces it, with no stop on the bridge', async () => {
    const { speech, ready, speaks, sentNamed, emitBridge, audio, callbacks, flush } = await setup({
      enabled: true,
    });
    await ready();
    const first = callbacks();
    speech.readAloud('第一段', zh, 1, first.finished, first.failed);
    await flush();
    // English never uses the natural voice, so the system voice reads the next reading.
    const second = callbacks();
    speech.readAloud('second', 'en', 1, second.finished, second.failed);
    expect(first.finished).toHaveBeenCalledTimes(1);
    expect(first.failed).not.toHaveBeenCalled();
    expect(audio.element.pause).toHaveBeenCalled();
    expect(speaks().map((message) => message.data.text)).toEqual(['second']);
    expect(sentNamed('tts').map((message) => message.data.action)).toEqual(['speak']);
    // A late event of the replaced clip changes nothing; the new reading ends on its own events.
    audio.element.end();
    await flush();
    expect(first.finished).toHaveBeenCalledTimes(1);
    expect(second.finished).not.toHaveBeenCalled();
    const requestId = speaks()[0]!.data.requestId;
    emitBridge('tts', { requestId, event: 'start' });
    emitBridge('tts', { requestId, event: 'done' });
    expect(second.finished).toHaveBeenCalledTimes(1);
    expect(first.finished).toHaveBeenCalledTimes(1);
  });

  it('stops a system reading in progress before the natural voice starts', async () => {
    const { speech, sent, speaks, emitBridge, audio, fetcher, flush, callbacks } = await setup({
      enabled: true,
    });
    // Not ready yet, so the first reading uses the system voice and is still speaking...
    const first = callbacks();
    speech.readAloud('第一段', zh, 1, first.finished, first.failed);
    const firstId = speaks()[0]!.data.requestId;
    emitBridge('tts', { requestId: firstId, event: 'start' });
    // ...when the service becomes ready and the next reading starts.
    await flush();
    const second = callbacks();
    speech.readAloud('第二段', zh, 1, second.finished, second.failed);
    await flush();
    expect(sent().at(-1)).toEqual({
      name: 'tts',
      data: { requestId: expect.any(String), action: 'stop' },
    });
    expect(speaks()).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // The replaced system reading ends once, as `finished`, and its late events change nothing; the
    // natural one finishes normally.
    expect(first.finished).toHaveBeenCalledTimes(1);
    emitBridge('tts', { requestId: firstId, event: 'stopped' });
    emitBridge('tts', { requestId: firstId, event: 'done' });
    audio.element.end();
    await flush();
    expect(first.finished).toHaveBeenCalledTimes(1);
    expect(first.failed).not.toHaveBeenCalled();
    expect(second.finished).toHaveBeenCalledTimes(1);
    expect(second.failed).not.toHaveBeenCalled();
  });

  it('starts a new natural reading over the one in progress without leaving the system voice on', async () => {
    const { speech, ready, speaks, audio, flush, callbacks } = await setup({ enabled: true });
    await ready();
    const first = callbacks();
    const second = callbacks();
    speech.readAloud('第一段', zh, 1, first.finished, first.failed);
    await flush();
    speech.readAloud('第二段', zh, 1, second.finished, second.failed);
    await flush();
    expect(audio.played).toHaveLength(2);
    expect(audio.element.pause).toHaveBeenCalled();
    // The replaced reading ended the moment the new one began; the new one is still going.
    expect(first.finished).toHaveBeenCalledTimes(1);
    expect(second.finished).not.toHaveBeenCalled();
    audio.element.end();
    audio.element.end();
    await flush();
    expect(first.finished).toHaveBeenCalledTimes(1);
    expect(first.failed).not.toHaveBeenCalled();
    expect(second.finished).toHaveBeenCalledTimes(1);
    expect(speaks()).toEqual([]);
  });

  it('leaves the browser alone', async () => {
    const { speech, ready, sent, fetcher, callbacks } = await setup({ enabled: true });
    await ready();
    const calls: string[] = [];
    class FakeUtterance {
      lang = '';
      rate = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    const synth = {
      cancel: vi.fn(() => calls.push('cancel')),
      speak: vi.fn(() => calls.push('speak')),
      getVoices: vi.fn(() => []),
    };
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('window', {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: FakeUtterance,
    });
    const before = sent().length;
    const { finished, failed } = callbacks();
    speech.readAloud('你好', zh, 1, finished, failed);
    speech.stopReading();
    expect(calls).toEqual(['cancel', 'speak', 'cancel']);
    expect(sent()).toHaveLength(before);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

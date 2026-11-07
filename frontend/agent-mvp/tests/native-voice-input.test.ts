import { afterEach, describe, expect, it, vi } from 'vitest';
import { voiceWav } from '../src/platform/voice-wav';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('ASR WAV encoding', () => {
  it('downsamples mono audio to PCM16 WAV and clips extreme samples', async () => {
    const blob = voiceWav([new Float32Array([2, 2, 2, -2, -2, -2])], 48000);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    expect(new TextDecoder().decode(buffer.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(buffer.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
  it('refuses empty, unbounded or malformed input', () => {
    expect(() => voiceWav([], 48000)).toThrow();
    expect(() => voiceWav([new Float32Array(1)], NaN)).toThrow();
    expect(() => voiceWav([new Float32Array(8000 * 31)], 8000)).toThrow();
  });
});

async function setup({
  ready,
  silent = false,
}: { ready?: Record<string, unknown>; silent?: boolean } = {}) {
  vi.useFakeTimers();
  const sent: { name: string; data: Record<string, unknown> }[] = [];
  const listeners = new Set<(event: { data: string }) => void>();
  const pageListeners = new Map<string, () => void>();
  const readyReply = ready ?? {
    phase: 'running',
    running: true,
    baseUrl: 'http://127.0.0.1:43210/v1',
    apiKey: 'd'.repeat(64),
  };
  const emit = (name: string, requestId: unknown, value: object) => {
    for (const listener of listeners)
      listener({ data: JSON.stringify({ name, data: { ...value, requestId } }) });
  };
  vi.stubGlobal('window', {
    flutterObject: {
      postMessage(raw: string) {
        const request = JSON.parse(raw);
        sent.push(request);
        if (request.name === 'asr_start' && !silent)
          queueMicrotask(() => emit(request.name, request.data.requestId, readyReply));
        if (request.name === 'asr_stop')
          queueMicrotask(() =>
            emit(request.name, request.data.requestId, { phase: 'idle', running: false }),
          );
      },
      addEventListener: (_: string, listener: (event: { data: string }) => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: (event: { data: string }) => void) =>
        listeners.delete(listener),
    },
    addEventListener: (name: string, listener: () => void) => pageListeners.set(name, listener),
    removeEventListener: (name: string) => pageListeners.delete(name),
  });
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null as ((event: unknown) => void) | null,
  };
  const mute = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 48000;
      destination = {};
      resume = async () => {};
      close = close;
      createMediaStreamSource = () => source;
      createScriptProcessor = () => processor;
      createGain = () => mute;
    },
  );
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '幫我找圖書' })));
  vi.stubGlobal('fetch', fetcher);
  const status = vi.fn();
  const text = vi.fn();
  const finished = vi.fn();
  const { createNativeVoiceInput } = await import('../src/platform/native-voice-input');
  const voice = createNativeVoiceInput(status, text, finished);
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const audio = () =>
    processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array(48000).fill(0.1) },
    });
  return {
    voice,
    sent,
    emit,
    status,
    text,
    finished,
    fetcher,
    getUserMedia,
    stopTrack,
    processor,
    source,
    mute,
    close,
    flush,
    audio,
    stream,
    pageListeners,
  };
}

describe('native voice lifecycle', () => {
  it('sends authenticated WAV to loopback, releases audio and returns editable text', async () => {
    const app = await setup();
    app.voice.start('zh-Hant-TW');
    await app.flush();
    expect(app.status).toHaveBeenLastCalledWith('listening');
    expect(app.mute.gain.value).toBe(0);
    app.audio();
    app.voice.finish();
    await app.flush();
    const [url, init] = app.fetcher.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:43210/v1/audio/transcriptions');
    expect(init.headers.Authorization).toBe(`Bearer ${'d'.repeat(64)}`);
    expect(init.redirect).toBe('error');
    expect(init.body.get('language')).toBe('zh');
    const file = init.body.get('file') as File;
    expect(file.type).toBe('audio/wav');
    expect(file.size).toBe(32044);
    expect(app.text).toHaveBeenCalledWith('幫我找圖書');
    expect(app.finished).toHaveBeenCalledOnce();
    expect(app.stopTrack).toHaveBeenCalled();
    expect(app.close).toHaveBeenCalled();
    expect(app.sent.map((request) => request.name)).toEqual(['asr_start', 'asr_stop']);
  });
  it('rejects an untrusted endpoint before microphone capture or credential use', async () => {
    const app = await setup({
      ready: {
        phase: 'running',
        running: true,
        baseUrl: 'https://external.example/v1',
        apiKey: 'd'.repeat(64),
      },
    });
    app.voice.start('en');
    await app.flush();
    expect(app.status).toHaveBeenLastCalledWith('error');
    expect(app.getUserMedia).not.toHaveBeenCalled();
    expect(app.fetcher).not.toHaveBeenCalled();
  });
  it('reports a missing model without starting the microphone', async () => {
    const app = await setup({ ready: { phase: 'error', running: false, error: 'model missing' } });
    app.voice.start('en');
    await app.flush();
    expect(app.status).toHaveBeenLastCalledWith('modelUnavailable');
    expect(app.getUserMedia).not.toHaveBeenCalled();
  });
  it('reports an unauthorized page as unavailable rather than a missing model', async () => {
    const app = await setup({
      ready: { phase: 'error', running: false, error: 'origin_not_allowed' },
    });
    app.voice.start('en');
    await app.flush();
    expect(app.status).toHaveBeenLastCalledWith('unavailable');
    expect(app.getUserMedia).not.toHaveBeenCalled();
  });
  it('reports permission denial and stops the ASR service', async () => {
    const app = await setup();
    app.getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    app.voice.start('en');
    await app.flush();
    expect(app.status).toHaveBeenLastCalledWith('permission');
    expect(app.fetcher).not.toHaveBeenCalled();
    expect(app.sent.at(-1)?.name).toBe('asr_stop');
  });
  it('ignores a late start after cancellation and reaps its service', async () => {
    const app = await setup({ silent: true });
    app.voice.start('en');
    await app.flush();
    app.voice.cancel();
    app.emit('asr_start', app.sent[0]!.data.requestId, {
      phase: 'running',
      running: true,
      baseUrl: 'http://127.0.0.1:43210/v1',
      apiKey: 'd'.repeat(64),
    });
    await app.flush();
    expect(app.getUserMedia).not.toHaveBeenCalled();
    expect(app.finished).not.toHaveBeenCalled();
    expect(app.sent.at(-1)?.name).toBe('asr_stop');
  });
  it('cancels transcription and ignores its late text', async () => {
    const app = await setup();
    let respond!: (response: Response) => void;
    app.fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    app.voice.start('en');
    await app.flush();
    app.audio();
    app.voice.finish();
    await app.flush();
    app.voice.cancel();
    respond(new Response(JSON.stringify({ text: 'late text' })));
    await app.flush();
    expect(app.text).not.toHaveBeenCalled();
    expect(app.finished).not.toHaveBeenCalled();
    expect(app.fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
  });
  it('stops capturing when the page is hidden', async () => {
    const app = await setup();
    app.voice.start('en');
    await app.flush();
    app.pageListeners.get('pagehide')?.();
    await app.flush();
    expect(app.stopTrack).toHaveBeenCalled();
    expect(app.processor.onaudioprocess).toBeNull();
    expect(app.fetcher).not.toHaveBeenCalled();
  });
  it('limits recording to thirty seconds and times out an unresponsive transcription', async () => {
    const app = await setup();
    app.fetcher.mockImplementation(() => new Promise(() => {}));
    app.voice.start('en');
    await app.flush();
    app.audio();
    await vi.advanceTimersByTimeAsync(30000);
    expect(app.status).toHaveBeenLastCalledWith('transcribing');
    expect(app.stopTrack).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120000);
    expect(app.status).toHaveBeenLastCalledWith('error');
    expect(app.sent.at(-1)?.name).toBe('asr_stop');
  });
  it('closes tracks returned by a permission prompt after cancellation', async () => {
    const app = await setup();
    let grant!: (stream: unknown) => void;
    app.getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    app.voice.start('en');
    await app.flush();
    app.voice.cancel();
    grant(app.stream);
    await app.flush();
    expect(app.stopTrack).toHaveBeenCalled();
    expect(app.source.connect).not.toHaveBeenCalled();
  });
});

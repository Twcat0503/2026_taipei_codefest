import { requestNative, type NativeData } from './native-bridge';
import type { VoiceStatus } from './voice-input';
import { voiceWav } from './voice-wav';

const START_TIMEOUT = 4 * 60 * 1000;
const TRANSCRIBE_TIMEOUT = 2 * 60 * 1000;
const RECORD_LIMIT = 30 * 1000;
type Session = {
  abort: AbortController;
  context?: AudioContext;
  stream?: MediaStream;
  source?: MediaStreamAudioSourceNode;
  processor?: ScriptProcessorNode;
  mute?: GainNode;
  start?: Promise<NativeData>;
  chunks: Float32Array[];
  samples: number;
  locale: string;
  recording: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

function endpoint(reply: NativeData) {
  if (reply.error === 'origin_not_allowed') throw new Error('NATIVE_BRIDGE_UNAVAILABLE');
  if (reply.running !== true || reply.phase !== 'running' || reply.error)
    throw new Error('ASR_NOT_READY');
  if (typeof reply.baseUrl !== 'string' || typeof reply.apiKey !== 'string')
    throw new Error('ASR_BAD_ENDPOINT');
  const match = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/v1$/.exec(reply.baseUrl);
  if (
    !match ||
    Number(match[1]) < 1 ||
    Number(match[1]) > 65535 ||
    !/^[0-9a-f]{64}$/.test(reply.apiKey)
  )
    throw new Error('ASR_BAD_ENDPOINT');
  return { url: `${reply.baseUrl}/audio/transcriptions`, key: reply.apiKey };
}

/** Records in the WebView, then sends a short WAV only to the authenticated loopback ASR. */
export function createNativeVoiceInput(
  onStatus: (status: VoiceStatus) => void,
  onText: (text: string) => void,
  onFinished: () => void,
) {
  let active: Session | undefined;
  // Serialize stops and restarts so a late start/stop cannot stop the next recording's service.
  let cleaning: Promise<void> = Promise.resolve();
  const current = (session: Session) => active === session && !session.abort.signal.aborted;
  function releaseAudio(session: Session) {
    clearTimeout(session.timer);
    session.recording = false;
    if (session.processor) session.processor.onaudioprocess = null;
    for (const node of [session.source, session.processor, session.mute]) {
      try {
        node?.disconnect();
      } catch {
        /* An already disconnected node needs no cleanup. */
      }
    }
    session.stream?.getTracks().forEach((track) => track.stop());
    session.stream = undefined;
    void session.context?.close().catch(() => {});
    session.context = undefined;
  }
  function cancel() {
    const previous = active;
    if (!previous) return;
    active = undefined;
    previous.abort.abort();
    releaseAudio(previous);
    previous.chunks = [];
    window.removeEventListener('pagehide', cancel);
    if (previous.start) {
      cleaning = Promise.all([cleaning, previous.start.catch(() => undefined)])
        .then(async () => {
          await requestNative('asr_stop', {}, { timeoutMs: 10000 });
        })
        .catch(() => {});
    }
  }
  function fail(session: Session, error: unknown) {
    if (!current(session)) return;
    const message = error instanceof Error ? error.message : '';
    onStatus(
      message === 'ASR_NOT_READY'
        ? 'modelUnavailable'
        : message === 'NotAllowedError' ||
            (error instanceof DOMException && error.name === 'NotAllowedError')
          ? 'permission'
          : message === 'NATIVE_BRIDGE_UNAVAILABLE' || message === 'MICROPHONE_UNAVAILABLE'
            ? 'unavailable'
            : 'error',
    );
    cancel();
  }
  async function prepare(session: Session) {
    try {
      await cleaning;
      if (!current(session)) return;
      session.start = requestNative('asr_start', {}, { timeoutMs: START_TIMEOUT });
      const ready = await session.start;
      if (!current(session)) return;
      endpoint(ready);
      if (!navigator.mediaDevices?.getUserMedia || !session.context)
        throw new Error('MICROPHONE_UNAVAILABLE');
      const permissionTimer = (session.timer = setTimeout(
        () => fail(session, new Error('MICROPHONE_TIMEOUT')),
        60000,
      ));
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true },
          video: false,
        });
      } finally {
        clearTimeout(permissionTimer);
      }
      if (!current(session)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      session.stream = stream;
      const context = session.context;
      session.source = context.createMediaStreamSource(stream);
      // WebView support includes ScriptProcessor; raw PCM avoids unsupported AAC/WebM recordings.
      session.processor = context.createScriptProcessor(4096, 1, 1);
      session.mute = context.createGain();
      session.mute.gain.value = 0;
      session.processor.onaudioprocess = (event) => {
        if (!current(session) || !session.recording) return;
        const input = event.inputBuffer.getChannelData(0);
        const remaining = Math.max(0, Math.floor(context.sampleRate * 30) - session.samples);
        const chunk = input.slice(0, remaining);
        session.chunks.push(chunk);
        session.samples += chunk.length;
        if (remaining <= input.length) void finish();
      };
      session.source.connect(session.processor);
      session.processor.connect(session.mute);
      session.mute.connect(context.destination);
      session.recording = true;
      onStatus('listening');
      session.timer = setTimeout(() => void finish(), RECORD_LIMIT);
    } catch (error) {
      fail(session, error);
    }
  }
  async function finish() {
    const session = active;
    if (!session?.recording || !session.context) return;
    session.recording = false;
    try {
      const wav = voiceWav(session.chunks, session.context.sampleRate);
      session.chunks = [];
      releaseAudio(session);
      onStatus('transcribing');
      const ready = endpoint(await session.start!);
      if (!current(session)) return;
      const body = new FormData();
      body.append('file', wav, 'voice.wav');
      body.append('language', session.locale === 'en' ? 'en' : 'zh');
      body.append('response_format', 'json');
      session.timer = setTimeout(() => fail(session, new Error('ASR_TIMEOUT')), TRANSCRIBE_TIMEOUT);
      const response = await fetch(ready.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ready.key}` },
        body,
        signal: session.abort.signal,
        redirect: 'error',
      });
      if (!current(session)) return;
      if (!response.ok) throw new Error('ASR_TRANSCRIPTION_FAILED');
      const text = await response.text();
      if (!current(session)) return;
      if (text.length > 10000) throw new Error('ASR_INVALID_RESPONSE');
      const value: unknown = JSON.parse(text);
      if (
        !value ||
        typeof value !== 'object' ||
        !('text' in value) ||
        typeof value.text !== 'string' ||
        !value.text.trim()
      )
        throw new Error('ASR_EMPTY_TEXT');
      onText(value.text.trim().slice(0, 600));
      onStatus('idle');
      cancel();
      onFinished();
    } catch (error) {
      fail(session, error);
    }
  }
  return {
    start(locale: string) {
      cancel();
      const session: Session = {
        abort: new AbortController(),
        chunks: [],
        samples: 0,
        locale,
        recording: false,
      };
      active = session;
      window.addEventListener('pagehide', cancel);
      onStatus('starting');
      try {
        session.context = new AudioContext();
        const resumeTimer = (session.timer = setTimeout(
          () => fail(session, new Error('AUDIO_RESUME_TIMEOUT')),
          10000,
        ));
        void session.context.resume().then(
          () => {
            clearTimeout(resumeTimer);
            if (current(session)) void prepare(session);
          },
          (error) => {
            clearTimeout(resumeTimer);
            fail(session, error);
          },
        );
      } catch {
        fail(session, new Error('MICROPHONE_UNAVAILABLE'));
      }
    },
    finish() {
      void finish();
    },
    cancel,
  };
}

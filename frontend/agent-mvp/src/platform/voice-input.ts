import { hasNativeBridge, newNativeRequestId, postNative } from './native-bridge';

export type VoiceStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'transcribing'
  | 'modelUnavailable'
  | 'unavailable'
  | 'permission'
  | 'error';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

type SpeechEvent = { type: string; text?: string; error?: string };
const THINKING_PAUSE_MS = 4000;

/**
 * Reads a `speech_start` reply for `requestId`. Like the TTS bridge, these arrive as `message`
 * events on `window` (posted to this page's origin only), not on `flutterObject`.
 */
function parseSpeechEvent(raw: unknown, requestId: string): SpeechEvent | undefined {
  if (typeof raw !== 'string' || raw.length > 4096) return undefined;
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof message !== 'object' || message === null) return undefined;
  const { name, data } = message as { name?: unknown; data?: unknown };
  if (name !== 'speech_start' || typeof data !== 'object' || data === null) return undefined;
  const { requestId: id, type, text, error } = data as Record<string, unknown>;
  if (id !== requestId || typeof type !== 'string') return undefined;
  return {
    type,
    text: typeof text === 'string' ? text : undefined,
    error: typeof error === 'string' ? error : undefined,
  };
}

/**
 * Android system recognition in the WebView; standalone browsers use the Web Speech API.
 */
export function createVoiceInput(
  onStatus: (status: VoiceStatus) => void,
  onText: (text: string) => void,
  onFinished: () => void,
) {
  let recognition: Recognition | undefined;
  let nativeSession:
    { requestId: string; receive: (event: { data?: unknown }) => void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  const endNative = (notify: boolean) => {
    const session = nativeSession;
    if (!session) return;
    nativeSession = undefined;
    window.removeEventListener('message', session.receive);
    window.removeEventListener('pagehide', cancel);
    if (notify) postNative('speech_cancel', { requestId: session.requestId });
  };
  const startNative = (locale: string) => {
    const requestId = newNativeRequestId();
    let transcript = '';
    const receive = (message: { data?: unknown }) => {
      if (nativeSession?.requestId !== requestId) return;
      const event = parseSpeechEvent(message?.data, requestId);
      if (!event) return;
      if (event.type === 'listening') onStatus('listening');
      else if (event.type === 'partial' && event.text) {
        transcript = event.text;
        onText(transcript.slice(0, 600));
      } else if (event.type === 'final') {
        clearTimeout(timer);
        clearTimeout(silenceTimer);
        endNative(false);
        transcript = event.text ?? transcript;
        if (!transcript.trim()) onStatus('error');
        else {
          onText(transcript.slice(0, 600));
          onStatus('idle');
          onFinished();
        }
      } else if (event.type === 'error') {
        clearTimeout(timer);
        clearTimeout(silenceTimer);
        endNative(false);
        onStatus(
          event.error === 'permission'
            ? 'permission'
            : event.error === 'unavailable' || event.error === 'origin_not_allowed'
              ? 'unavailable'
              : 'error',
        );
      }
    };
    nativeSession = { requestId, receive };
    window.addEventListener('message', receive);
    window.addEventListener('pagehide', cancel);
    onStatus('starting');
    if (!postNative('speech_start', { requestId, language: locale === 'en' ? 'en-US' : 'zh-TW' })) {
      endNative(false);
      onStatus('unavailable');
      return;
    }
    timer = setTimeout(() => {
      endNative(true);
      onStatus('error');
    }, 30000);
  };
  const cancel = () => {
    window.removeEventListener('pagehide', cancel);
    clearTimeout(timer);
    clearTimeout(silenceTimer);
    endNative(true);
    const previous = recognition;
    recognition = undefined;
    if (previous) {
      previous.onstart = previous.onend = previous.onerror = previous.onresult = null;
      try {
        previous.abort();
      } catch {
        /* Some implementations reject abort after the microphone has closed. */
      }
    }
  };
  return {
    start(locale: string) {
      cancel();
      if (hasNativeBridge()) {
        startNative(locale);
        return;
      }
      const target = window as VoiceWindow;
      const Constructor = target.SpeechRecognition ?? target.webkitSpeechRecognition;
      if (!Constructor) {
        onStatus('unavailable');
        return;
      }
      let current: Recognition;
      try {
        current = new Constructor();
      } catch {
        onStatus('unavailable');
        return;
      }
      recognition = current;
      current.lang = locale === 'en' ? 'en-US' : 'zh-TW';
      current.continuous = true;
      current.interimResults = true;
      let transcript = '';
      let failed = false;
      current.onstart = () => onStatus('listening');
      current.onresult = ({ results }) => {
        transcript = Array.from(results, (result) => result[0]?.transcript ?? '').join('');
        onText(transcript.slice(0, 600));
        clearTimeout(silenceTimer);
        if (transcript.trim()) silenceTimer = setTimeout(() => current.stop(), THINKING_PAUSE_MS);
      };
      current.onerror = ({ error }) => {
        failed = true;
        clearTimeout(timer);
        clearTimeout(silenceTimer);
        onStatus(
          error === 'not-allowed' || error === 'service-not-allowed' ? 'permission' : 'error',
        );
      };
      current.onend = () => {
        clearTimeout(timer);
        clearTimeout(silenceTimer);
        recognition = undefined;
        if (failed) return;
        if (!transcript.trim()) onStatus('error');
        else {
          onStatus('idle');
          onFinished();
        }
      };
      onStatus('starting');
      try {
        current.start();
        timer = setTimeout(() => {
          cancel();
          onStatus('error');
        }, 30000);
      } catch {
        cancel();
        onStatus('error');
      }
    },
    finish() {
      if (nativeSession) postNative('speech_stop', { requestId: nativeSession.requestId });
      recognition?.stop();
    },
    cancel,
  };
}

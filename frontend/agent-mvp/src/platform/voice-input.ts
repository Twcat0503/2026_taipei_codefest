import { createNativeVoiceInput } from './native-voice-input';

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

/** Native WebViews use local ASR; standalone browsers use their speech-recognition API. */
export function createVoiceInput(
  onStatus: (status: VoiceStatus) => void,
  onText: (text: string) => void,
  onFinished: () => void,
) {
  let recognition: Recognition | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const native = createNativeVoiceInput(onStatus, onText, onFinished);
  const cancel = () => {
    native.cancel();
    clearTimeout(timer);
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
      if (window.flutterObject) {
        native.start(locale);
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
      current.continuous = false;
      current.interimResults = true;
      let transcript = '';
      let failed = false;
      current.onstart = () => onStatus('listening');
      current.onresult = ({ results }) => {
        transcript = Array.from(results, (result) => result[0]?.transcript ?? '').join('');
        onText(transcript.slice(0, 600));
      };
      current.onerror = ({ error }) => {
        failed = true;
        clearTimeout(timer);
        onStatus(
          error === 'not-allowed' || error === 'service-not-allowed' ? 'permission' : 'error',
        );
      };
      current.onend = () => {
        clearTimeout(timer);
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
      native.finish();
      recognition?.stop();
    },
    cancel,
  };
}

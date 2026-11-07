import { hasNativeBridge, listenNative, newNativeRequestId, postNative } from './native-bridge';

/** The native side must confirm with a `start` event within this time, or the reading fails. */
const NATIVE_START_TIMEOUT_MS = 5000;

type NativeReading = {
  startTimer?: ReturnType<typeof setTimeout>;
  unlisten: () => void;
};

/** The one native `tts` speak request whose events still matter; events of any other are stale. */
let nativeReading: NativeReading | undefined;

function hasBrowserSpeech() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  );
}

function forgetNativeReading() {
  const current = nativeReading;
  nativeReading = undefined;
  if (!current) return;
  clearTimeout(current.startTimer);
  current.unlisten();
}

function sendNativeStop() {
  postNative('tts', { requestId: newNativeRequestId(), action: 'stop' });
}

/** In the app reading goes through the native `tts` bridge; in a browser through speechSynthesis. */
export function canReadAloud() {
  return hasNativeBridge() || hasBrowserSpeech();
}
export function stopReading() {
  // Only an active native reading needs a stop. Posting one while idle would put unrelated
  // traffic on the bridge, and the native side already stops before every new reading.
  const reading = nativeReading !== undefined;
  forgetNativeReading();
  if (hasNativeBridge()) {
    if (reading) sendNativeStop();
  } else if (typeof window !== 'undefined' && 'speechSynthesis' in window)
    window.speechSynthesis.cancel();
}
export function readAloud(
  text: string,
  lang: string,
  rate: number,
  finished: () => void,
  failed: () => void,
) {
  if (hasNativeBridge()) readAloudNative(text, lang, rate, finished, failed);
  else readAloudInBrowser(text, lang, rate, finished, failed);
}

function readAloudNative(
  text: string,
  lang: string,
  rate: number,
  finished: () => void,
  failed: () => void,
) {
  stopReading();
  const requestId = newNativeRequestId();
  const current: NativeReading = { unlisten: () => {} };
  // Settles the reading at most once; stopped, replaced or already settled readings stay silent.
  const settle = (callback: () => void) => {
    if (nativeReading !== current) return;
    forgetNativeReading();
    callback();
  };
  current.unlisten = listenNative('tts', requestId, (reply) => {
    if (reply.event === 'start') clearTimeout(current.startTimer);
    else if (reply.event === 'done' || reply.event === 'stopped') settle(finished);
    else if (reply.event === 'error') settle(failed);
  });
  current.startTimer = setTimeout(() => {
    if (nativeReading !== current) return;
    // Never confirmed: give up, and make sure the request cannot start speaking late.
    sendNativeStop();
    settle(failed);
  }, NATIVE_START_TIMEOUT_MS);
  nativeReading = current;
  const sent = postNative('tts', {
    requestId,
    action: 'speak',
    text,
    lang: lang === 'en' ? 'en-US' : 'zh-TW',
    rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
  });
  if (!sent) settle(failed);
}

function readAloudInBrowser(
  text: string,
  lang: string,
  rate: number,
  finished: () => void,
  failed: () => void,
) {
  if (!hasBrowserSpeech()) {
    failed();
    return;
  }
  stopReading();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'en' ? 'en-US' : 'zh-TW';
  utterance.rate = rate;
  // Prefer an installed voice, avoiding network-backed voice selection where available.
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.localService && v.lang.toLowerCase() === utterance.lang.toLowerCase());
  if (voice) utterance.voice = voice;
  utterance.onend = finished;
  utterance.onerror = failed;
  window.speechSynthesis.speak(utterance);
}

import { hasNativeBridge, listenNative, newNativeRequestId, postNative } from './native-bridge';
import { speakNaturalVoice, stopNaturalVoice } from './natural-voice';

/** The native side must confirm with a `start` event within this time, or the reading fails. */
const NATIVE_START_TIMEOUT_MS = 5000;
/**
 * A started native reading must report its end (`done`, `stopped` or `error`) within this time at
 * normal speed (the rate divides it): a fixed part plus an allowance per character. It only
 * catches a lost end event, so it is far longer than any real reading.
 */
const NATIVE_END_BASE_MS = 15000;
const NATIVE_END_PER_CHAR_MS = 400;
/** `setTimeout` runs a longer delay at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

type Reading = {
  /** What the caller hears when the reading is stopped or replaced. */
  finished: () => void;
  /** The natural voice speaks it, not the system voice, so there is nothing to stop on the bridge. */
  naturalVoice?: boolean;
  startTimer?: ReturnType<typeof setTimeout>;
  endTimer?: ReturnType<typeof setTimeout>;
  unlisten: () => void;
};

/**
 * The one reading, native, by the natural voice or in a browser, whose events still matter; events
 * of any other are stale. Every reading ends exactly once and its caller hears about it exactly
 * once: `finished` or `failed` when it ends by itself, `finished` when `stopReading()` or the next
 * `readAloud()` ends it. Callers can rely on that to reset their "speaking" state.
 */
let reading: Reading | undefined;

function hasBrowserSpeech() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  );
}

/** Forgets the current reading with its timers and listener, without telling its caller. */
function forgetReading() {
  const current = reading;
  reading = undefined;
  if (!current) return undefined;
  clearTimeout(current.startTimer);
  clearTimeout(current.endTimer);
  current.unlisten();
  return current;
}

/** Ends `current` and calls `callback`, unless it was already stopped, replaced or ended. */
function end(current: Reading, callback: () => void) {
  if (reading !== current) return;
  forgetReading();
  callback();
}

function sendNativeStop() {
  postNative('tts', { requestId: newNativeRequestId(), action: 'stop' });
}

/** In the app reading goes through the native `tts` bridge; in a browser through speechSynthesis. */
export function canReadAloud() {
  return hasNativeBridge() || hasBrowserSpeech();
}
export function stopReading() {
  // Forgetting a natural voice reading stops its playback (its `unlisten`).
  const stopped = forgetReading();
  if (hasNativeBridge()) {
    // Only an active native reading needs a stop. Posting one while idle, or for the natural voice
    // that the system voice never heard of, would put unrelated traffic on the bridge, and the
    // native side already stops before every new reading.
    if (stopped && !stopped.naturalVoice) sendNativeStop();
  } else if (typeof window !== 'undefined' && 'speechSynthesis' in window)
    window.speechSynthesis.cancel();
  // A stopped reading still ends: whoever waits for it must be able to reset.
  stopped?.finished();
}
export function readAloud(
  text: string,
  lang: string,
  rate: number,
  finished: () => void,
  failed: () => void,
) {
  if (hasNativeBridge() && lang !== 'en' && readAloudNatural(text, lang, rate, finished, failed))
    return;
  if (hasNativeBridge()) readAloudNative(text, lang, rate, finished, failed);
  else readAloudInBrowser(text, lang, rate, finished, failed);
}

/**
 * Reads with the opt-in natural voice (natural-voice.ts), which takes Chinese when its service is
 * ready. False when the system voice has to read it: the preference is off, the service is not
 * ready, or there is nothing to say. Registers the reading like any other, so it ends exactly once.
 */
function readAloudNatural(
  text: string,
  lang: string,
  rate: number,
  finished: () => void,
  failed: () => void,
) {
  // Ends the reading this one replaces, so its caller is not left waiting.
  stopReading();
  const current: Reading = { finished, naturalVoice: true, unlisten: stopNaturalVoice };
  const started = speakNaturalVoice(
    text,
    rate,
    () => end(current, finished),
    // What it could not speak goes to the system voice. This reading ends by handing over, not by
    // calling `finished`: the system reading carries the same callbacks, so the caller hears
    // `finished` or `failed` once, from that one.
    (rest) => end(current, () => readAloudNative(rest, lang, rate, finished, failed)),
  );
  // Neither callback runs before this returns, so the reading can be registered afterwards.
  if (started) reading = current;
  return started;
}

function readAloudNative(
  text: string,
  lang: string,
  rate: number,
  finished: () => void,
  failed: () => void,
) {
  // Ends the reading this one replaces, so its caller is not left waiting.
  stopReading();
  const requestId = newNativeRequestId();
  const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const current: Reading = { finished, unlisten: () => {} };
  current.unlisten = listenNative('tts', requestId, (reply) => {
    if (reply.event === 'start') {
      if (reading !== current) return;
      clearTimeout(current.startTimer);
      clearTimeout(current.endTimer);
      current.endTimer = setTimeout(
        () => {
          if (reading !== current) return;
          // The end was never reported: stop the native side so it cannot go on talking.
          sendNativeStop();
          end(current, finished);
        },
        Math.min((NATIVE_END_BASE_MS + NATIVE_END_PER_CHAR_MS * text.length) / speed, MAX_TIMER_MS),
      );
    } else if (reply.event === 'done' || reply.event === 'stopped') end(current, finished);
    else if (reply.event === 'error') end(current, failed);
  });
  current.startTimer = setTimeout(() => {
    if (reading !== current) return;
    // Never confirmed: give up, and make sure the request cannot start speaking late.
    sendNativeStop();
    end(current, failed);
  }, NATIVE_START_TIMEOUT_MS);
  reading = current;
  const sent = postNative('tts', {
    requestId,
    action: 'speak',
    text,
    lang: lang === 'en' ? 'en-US' : 'zh-TW',
    rate: speed,
  });
  if (!sent) end(current, failed);
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
  // Ends the reading this one replaces, so its caller is not left waiting.
  stopReading();
  const current: Reading = { finished, unlisten: () => {} };
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'en' ? 'en-US' : 'zh-TW';
  utterance.rate = rate;
  // Prefer an installed voice, avoiding network-backed voice selection where available.
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.localService && v.lang.toLowerCase() === utterance.lang.toLowerCase());
  if (voice) utterance.voice = voice;
  utterance.onend = () => end(current, finished);
  // `speechSynthesis.cancel()`, ours or anyone else's, ends an utterance with one of these two
  // errors. That is a stop, not a failure.
  utterance.onerror = (event) =>
    end(current, event?.error === 'interrupted' || event?.error === 'canceled' ? finished : failed);
  reading = current;
  window.speechSynthesis.speak(utterance);
}

import { hasNativeBridge, newNativeRequestId, postNative } from './native-bridge';
import { getPreference, setPreference } from './storage';

/**
 * Opt-in natural voice for read-aloud: the app's on-device BlueMagpie text-to-speech service.
 *
 * `tts_start` over the WebView bridge starts a loopback HTTP server and replies with its address and
 * a Bearer key. Text is cut into short segments; each one is synthesized to a WAV with
 * `POST /audio/speech` and played through an `<audio>` element. Whatever could not be spoken is
 * handed back to the caller, which reads it with the system voice, so text and the system voice stay
 * the baseline. The key lives in memory only: never logged, never stored.
 */

const preferenceKey = 'tp-natural-voice';

/** The first start verifies and loads ~2.26 GB of model files, which can take minutes. */
const START_TIMEOUT_MS = 4 * 60 * 1000;
const CONTROL_TIMEOUT_MS = 10 * 1000;
/** One synthesis; a segment is at most 80 characters. */
const REQUEST_TIMEOUT_MS = 30 * 1000;
/** A clip lasts at most 30 s. */
const PLAYBACK_TIMEOUT_MS = 35 * 1000;
const MAX_MESSAGE_LENGTH = 10000;

const MODEL = 'bluemagpie-q8_0';
const BASE_URL = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/v1$/;
const API_KEY = /^[0-9a-f]{64}$/;
/**
 * One request carries at most 80 Unicode scalars and 320 UTF-8 bytes. A scalar takes at most 4
 * bytes, so the scalar limit already implies the byte limit; both are checked to mirror the service.
 */
const MAX_SCALARS = 80;
const MAX_BYTES = 320;
/** A 44-byte WAV header plus 30 s of 48 kHz mono PCM16. */
const MAX_CLIP_BYTES = 44 + 30 * 48000 * 2;
/**
 * What counts as the user's gesture for the audio unlock. A touch only counts when it ends, so
 * `pointerup` as well as `pointerdown`, and a click from an accessibility service (TalkBack) comes
 * as a `click` alone.
 */
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'click'] as const;

/** The natural voice is off unless the user turned it on. */
export function naturalVoiceEnabled() {
  return getPreference(preferenceKey, 'off') === 'on';
}
export function setNaturalVoiceEnabled(enabled: boolean) {
  setPreference(preferenceKey, enabled ? 'on' : 'off');
}

// --- Bridge requests -------------------------------------------------------------------------

export type TtsBridgeName = 'tts_start' | 'tts_status' | 'tts_stop';
type TtsPhase = 'idle' | 'starting' | 'running' | 'error';
export type TtsReply = {
  requestId: string;
  phase: TtsPhase;
  running: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  error?: string;
};

const phases: readonly string[] = ['idle', 'starting', 'running', 'error'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const optionalString = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string';
const textOrUndefined = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * 'ignore' for anything that is not the reply to this request (another name or request ID, not JSON,
 * too long); 'malformed' for a reply to it with unexpected types.
 */
function parseReply(
  raw: unknown,
  name: TtsBridgeName,
  requestId: string,
): TtsReply | 'ignore' | 'malformed' {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_LENGTH) return 'ignore';
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return 'ignore';
  }
  if (!isRecord(message) || message.name !== name) return 'ignore';
  const data = message.data;
  if (!isRecord(data) || data.requestId !== requestId) return 'ignore';
  const { phase, running, baseUrl, apiKey, model, error } = data;
  if (typeof phase !== 'string' || !phases.includes(phase) || typeof running !== 'boolean')
    return 'malformed';
  if (![baseUrl, apiKey, model, error].every(optionalString)) return 'malformed';
  return {
    requestId,
    phase: phase as TtsPhase,
    running,
    baseUrl: textOrUndefined(baseUrl),
    apiKey: textOrUndefined(apiKey),
    model: textOrUndefined(model),
    error: textOrUndefined(error),
  };
}

/**
 * Sends `name` with a fresh request ID and resolves with the first reply that echoes it. Unlike the
 * other bridge messages, these replies arrive as `message` events on `window`, not on the
 * `flutterObject`. The app may never answer (no safe channel), so every request has a timeout.
 * Rejects with Error('TTS_BRIDGE_UNAVAILABLE'), Error('TTS_BRIDGE_TIMEOUT') or Error('TTS_BRIDGE_BAD_REPLY').
 */
export function requestTts(name: TtsBridgeName, timeoutMs: number): Promise<TtsReply> {
  return new Promise((resolve, reject) => {
    if (!hasNativeBridge() || typeof window.addEventListener !== 'function') {
      reject(new Error('TTS_BRIDGE_UNAVAILABLE'));
      return;
    }
    const requestId = newNativeRequestId();
    let settled = false;
    const finish = (error?: Error, reply?: TtsReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      if (error) reject(error);
      else resolve(reply!);
    };
    const receive = (event: { data?: unknown }) => {
      const parsed = parseReply(event?.data, name, requestId);
      if (parsed === 'ignore') return;
      if (parsed === 'malformed') finish(new Error('TTS_BRIDGE_BAD_REPLY'));
      else finish(undefined, parsed);
    };
    const timer = setTimeout(() => finish(new Error('TTS_BRIDGE_TIMEOUT')), timeoutMs);
    window.addEventListener('message', receive);
    if (!postNative(name, { requestId })) finish(new Error('TTS_BRIDGE_UNAVAILABLE'));
  });
}

// --- Service lifecycle -----------------------------------------------------------------------

type Endpoint = { baseUrl: string; apiKey: string; model: string };

/** The ready service. Held in memory only; only a successful `tts_start` hands out the key. */
let endpoint: Endpoint | undefined;
let preparing: Promise<boolean> | undefined;
/** Bumped by `releaseNaturalVoice`, so a start that was already under way cannot revive the key. */
let generation = 0;
/** Whether this page asked the app to start the service, and so has to ask it to stop. */
let serviceRequested = false;
let watchingPageHide = false;

function readyEndpoint(reply: TtsReply): Endpoint | undefined {
  const { running, phase, baseUrl, apiKey, model, error } = reply;
  if (!running || phase !== 'running' || error) return undefined;
  const port = baseUrl === undefined ? undefined : BASE_URL.exec(baseUrl)?.[1];
  if (port === undefined || Number(port) < 1 || Number(port) > 65535) return undefined;
  if (baseUrl === undefined || apiKey === undefined || !API_KEY.test(apiKey) || model !== MODEL)
    return undefined;
  return { baseUrl, apiKey, model };
}

/** Forgets the cached service after a failure, unless a newer one has already replaced it. */
function forgetEndpoint(failed: Endpoint) {
  if (endpoint === failed) endpoint = undefined;
}

/**
 * Starts the on-device service in the background and resolves with whether it is ready. Never
 * rejects. Concurrent calls share one start; a ready service is cached for later readings.
 */
export function prepareNaturalVoice(): Promise<boolean> {
  if (endpoint) return Promise.resolve(true);
  if (preparing) return preparing;
  if (!hasNativeBridge()) return Promise.resolve(false);
  armNaturalVoiceAudio();
  const started = generation;
  serviceRequested = true;
  watchPageHide();
  const attempt: Promise<boolean> = requestTts('tts_start', START_TIMEOUT_MS)
    .then(
      (reply) => {
        const ready = readyEndpoint(reply);
        if (!ready || started !== generation) return false;
        endpoint = ready;
        return true;
      },
      () => false,
    )
    .finally(() => {
      if (preparing === attempt) preparing = undefined;
    });
  preparing = attempt;
  return attempt;
}

/**
 * Stops reading and, best effort, the service itself (which frees ~2 GB of memory); forgets the key.
 * Used when the user turns the natural voice off and when the page goes away.
 */
export function releaseNaturalVoice() {
  generation += 1;
  preparing = undefined;
  endpoint = undefined;
  stopNaturalVoice();
  disarmNaturalVoiceAudio();
  if (!serviceRequested) return;
  serviceRequested = false;
  requestTts('tts_stop', CONTROL_TIMEOUT_MS).catch(() => {
    /* Best effort: the app also stops the service when its own page owner goes away. */
  });
}

function watchPageHide() {
  if (watchingPageHide || typeof window.addEventListener !== 'function') return;
  watchingPageHide = true;
  window.addEventListener('pagehide', releaseNaturalVoice);
}

// --- Segmentation ----------------------------------------------------------------------------

const LINE_BREAK = /[\r\n\u0085\u2028\u2029]+/;
/** `<` and `>` are rejected by the service, as are control characters and lone surrogates. */
const UNSAFE = /[<>\p{Cc}\p{Cs}]/gu;
/** Ends a sentence; closing quotes stay with it. A dot only counts when no digit follows (3.5). */
const SENTENCE_END = /(?:[。！？!?；;…⋯]+|\.+(?!\d))[」』）)”’】》〉"']*/gu;
const CLAUSE_END = /[，、,：:]+[」』）)”’】》〉"']*/gu;
/** A segment without a letter or digit has nothing to say. */
const SPEAKABLE = /[\p{L}\p{N}]/u;

function bytesOf(char: string) {
  const code = char.codePointAt(0)!;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}
function fits(text: string) {
  let scalars = 0;
  let bytes = 0;
  for (const char of text) {
    scalars += 1;
    bytes += bytesOf(char);
  }
  return scalars <= MAX_SCALARS && bytes <= MAX_BYTES;
}

/** Splits after every match of `boundary`; the pieces add up to the original text. */
function splitAfter(text: string, boundary: RegExp) {
  const pieces: string[] = [];
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].length;
    pieces.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

/** Last resort for text without punctuation: cuts at a space when there is one, else anywhere. */
function splitByLength(text: string) {
  const chars = Array.from(text);
  const pieces: string[] = [];
  while (chars.length) {
    // The longest run that fits.
    let count = 0;
    let bytes = 0;
    while (count < chars.length && count < MAX_SCALARS) {
      const next = bytesOf(chars[count]!);
      if (bytes + next > MAX_BYTES) break;
      bytes += next;
      count += 1;
    }
    let cut = count;
    // Unless it is the last run, prefer a space in its second half, so a word stays whole.
    if (count < chars.length)
      for (let i = count - 1; i > count / 2; i -= 1)
        if (chars[i] === ' ') {
          cut = i;
          break;
        }
    pieces.push(chars.splice(0, cut).join(''));
  }
  return pieces;
}

/** Pieces that each fit one request: sentences, else clauses, else runs of characters. */
function pieces(line: string) {
  return splitAfter(line, SENTENCE_END).flatMap((sentence) =>
    fits(sentence)
      ? [sentence]
      : splitAfter(sentence, CLAUSE_END).flatMap((clause) =>
          fits(clause) ? [clause] : splitByLength(clause),
        ),
  );
}

/**
 * Cuts text into segments of at most 80 Unicode scalars and 320 UTF-8 bytes, at sentence ends where
 * possible, then at commas. Line breaks always end a segment. `<`, `>`, control characters and lone
 * surrogates are removed; segments without a letter or digit are skipped.
 */
export function segmentText(text: string): string[] {
  const segments: string[] = [];
  for (const line of text.split(LINE_BREAK)) {
    let current = '';
    const flush = () => {
      const segment = current.trim();
      current = '';
      if (SPEAKABLE.test(segment)) segments.push(segment);
    };
    for (const piece of pieces(line.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim())) {
      if (current && !fits(current + piece)) flush();
      current += piece;
    }
    flush();
  }
  return segments;
}

// --- Audio element ---------------------------------------------------------------------------

/**
 * The one audio element every clip plays on. The app's WebView can require a user gesture before
 * audio starts, and a clip is only ready after a network round trip, long after the tap; an
 * automatic reading has no gesture at all. An element that a gesture has started once can be
 * started again later, so the first interaction unlocks this one (`armNaturalVoiceAudio`) and each
 * clip is played by swapping its `src`.
 */
let sharedAudio: HTMLAudioElement | undefined;
/**
 * Whoever uses the element right now: the reading whose clip plays, or an unlock attempt (which a
 * clip takes over). The unlock leaves the element alone while a reading has it.
 */
let audioOwner: object | undefined;
let audioUnlocked = false;
let unlockArmed = false;

function audioElement() {
  sharedAudio ??= new Audio();
  return sharedAudio;
}

/** Stops whatever the element plays and lets go of its media resource. */
function resetAudio(audio: HTMLAudioElement) {
  audio.onended = audio.onerror = null;
  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  } catch {
    /* Releasing the media resource is best effort. */
  }
}

/** 50 ms of silence (8 kHz, mono, 16 bit), built here so that no asset file is needed. */
function silentWav() {
  const samples = 400;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // Size of the format chunk.
  view.setUint16(20, 1, true); // PCM.
  view.setUint16(22, 1, true); // Mono.
  view.setUint32(24, 8000, true); // Sample rate.
  view.setUint32(28, 16000, true); // Bytes per second.
  view.setUint16(32, 2, true); // Bytes per sample frame.
  view.setUint16(34, 16, true); // Bits per sample.
  write(36, 'data');
  view.setUint32(40, samples * 2, true);
  // The samples stay zero: silence.
  return new Blob([bytes], { type: 'audio/wav' });
}

function markAudioUnlocked() {
  audioUnlocked = true;
  disarmNaturalVoiceAudio();
}

/**
 * Starts the shared element on a silent clip and pauses it again, which unlocks it for the real
 * clips. Leaves the element alone while a clip uses it (a playing clip shows that it may play). A
 * refused attempt keeps the listeners, so the next interaction tries again.
 */
function unlockAudio() {
  if (audioUnlocked || audioOwner) return;
  const owner = {};
  let audio: HTMLAudioElement | undefined;
  let url: string | undefined;
  const release = () => {
    if (url !== undefined) URL.revokeObjectURL(url);
    // A clip may have taken the element over meanwhile; it is theirs then.
    if (audio && audioOwner === owner) {
      audioOwner = undefined;
      resetAudio(audio);
    }
  };
  try {
    audio = audioElement();
    audioOwner = owner;
    url = URL.createObjectURL(silentWav());
    audio.src = url;
    Promise.resolve(audio.play()).then(() => {
      markAudioUnlocked();
      release();
    }, release);
  } catch {
    release();
  }
}

/**
 * Waits for the first interaction anywhere on the page and unlocks the shared audio element with
 * it. The listeners are in the capture phase, so no handler of the page can swallow the event.
 * Called when the natural voice is switched on or used; calling it again changes nothing.
 */
export function armNaturalVoiceAudio() {
  if (audioUnlocked || unlockArmed || !hasNativeBridge()) return;
  if (typeof window.addEventListener !== 'function') return;
  unlockArmed = true;
  for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlockAudio, true);
}

function disarmNaturalVoiceAudio() {
  if (!unlockArmed) return;
  unlockArmed = false;
  for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlockAudio, true);
}

// --- Reading ---------------------------------------------------------------------------------

type Reading = {
  /** Controllers of the syntheses under way, so a stop can abort them. */
  requests: Set<AbortController>;
  cancelPlayback?: () => void;
};

/** The one reading whose outcome still matters; a stopped or replaced reading stays silent. */
let current: Reading | undefined;
const isCurrent = (reading: Reading) => current === reading;

/** Stops the current reading, if any, without calling its callbacks. */
export function stopNaturalVoice() {
  const reading = current;
  current = undefined;
  if (!reading) return;
  for (const request of [...reading.requests]) request.abort();
  reading.cancelPlayback?.();
}

/** Ends the reading at most once and aborts whatever it still has under way. */
function settle(reading: Reading, callback: () => void) {
  if (!isCurrent(reading)) return;
  current = undefined;
  for (const request of [...reading.requests]) request.abort();
  callback();
}

function validClip(clip: Blob) {
  const type = clip.type.split(';')[0]!.trim().toLowerCase();
  return type === 'audio/wav' && clip.size > 44 && clip.size <= MAX_CLIP_BYTES;
}

/** Synthesizes one segment. Rejects on any failure; an auth or network failure forgets the service. */
async function synthesize(reading: Reading, service: Endpoint, input: string): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  reading.requests.add(controller);
  let answered = false;
  try {
    const response = await fetch(`${service.baseUrl}/audio/speech`, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${service.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: service.model,
        input,
        voice: 'default',
        response_format: 'wav',
      }),
    });
    answered = true;
    // 401/403: the key is no longer valid. Busy (429) and other errors say nothing about the key.
    if (response.status === 401 || response.status === 403) forgetEndpoint(service);
    if (!response.ok) throw new Error('NATURAL_VOICE_REJECTED');
    const clip = await response.blob();
    if (!validClip(clip)) throw new Error('NATURAL_VOICE_BAD_AUDIO');
    return clip;
  } catch (error) {
    // Without an answer the service is unreachable or too slow (a stop is not a failure of it).
    if (!answered && isCurrent(reading)) forgetEndpoint(service);
    throw error;
  } finally {
    clearTimeout(timer);
    reading.requests.delete(controller);
  }
}

/**
 * Plays one clip to its end on the shared element. Always releases the object URL; rejects when
 * playback fails or is stopped.
 */
function play(reading: Reading, clip: Blob, rate: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(clip);
    let audio: HTMLAudioElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (reading.cancelPlayback === cancel) reading.cancelPlayback = undefined;
      if (audio) {
        audioOwner = undefined;
        resetAudio(audio);
      }
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => finish(new Error('NATURAL_VOICE_STOPPED'));
    reading.cancelPlayback = cancel;
    try {
      audio = audioElement();
      // Takes the element over from an unlock attempt that is still under way.
      audioOwner = reading;
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error('NATURAL_VOICE_PLAYBACK_FAILED'));
      audio.src = url;
      // The speed setting is relative to the voice's own pace, like `rate` of the system voice.
      const speed = Number.isFinite(rate) && rate > 0 ? Math.min(Math.max(rate, 0.5), 2) : 1;
      audio.defaultPlaybackRate = speed;
      audio.playbackRate = speed;
      timer = setTimeout(
        () => finish(new Error('NATURAL_VOICE_PLAYBACK_TIMEOUT')),
        PLAYBACK_TIMEOUT_MS,
      );
      // A clip that plays shows that the element may play. Autoplay can be refused; the rejection
      // is the failure.
      Promise.resolve(audio.play()).then(markAudioUnlocked, () =>
        finish(new Error('NATURAL_VOICE_PLAYBACK_BLOCKED')),
      );
    } catch {
      finish(new Error('NATURAL_VOICE_PLAYBACK_FAILED'));
    }
  });
}

async function run(
  reading: Reading,
  service: Endpoint,
  segments: string[],
  rate: number,
  finished: () => void,
  fallback: (rest: string) => void,
) {
  let index = 0;
  try {
    let upcoming = synthesize(reading, service, segments[0]!);
    for (; index < segments.length; index += 1) {
      const clip = await upcoming;
      // Stopped while the clip arrived: it must not start playing, nor the next one be synthesized.
      if (!isCurrent(reading)) return;
      const following = segments[index + 1];
      if (following !== undefined) {
        // The next segment is synthesized while this one plays, to avoid a pause between them.
        upcoming = synthesize(reading, service, following);
        upcoming.catch(() => {
          /* Reported when its turn comes. */
        });
      }
      await play(reading, clip, rate);
    }
  } catch {
    // The failed segment and everything after it go to the system voice.
    settle(reading, () => fallback(segments.slice(index).join(' ')));
    return;
  }
  settle(reading, finished);
}

/**
 * Reads `text` with the natural voice. Returns false, without having done anything to the text, when
 * the caller should use the system voice instead: the preference is off, there is nothing to say, or
 * the service is not ready (it is then prepared in the background for the next reading).
 *
 * Otherwise the reading starts and ends in exactly one of three ways: `finished()` after the last
 * segment, `fallback(rest)` with the text that was not spoken when any segment fails, or silence when
 * it is stopped or replaced.
 */
export function speakNaturalVoice(
  text: string,
  rate: number,
  finished: () => void,
  fallback: (rest: string) => void,
): boolean {
  if (!naturalVoiceEnabled()) return false;
  if (!endpoint) {
    void prepareNaturalVoice();
    return false;
  }
  const segments = segmentText(text);
  if (!segments.length) return false;
  stopNaturalVoice();
  const reading: Reading = { requests: new Set() };
  current = reading;
  run(reading, endpoint, segments, rate, finished, fallback).catch(() => {
    /* A throwing callback must not become an unhandled rejection. */
  });
  return true;
}

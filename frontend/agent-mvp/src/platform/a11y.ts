import { reactive } from 'vue';
import { mountAnnouncer } from './announcer';
import { hasNativeBridge, requestNative, type NativeData } from './native-bridge';

export type A11yState = {
  /** null means unknown (a browser, or the app could not tell). */
  screenReader: boolean | null;
  boldText: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  invertColors: boolean;
  textScale: number;
};

const defaults = (): A11yState => ({
  screenReader: null,
  boldText: false,
  highContrast: false,
  reduceMotion: false,
  invertColors: false,
  textScale: 1,
});

/**
 * The device's accessibility settings. `screenReader` is disability information: keep it in memory
 * only. Never persist, log or send it anywhere.
 */
export const a11yState: A11yState = reactive(defaults());

function mediaMatches(query: string) {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.(query).matches === true;
  } catch {
    return false;
  }
}

/** What the browser alone can tell. */
function browserState(): A11yState {
  return {
    ...defaults(),
    reduceMotion: mediaMatches('(prefers-reduced-motion: reduce)'),
    highContrast: mediaMatches('(prefers-contrast: more)'),
  };
}

/** Keeps only the fields of an `a11y_state` reply that have the expected type. */
function validNativeFields(reply: NativeData): Partial<A11yState> {
  const { screenReader, boldText, highContrast, reduceMotion, invertColors, textScale } = reply;
  const valid: Partial<A11yState> = {};
  if (screenReader === null || typeof screenReader === 'boolean') valid.screenReader = screenReader;
  if (typeof boldText === 'boolean') valid.boldText = boldText;
  if (typeof highContrast === 'boolean') valid.highContrast = highContrast;
  if (typeof reduceMotion === 'boolean') valid.reduceMotion = reduceMotion;
  if (typeof invertColors === 'boolean') valid.invertColors = invertColors;
  if (typeof textScale === 'number' && Number.isFinite(textScale) && textScale > 0)
    valid.textScale = textScale;
  return valid;
}

let latestLoad = 0;

/**
 * Reads the settings into `a11yState` and returns a copy. In the app the native `a11y_state` reply
 * wins field by field; anything missing, invalid or unavailable falls back to the browser media
 * queries (and `screenReader` to null). A load that was overtaken by a newer one does not overwrite it.
 */
export async function loadA11yState(): Promise<A11yState> {
  const load = ++latestLoad;
  let next = browserState();
  if (hasNativeBridge()) {
    try {
      const reply = await requestNative('a11y_state', {}, { timeoutMs: 1500 });
      next = { ...next, ...validNativeFields(reply) };
    } catch {
      /* Keep the browser fallback. */
    }
  }
  if (load === latestLoad) Object.assign(a11yState, next);
  return { ...a11yState };
}

function setFlag(
  root: Pick<Element, 'setAttribute' | 'removeAttribute'>,
  name: string,
  value: string | false,
) {
  if (value === false) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

/** Mirrors the settings onto `<html>` for src/a11y.css: motion, bold text and contrast. */
export function applyA11yState(
  state: A11yState,
  root: Pick<Element, 'setAttribute' | 'removeAttribute'> = document.documentElement,
): void {
  setFlag(root, 'data-a11y-motion', state.reduceMotion && 'reduce');
  setFlag(root, 'data-a11y-bold', state.boldText && 'true');
  setFlag(root, 'data-a11y-contrast', state.highContrast && 'true');
}

async function refresh() {
  try {
    applyA11yState(await loadA11yState());
  } catch {
    /* Accessibility enhancements must never break the app. */
  }
}

let started = false;

/**
 * Call once at startup, without awaiting: mounts the announcer, applies the settings, and reloads
 * them when the page becomes visible again (users often return from the system settings).
 * Fails silently; the returned promise never rejects.
 */
export function initAccessibility(): Promise<void> {
  if (started) return Promise.resolve();
  started = true;
  try {
    mountAnnouncer();
  } catch {
    /* Announcements are optional. */
  }
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refresh();
    });
  } catch {
    /* No document to watch. */
  }
  return refresh();
}

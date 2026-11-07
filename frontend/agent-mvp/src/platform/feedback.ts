import { a11yState } from './a11y';
import { announce } from './announcer';
import { haptic, type HapticType } from './haptics';
import { readAloud } from './speech';
import { getPreference, setPreference } from './storage';

export type FeedbackKind = 'success' | 'warning' | 'error' | 'info' | 'selection';

const voicePreferenceKey = 'tp-voice-feedback';

const hapticFor: Partial<Record<FeedbackKind, HapticType>> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  selection: 'selection',
};

/** Spoken feedback is opt-in: off unless the user turned it on. */
export function voiceFeedbackEnabled() {
  return getPreference(voicePreferenceKey, 'off') === 'on';
}
export function setVoiceFeedbackEnabled(enabled: boolean) {
  setPreference(voicePreferenceKey, enabled ? 'on' : 'off');
}

function attempt(step: () => void) {
  try {
    step();
  } catch {
    /* Feedback is best effort; one failing channel must not stop the others. */
  }
}

/**
 * The single entry point for multi-sensory feedback. Text stays the primary channel (the caller
 * still shows the message); the screen reader announcement, haptics and voice are optional extras.
 * Never throws.
 */
export function feedback(kind: FeedbackKind, message?: string): void {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text) attempt(() => announce(text, { assertive: kind === 'error' }));
  const type = hapticFor[kind];
  if (type) attempt(() => haptic(type));
  // A screen reader user already hears the announcement; speaking too would talk over it.
  if (text && voiceFeedbackEnabled() && a11yState.screenReader !== true)
    attempt(() =>
      readAloud(
        text,
        document.documentElement.lang.startsWith('en') ? 'en' : 'zh-Hant-TW',
        1,
        () => {},
        () => {},
      ),
    );
}

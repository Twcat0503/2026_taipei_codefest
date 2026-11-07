import { hasNativeBridge, postNative } from './native-bridge';
import { getPreference, setPreference } from './storage';

export type HapticType =
  'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const preferenceKey = 'tp-haptics';

/** `navigator.vibrate` patterns (ms) used in a plain browser; the app maps the type natively. */
const vibrationPatterns: Record<HapticType, number[]> = {
  selection: [10],
  light: [15],
  medium: [25],
  heavy: [40],
  success: [30, 60, 30],
  warning: [60, 80, 60],
  error: [80, 60, 80, 60, 80],
};

/** Haptics are on unless the user turned them off. */
export function hapticsEnabled() {
  return getPreference(preferenceKey, 'on') !== 'off';
}
export function setHapticsEnabled(enabled: boolean) {
  setPreference(preferenceKey, enabled ? 'on' : 'off');
}

/** Best-effort tactile feedback. Never throws; text feedback remains the primary channel. */
export function haptic(type: HapticType): void {
  try {
    if (!hapticsEnabled() || !Object.hasOwn(vibrationPatterns, type)) return;
    if (hasNativeBridge()) postNative('haptic', { type });
    else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
      navigator.vibrate(vibrationPatterns[type]);
  } catch {
    /* Haptics are optional; a failure must never reach the caller. */
  }
}

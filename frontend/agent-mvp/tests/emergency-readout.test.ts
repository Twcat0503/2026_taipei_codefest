import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_KINDS,
  EMERGENCY_NUMBERS,
  emergencyReadout,
  isEmergencyKind,
} from '../src/agent/skills/emergency';
import { messages } from '../src/i18n';

describe('emergency readout', () => {
  it('reads what the card shows: the advice, every call button and the dialer note', () => {
    const t = messages['zh-Hant-TW'];
    expect(emergencyReadout('violence', t)).toBe(
      [t.emergencyViolence, t.call110, t.call113, t.emergencyNote].join('。'),
    );
  });

  it.each(EMERGENCY_KINDS)('names every number for %s in both languages', (kind) => {
    for (const locale of ['zh-Hant-TW', 'en'] as const) {
      const text = emergencyReadout(kind, messages[locale]);
      for (const number of EMERGENCY_NUMBERS[kind]) expect(text).toContain(number);
      expect(text).toContain(messages[locale].emergencyNote);
    }
  });

  it('accepts only known kinds', () => {
    expect(isEmergencyKind('medical')).toBe(true);
    expect(isEmergencyKind('nonsense')).toBe(false);
    expect(isEmergencyKind(null)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { formatWaterNumber, normalizeWaterNumber } from '../src/platform/profile';
import { maskIdNo } from '../src/platform/member';
import { PREFILL_SLOTS } from '../src/agent/prefill';

describe('details filled in for people', () => {
  it('accepts a 10-digit water account number written with or without dashes', () => {
    expect(normalizeWaterNumber('1-23-456789-0')).toBe('1234567890');
    expect(normalizeWaterNumber(' 1234567890 ')).toBe('1234567890');
    expect(normalizeWaterNumber('123456789')).toBeNull();
    expect(normalizeWaterNumber('12345678901')).toBeNull();
    expect(normalizeWaterNumber('1-23-45678a-0')).toBeNull();
    expect(formatWaterNumber('1234567890')).toBe('1-23-456789-0');
  });

  it('never shows a full ID number', () => {
    expect(maskIdNo('A123456789')).toBe('A12****789');
  });

  it('only fills fields the app also allows', () => {
    // Must match kPrefillFields in lib/util/tp_prefill.dart.
    const allowed = new Set(['water_number', 'tax_id', 'title', 'description', 'location']);
    for (const slots of Object.values(PREFILL_SLOTS))
      for (const slot of slots) expect(allowed.has(slot.field)).toBe(true);
  });
});

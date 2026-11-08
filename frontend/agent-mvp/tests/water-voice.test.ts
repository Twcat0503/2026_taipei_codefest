import { describe, expect, it } from 'vitest';
import { waterNumberFromSpeech } from '../src/platform/water-voice';

describe('water number voice input', () => {
  it('converts individually spoken Chinese, English and Arabic digits', () => {
    expect(waterNumberFromSpeech('我的水號是 一二三四五六七八九零')).toBe('1234567890');
    expect(waterNumberFromSpeech('one two three four five six seven eight nine zero')).toBe(
      '1234567890',
    );
    expect(waterNumberFromSpeech('１２３ ４５６ ７８９０')).toBe('1234567890');
  });
  it('rejects incomplete and ambiguous speech instead of guessing', () => {
    expect(waterNumberFromSpeech('一二三四')).toBeNull();
    expect(waterNumberFromSpeech('一百二十三四五六七八九')).toBeNull();
    expect(waterNumberFromSpeech('1234567890，最後一碼改成一')).toBeNull();
  });
});

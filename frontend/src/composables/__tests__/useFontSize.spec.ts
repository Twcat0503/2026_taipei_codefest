import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FONT_SIZE_STORAGE_KEY, initFontSize, useFontSize } from '../useFontSize';

describe('useFontSize', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.fontSize = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to 100% when nothing is stored', () => {
    initFontSize();
    expect(document.documentElement.style.fontSize).toBe('100%');
    expect(useFontSize().current.value).toBe('standard');
  });

  it('applies the level to <html> and saves it', () => {
    initFontSize();
    useFontSize().setFontSize('xlarge');
    expect(document.documentElement.style.fontSize).toBe('150%');
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe('xlarge');
  });

  it('offers a 200% level and at least three levels', () => {
    const { levels } = useFontSize();
    expect(levels.length).toBeGreaterThanOrEqual(3);
    expect(levels.map((l) => l.percent)).toContain(200);
  });

  it('restores the stored preference on next start', () => {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'large');
    initFontSize();
    expect(document.documentElement.style.fontSize).toBe('125%');
    expect(useFontSize().current.value).toBe('large');
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'huge');
    initFontSize();
    expect(document.documentElement.style.fontSize).toBe('100%');
  });

  it('still works when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => initFontSize()).not.toThrow();
    expect(() => useFontSize().setFontSize('large')).not.toThrow();
    expect(document.documentElement.style.fontSize).toBe('125%');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialGuidance } from '../../shared/guidance-preference';

beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
});
afterEach(() => vi.unstubAllGlobals());

describe('default voice guidance preference', () => {
  it('enables guidance for a new user', () => {
    expect(initialGuidance()).toEqual({ enabled: true, lang: 'zh-Hant-TW' });
  });
  it.each(['on', 'off'])('respects the saved choice %s', (choice) => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === 'tp-button-guidance' ? choice : 'en',
    );
    expect(initialGuidance()).toEqual({ enabled: choice === 'on', lang: 'en' });
  });
  it('uses the default when browser storage is unavailable', () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    expect(initialGuidance().enabled).toBe(true);
  });
  it('honors a native opt-out over a local browser preference', () => {
    vi.stubGlobal('window', { __tpButtonGuidance: { enabled: false, lang: 'en' } });
    vi.mocked(localStorage.getItem).mockReturnValue('on');
    expect(initialGuidance()).toEqual({ enabled: false, lang: 'en' });
    expect(localStorage.getItem).not.toHaveBeenCalled();
  });
});

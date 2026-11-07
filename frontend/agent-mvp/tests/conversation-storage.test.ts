import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearConversation, restoreConversation, saveConversation } from '../src/platform/storage';
import { messages } from '../src/i18n';

describe('conversation storage', () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  it('restores predefined requests and masked free text without sensitive data', () => {
    expect(
      saveConversation([
        { request: messages['zh-Hant-TW'].benefitsRequest, notice: 'results' },
        { request: '身分證 A123456789', notice: 'unsupported' },
        { request: '我的電話 0912-345-678，信箱 me@example.com', notice: 'unsupported' },
        { request: '水號 12345678 要繳費', notice: 'unsupported' },
      ]),
    ).toBe(true);
    const stored = [...values.values()].join('');
    for (const secret of ['A123456789', '0912-345-678', 'me@example.com', '12345678'])
      expect(stored).not.toContain(secret);
    expect(restoreConversation()).toEqual([
      { request: 'benefitsRequest', notice: 'results' },
      { request: null, text: '身分證 ＊＊＊', notice: 'unsupported' },
      { request: null, text: '我的電話 ＊＊＊，信箱 ＊＊＊', notice: 'unsupported' },
      { request: null, text: '水號 ＊＊＊ 要繳費', notice: 'unsupported' },
    ]);
    clearConversation();
    expect(restoreConversation()).toEqual([]);
  });
  it('masks identifiers again when restoring tampered data', () => {
    values.set(
      'townpass-agent-conversation-v1',
      JSON.stringify([{ request: null, text: 'B223456789', notice: 'unsupported' }]),
    );
    expect(restoreConversation()).toEqual([
      { request: null, text: '＊＊＊', notice: 'unsupported' },
    ]);
  });
  it('ignores malformed saved data', () => {
    values.set('townpass-agent-conversation-v1', '{bad');
    expect(restoreConversation()).toEqual([]);
  });
  it('keeps official navigation, emergency and profile summaries on reload', () => {
    const notices = ['navigate', 'navigationDeclined', 'emergency', 'profile'] as const;
    expect(saveConversation(notices.map((notice) => ({ request: '我家門口淹水了', notice })))).toBe(
      true,
    );
    expect(restoreConversation()).toEqual(
      notices.map((notice) => ({ request: null, text: '我家門口淹水了', notice })),
    );
  });
});

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
  it('restores predefined requests without storing free text or sensitive data', () => {
    expect(
      saveConversation([
        { request: messages['zh-Hant-TW'].benefitsRequest, notice: 'results' },
        { request: '身分證 A123456789', notice: 'unsupported' },
      ]),
    ).toBe(true);
    expect([...values.values()].join('')).not.toContain('A123456789');
    expect(restoreConversation()).toEqual([
      { request: 'benefitsRequest', notice: 'results' },
      { request: null, notice: 'unsupported' },
    ]);
    clearConversation();
    expect(restoreConversation()).toEqual([]);
  });
  it('ignores malformed saved data', () => {
    values.set('townpass-agent-conversation-v1', '{bad');
    expect(restoreConversation()).toEqual([]);
  });
});

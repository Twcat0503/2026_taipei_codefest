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
  it('keeps the emergency kind so the call buttons come back', () => {
    expect(
      saveConversation([
        { request: '有人昏倒了', notice: 'emergency', emergency: 'medical' },
        { request: messages['zh-Hant-TW'].benefitsRequest, notice: 'results', emergency: 'fire' },
      ]),
    ).toBe(true);
    expect(restoreConversation()).toEqual([
      { request: null, text: '有人昏倒了', notice: 'emergency', emergency: 'medical' },
      { request: 'benefitsRequest', notice: 'results' },
    ]);
  });
  it('falls back to every emergency line for older or tampered saves', () => {
    values.set(
      'townpass-agent-conversation-v1',
      JSON.stringify([
        { request: null, text: '救命', notice: 'emergency' },
        { request: null, text: '救命', notice: 'emergency', emergency: 'nonsense' },
      ]),
    );
    expect(restoreConversation().map((turn) => turn.emergency)).toEqual(['general', 'general']);
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
  it('restores public results and sources but never saves personal bill data', () => {
    const title = { 'zh-Hant-TW': '測試站', en: 'Test station' };
    const source = {
      kind: 'live' as const,
      label: '公開資料',
      note: '即時',
      url: 'https://example.org/',
      total: 1,
      truncated: false,
    };
    const time = Date.now() - 1000;
    expect(
      saveConversation([
        {
          request: '附近的 YouBike',
          notice: 'results',
          lastTool: 'find_nearby_youbike',
          records: [{ id: 'station', title, fields: [{ label: title, value: title }] }],
          source,
          time,
        },
        {
          request: '我的帳單',
          notice: 'bills',
          lastTool: 'list_bills',
          records: [{ id: 'secret', title }],
        },
      ]),
    ).toBe(true);
    const restored = restoreConversation();
    expect(restored[0]?.results).toMatchObject({
      tool: 'find_nearby_youbike',
      time,
      source,
      records: [{ id: 'station', title }],
    });
    expect(restored[1]?.results).toBeUndefined();
    expect([...values.values()].join('')).not.toContain('secret');
  });
  it('rejects unsafe or unrecognized saved search results', () => {
    values.set(
      'townpass-agent-conversation-v1',
      JSON.stringify([
        {
          notice: 'results',
          results: {
            tool: 'find_nearby_youbike',
            time: Date.now(),
            books: [],
            records: [
              { id: 'x', title: { 'zh-Hant-TW': '站', en: 'Station' }, url: 'javascript:alert(1)' },
            ],
            source: null,
          },
        },
      ]),
    );
    expect(restoreConversation()[0]?.results).toBeUndefined();
  });
  it('keeps official navigation, emergency and profile summaries on reload', () => {
    const notices = ['navigate', 'navigationDeclined', 'emergency', 'profile'] as const;
    expect(saveConversation(notices.map((notice) => ({ request: '我家門口淹水了', notice })))).toBe(
      true,
    );
    expect(restoreConversation()).toEqual(
      notices.map((notice) => ({
        request: null,
        text: '我家門口淹水了',
        notice,
        // Saved without a kind: the call buttons come back with every main line.
        ...(notice === 'emergency' ? { emergency: 'general' } : {}),
      })),
    );
  });
});

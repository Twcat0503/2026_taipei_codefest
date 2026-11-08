import { describe, expect, it } from 'vitest';
import { parkingPresentation, parkingReadout } from '../src/agent/parking-presentation';
import type { ToolRecord } from '../src/agent/types';

const text = (value: string) => ({ 'zh-Hant-TW': value, en: value });
const lot: ToolRecord = {
  id: 'parking-test',
  title: text('測試停車場'),
  description: text('很長的費率說明，僅供測試。'),
  fields: Object.entries({
    距離: '56 公尺',
    地址: '測試路一號',
    身障車位: '2 格',
    孕婦優先車位: '3 格',
    電話: '02-1234-5678',
    總車位: '100',
    營業時間: '測試營業時間',
  }).map(([label, value]) => ({ label: text(label), value: text(value) })),
};

describe('concise parking results', () => {
  it('highlights only the requested space type while retaining other data in details', () => {
    const view = parkingPresentation(lot, 'disabled', 'zh-Hant-TW');
    expect(view.summary).toBe('56 公尺 · 身障 2 格');
    expect(view.address).toBe('測試路一號');
    expect(view.details.map((field) => field.label['zh-Hant-TW'])).toEqual([
      '孕婦優先車位',
      '電話',
      '總車位',
      '營業時間',
    ]);
    expect(parkingPresentation(lot, 'pregnancy', 'zh-Hant-TW').summary).toBe('56 公尺 · 孕婦 3 格');
  });

  it('reads only the first match and its essentials, with the non-live warning', () => {
    const result = parkingReadout(
      [lot, { ...lot, id: 'second', title: text('第二處') }],
      'disabled',
      'zh-Hant-TW',
      true,
    );
    expect(result).toBe('最近是測試停車場，直線距離 56 公尺，身障 2 格，車位數非即時空位。');
    for (const omitted of ['第二處', '費率', '測試路', '02-1234', '孕婦', '100', '營業時間'])
      expect(result).not.toContain(omitted);
    expect(result.match(/。/gu)).toHaveLength(1);
  });

  it('does not call a district result nearest or invent a missing distance or count', () => {
    expect(parkingReadout([lot], 'pregnancy', 'zh-Hant-TW', false)).toMatch(/^第一處是/);
    const sparse = { ...lot, fields: undefined };
    expect(parkingPresentation(sparse, null, 'zh-Hant-TW').summary).toBe('');
    expect(parkingReadout([sparse], 'disabled', 'zh-Hant-TW', true)).toBe(
      '第一處是測試停車場，車位數非即時空位。',
    );
    expect(parkingReadout([], 'disabled', 'zh-Hant-TW', true)).toBe('');
  });

  it('keeps English output short and preserves both counts for an unfiltered search', () => {
    expect(parkingPresentation(lot, null, 'en').summary).toBe(
      '56 m · Disabled spaces: 2 · Pregnancy spaces: 3',
    );
    expect(parkingReadout([lot], 'pregnancy', 'en', false)).toBe(
      'The first is 測試停車場, straight-line distance 56 m, Pregnancy spaces: 3; counts are not live availability.',
    );
  });
});

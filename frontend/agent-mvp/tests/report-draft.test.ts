import { describe, expect, it } from 'vitest';
import { draftReport } from '../src/agent/skills/report-draft';

describe('citizen report drafts from what people said', () => {
  it.each([
    [
      '路燈壞了我要陳情',
      { title: '路燈故障', description: '路燈壞了', location: '', district: '' },
      ['路燈不亮或損壞', '工務局公園路燈工程管理處'],
    ],
    [
      '大安區和平東路二段100號前的路燈不亮好幾天了',
      {
        title: '路燈故障',
        description: '大安區和平東路二段100號前的路燈不亮好幾天了',
        location: '大安區和平東路二段100號前',
        district: '大安區',
      },
      ['路燈不亮或損壞', '工務局公園路燈工程管理處'],
    ],
    [
      '我要反映公車司機態度很差，307公車在捷運忠孝復興站附近',
      {
        title: '公車服務問題',
        description: '公車司機態度很差，307公車在捷運忠孝復興站附近',
        location: '捷運忠孝復興站附近',
        district: '',
      },
      ['公車問題', '公共運輸處'],
    ],
    [
      '我家巷口一直有人違停，在信義區松仁路',
      {
        title: '違規停車',
        description: '我家巷口一直有人違停，在信義區松仁路',
        location: '信義區松仁路',
        district: '信義區',
      },
      ['違規停車', '停車管理工程處'],
    ],
    [
      '我想反映一件事情就是晚上鄰居很吵',
      { title: '噪音問題', description: '晚上鄰居很吵', location: '', district: '' },
      ['場所及設施噪音舉發', '環境保護局'],
    ],
    [
      '路登壞了',
      { title: '路燈故障', description: '路燈壞了', location: '', district: '' },
      ['路燈不亮或損壞', '工務局公園路燈工程管理處'],
    ],
  ])('%s', (text, fields, [sub, agency]) => {
    const d = draftReport(text);
    expect({
      title: d.title,
      description: d.description,
      location: d.location,
      district: d.district,
    }).toEqual(fields);
    expect(d.category?.sub).toBe(sub);
    expect(d.category?.agency).toBe(agency);
  });

  it('maps the matched category to a real petition main category', () => {
    expect(draftReport('大安區路燈不亮').category?.main['zh-Hant-TW']).toBe(
      '道路、山坡地、路樹及路燈',
    );
  });

  it('leaves the category empty when nothing clean matches, so the form auto-selects it', () => {
    const d = draftReport('我要反映無障礙電梯壞了');
    expect(d.title).toBe('無障礙設施問題');
    expect(d.category).toBeNull();
  });

  it('uses the first clause as the subject when no known problem matches', () => {
    expect(draftReport('我要陳情：圖書館冷氣太冷了，可以調高一點嗎').title).toBe(
      '圖書館冷氣太冷了',
    );
  });

  it('never invents a location', () => {
    expect(draftReport('垃圾車都不準時').location).toBe('');
  });
});

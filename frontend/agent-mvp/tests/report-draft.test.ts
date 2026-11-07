import { describe, expect, it } from 'vitest';
import { draftReport } from '../src/agent/skills/report-draft';

describe('citizen report drafts from what people said', () => {
  it.each([
    ['路燈壞了我要陳情', { title: '路燈故障', description: '路燈壞了', location: '' }],
    [
      '大安區和平東路二段100號前的路燈不亮好幾天了',
      {
        title: '路燈故障',
        description: '大安區和平東路二段100號前的路燈不亮好幾天了',
        location: '大安區和平東路二段100號前',
      },
    ],
    [
      '我要反映公車司機態度很差，307公車在捷運忠孝復興站附近',
      {
        title: '公車服務問題',
        description: '公車司機態度很差，307公車在捷運忠孝復興站附近',
        location: '捷運忠孝復興站附近',
      },
    ],
    [
      '我家巷口一直有人違停，在信義區松仁路',
      {
        title: '違規停車',
        description: '我家巷口一直有人違停，在信義區松仁路',
        location: '信義區松仁路',
      },
    ],
    [
      '我想反映一件事情就是晚上鄰居很吵',
      { title: '噪音問題', description: '晚上鄰居很吵', location: '' },
    ],
    ['路登壞了', { title: '路燈故障', description: '路燈壞了', location: '' }],
  ])('%s', (text, draft) => expect(draftReport(text)).toEqual(draft));

  it('uses the first clause as the subject when no known problem matches', () => {
    expect(draftReport('我要陳情：圖書館冷氣太冷了，可以調高一點嗎').title).toBe(
      '圖書館冷氣太冷了',
    );
  });

  it('never invents a location', () => {
    expect(draftReport('垃圾車都不準時').location).toBe('');
  });
});

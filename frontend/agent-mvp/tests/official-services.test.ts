import { describe, expect, it, vi } from 'vitest';
import { createAgentToolClient } from '../../../tools/townpass/src/agent-client';
import { AgentRunner } from '../src/agent/runner';
import { DemoModel } from '../src/agent/model';
import { catalogKeyword, destinationFor } from '../src/agent/skills/navigation';
import { initialState, type ModelAdapter } from '../src/agent/types';

/** App default: only real data and official destinations, never the demo-site fixtures. */
const realClient = (fetchFn?: typeof fetch) =>
  createAgentToolClient({ includeDemo: false, getLocation: async () => null, fetchFn });

const scripted = (...replies: Awaited<ReturnType<ModelAdapter['complete']>>[]) => {
  const complete = vi.fn<ModelAdapter['complete']>();
  for (const reply of replies) complete.mockResolvedValueOnce(reply);
  return { mode: 'local' as const, complete };
};
const route = (domain: string) => ({
  calls: [{ id: 'r', name: 'select_agent', arguments: { domain } }],
});

describe('official destinations in real mode', () => {
  it.each([
    ['路燈壞了我要陳情', 'petition', 'https://1999.gov.taipei/'],
    ['我想申請身障補助', 'services_disabled', 'classificationCode=Disabled'],
    ['我要繳水費', 'pay', 'https://pay.taipei/'],
    ['我懷孕了可以申請什麼', 'services_maternity', 'classificationCode=Maternity'],
    ['我想打 1999', 'call_1999', 'tel:1999'],
  ])('%s → %s, shown for confirmation and never opened', async (request, id, url) => {
    const state = initialState();
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await new AgentRunner(new DemoModel(), state, realClient()).run(request);
    expect(state.notice).toBe('navigate');
    expect(state.navigation?.id).toBe(id);
    expect(state.navigation?.url).toContain(url);
    expect(state.records).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('skips the second inference when the wording already names the destination', async () => {
    const model = scripted(route('services'));
    const state = initialState();
    await new AgentRunner(model, state, realClient()).run('路燈壞了我要陳情');
    expect(model.complete).toHaveBeenCalledOnce();
    expect(state.navigation?.id).toBe('petition');
  });

  it('overrides a wrong destination from the model with explicit wording', async () => {
    const model = scripted(route('services'), {
      calls: [{ id: 'c', name: 'open_official_service', arguments: { destination: 'pay' } }],
    });
    const state = initialState();
    // "書" makes library_catalog the rule, which still asks the model for a keyword.
    await new AgentRunner(model, state, realClient()).run('我想借書');
    expect(state.navigation?.id).toBe('library_catalog');
    expect(state.traces.some((t) => t.event === 'corrected')).toBe(true);
  });

  it('keeps only a catalog keyword the user actually said', async () => {
    const run = async (request: string, keyword: string) => {
      const model = scripted(route('library'), {
        calls: [
          {
            id: 'c',
            name: 'open_official_service',
            arguments: { destination: 'library_catalog', keyword },
          },
        ],
      });
      const state = initialState();
      await new AgentRunner(model, state, realClient()).run(request);
      return state.navigation?.url;
    };
    expect(await run('幫我找跟貓有關的書', '貓')).toBe(
      'https://book.tpml.edu.tw/search?searchField=FullText&searchInput=%E8%B2%93',
    );
    // A script-converted keyword is not what the user typed: open the catalog home instead.
    expect(await run('熱門的書有哪些', '熱門的书')).toBe('https://book.tpml.edu.tw/');
  });

  it('sends personal bill questions to the official payment platform, not demo bills', async () => {
    const state = initialState();
    await new AgentRunner(new DemoModel(), state, realClient()).run(
      '我想看到我這期的帳單與繳費狀態',
    );
    expect(state.billResult).toBeNull();
    expect(state.pendingBillCategory).toBe(false);
    expect(state.navigation?.id).toBe('pay');
  });

  it('says it is unsupported instead of showing demo perks or a random site', async () => {
    for (const request of ['有什麼優惠票券？', '今天天氣如何']) {
      const state = initialState();
      await new AgentRunner(new DemoModel(), state, realClient()).run(request);
      expect(state.notice).toBe('unsupported');
      expect(state.navigation).toBeNull();
      expect(state.records).toEqual([]);
    }
  });

  it('routes a counter question that a model labelled as bills back to services', async () => {
    const model = scripted(route('bills'));
    const state = initialState();
    await new AgentRunner(model, state, realClient()).run('查詢臨櫃叫號');
    expect(state.domain).toBe('services');
    expect(state.billResult).toBeNull();
  });
});

describe('navigation rules', () => {
  it('picks destinations from explicit wording', () => {
    expect(destinationFor('附近的路燈不亮想反映')).toBe('petition');
    expect(destinationFor('長輩可以申請什麼補助')).toBe('services_elderly');
    expect(destinationFor('今天天氣如何')).toBeNull();
  });
  it('keeps inner words of titles and quoted titles', () => {
    expect(catalogKeyword('我想找「小王子的冒險」', 'x')).toBe('小王子的冒險');
    expect(catalogKeyword('找小王子的冒險這本書', '小王子的冒險')).toBe('小王子的冒險');
    expect(catalogKeyword('找書', 'https://evil.example')).toBeUndefined();
  });
});

it('filters parking to lots with disabled or pregnancy spaces from the official feed', async () => {
  const feed = {
    data: {
      UPDATETIME: 'Mon Oct 19 10:26:00 CST 2026',
      park: [
        { id: 'a', Handicap_First: '3', Pregnancy_First: '0' },
        { id: 'b', Handicap_First: '0', Pregnancy_First: '0' },
      ].map((p, i) => ({
        ...p,
        area: '信義區',
        name: `停車場${i}`,
        summary: '',
        address: '信義路',
        tel: '',
        payex: '30元/時',
        serviceTime: '',
        tw97x: '306723.6875',
        tw97y: '2769942.25',
        totalcar: 10,
        totalmotor: 0,
      })),
    },
  };
  const fetchFn = vi.fn(
    async () =>
      new Response(JSON.stringify(feed), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
  ) as unknown as typeof fetch;
  const state = initialState();
  await new AgentRunner(new DemoModel(), state, realClient(fetchFn)).run(
    '信義區有身障車位的停車場',
  );
  expect(state.records.map((r) => r.title['zh-Hant-TW'])).toEqual(['停車場0']);
  expect(state.source?.note).toContain('2026-10-19');
  expect(state.source?.note).toContain('不是即時空位');
});

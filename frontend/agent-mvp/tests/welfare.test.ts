import { describe, expect, it, vi } from 'vitest';
import { welfareFor, welfareReadout } from '../src/agent/skills/welfare';
import { welfareGuides, WELFARE_SOURCES, welfareTopics, welfareSections } from '../src/agent/open-data/welfare';
import { AgentRunner } from '../src/agent/runner';
import { initialState, type ModelAdapter } from '../src/agent/types';
import type { ToolClient } from '../src/agent/tool-client';

describe('verified benefits and rehab guidance', () => {
  it.each([
    ['我想申請身障補助', 'overview', 'overview'],
    ['我想知道有哪些補助', 'overview', 'overview'],
    ['What benefits are available?', 'overview', 'overview'],
    ['身障生活補助要準備什麼文件', 'living', 'documents'],
    ['生活補助可以領多少', 'living', 'cost'],
    ['輔具補助怎麼申請', 'aids', 'steps'],
    ['我想預約復康巴士', 'rehab', 'steps'],
    ['復康巴士資格', 'rehab', 'eligibility'],
  ])('%s produces in-page information', (request, topic, section) => {
    expect(welfareFor(request)).toEqual({ topic, section });
  });
  it('supports a short follow-up but does not hijack a new task or another city', () => {
    const previous = { topic: 'aids', section: 'steps' } as const;
    expect(welfareFor('那需要哪些文件', previous)).toEqual({ topic: 'aids', section: 'documents' });
    for (const request of ['附近的身障停車場', '我想申請孕婦補助', '長輩可以申請什麼補助', '生活補助案件進度', '新北輔具補助', '我要繳水費', '幫我寫一首詩'])
      expect(welfareFor(request, previous)).toBeNull();
  });
  it('answers supported questions and follow-ups without a model, tool call or external navigation', async () => {
    const model: ModelAdapter = { mode: 'phone', complete: vi.fn(async () => { throw new Error('PHONE_NOT_READY'); }) };
    const tools = { listTools: vi.fn(), callTool: vi.fn() } as unknown as ToolClient;
    const state = initialState();
    const runner = new AgentRunner(model, state, tools);
    await runner.run('身障生活補助要準備什麼');
    expect(state.welfare).toEqual({ topic: 'living', section: 'documents' });
    expect(state.notice).toBe('results');
    expect(state.navigation).toBeNull();
    await runner.run('那可以領多少');
    expect(state.welfare).toEqual({ topic: 'living', section: 'cost' });
    expect(model.complete).not.toHaveBeenCalled();
    expect(tools.listTools).not.toHaveBeenCalled();
    expect(tools.callTool).not.toHaveBeenCalled();
    await runner.run('復康巴士失火了救命');
    expect(state.notice).toBe('emergency');
    expect(state.welfare).toBeNull();
  });
  it('has official sources for every guide and one-sentence Chinese speech instead of full lists', () => {
    for (const topic of welfareTopics) {
      expect(welfareGuides[topic].sources.length).toBeGreaterThan(0);
      for (const id of welfareGuides[topic].sources) {
        const source = WELFARE_SOURCES.find((item) => item.id === id)!;
        expect(new URL(source.url).hostname).toMatch(/(?:^|\.)gov\.taipei$/u);
      }
      for (const section of welfareSections) {
        const spoken = welfareReadout({ topic, section }, 'zh-Hant-TW');
        expect([...spoken].length).toBeLessThanOrEqual(45);
        expect(spoken.match(/。/gu)).toHaveLength(1);
        expect(spoken).not.toContain('https:');
      }
    }
  });
});

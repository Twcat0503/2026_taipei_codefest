import { describe, expect, it } from 'vitest';
import { createAgentToolClient } from '../../../tools/townpass/src/agent-client';
import { AgentRunner } from '../src/agent/runner';
import { DemoModel } from '../src/agent/model';
import { destinationFor } from '../src/agent/skills/navigation';
import { followUps } from '../src/agent/follow-ups';
import { initialState } from '../src/agent/types';

const realClient = () =>
  createAgentToolClient({ includeDemo: false, getLocation: async () => null });
const answer = async (request: string) => {
  const state = initialState();
  await new AgentRunner(new DemoModel(), state, realClient()).run(request).catch(() => {});
  return state;
};

describe('tap-to-answer choices', () => {
  it('asks for the district as a choice when location is unavailable', async () => {
    const state = await answer('附近的無障礙廁所');
    const choices = followUps(state)!;
    expect(choices.kind).toBe('choose');
    expect(choices.options).toHaveLength(12);
    expect(choices.options.map((o) => o.request)).toContain('大安區');
  });

  it('turns a district choice into the pending lookup', async () => {
    const state = initialState();
    const runner = new AgentRunner(new DemoModel(), state, realClient());
    await runner.run('附近的無障礙廁所').catch(() => {});
    await runner.run(followUps(state)!.options.find((o) => o.request === '大安區')!.request);
    expect(state.notice).toBe('results');
    expect(followUps(state)!.options.map((o) => o.request)).toContain('附近有身障車位的停車場');
  });

  it('asks which bill when the request only says pay', async () => {
    const state = await answer('我要繳費');
    expect(state.navigation?.id).toBe('fee');
    const choices = followUps(state)!;
    expect(choices.kind).toBe('choose');
    expect(choices.options.map((o) => o.request)).toContain('我要繳水費');
  });

  it('suggests next steps after an in-app service', async () => {
    const state = await answer('路燈壞了我要陳情');
    const choices = followUps(state)!;
    expect(choices.kind).toBe('next');
    expect(choices.options.map((o) => o.request)).toContain('我想打 1999');
  });

  it('offers nothing extra for unsupported answers (the start choices show instead)', async () => {
    expect(followUps(await answer('今天天氣如何'))).toBeNull();
  });

  it('only offers requests the agent can route to a destination or a place lookup', async () => {
    const requests = new Set<string>();
    const samples = [
      '我要繳費',
      '路燈壞了我要陳情',
      '查詢臨櫃叫號',
      '我想申請身障補助',
      '我懷孕了可以申請什麼',
      '長輩可以申請什麼補助',
      '有哪些服務？',
      '我想打 1999',
      '幫我找「神奇柑仔店」',
    ];
    for (const sample of samples)
      for (const o of followUps(await answer(sample))?.options ?? []) requests.add(o.request);
    for (const request of requests)
      expect(
        destinationFor(request) !== null || /附近|區$/.test(request),
        `unroutable choice: ${request}`,
      ).toBe(true);
  });
});

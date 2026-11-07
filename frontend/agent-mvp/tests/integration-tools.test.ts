import { describe, expect, it, vi } from 'vitest';
import { createAgentToolClient } from '../../../tools/townpass/src/agent-client';
import { AgentRunner } from '../src/agent/runner';
import { DemoModel } from '../src/agent/model';
import { withDemoBills, type ToolClient } from '../src/agent/tool-client';
import { billReadTool } from '../src/agent/skills/bills';
import { initialState } from '../src/agent/types';

const toilets = [
  {
    number: 'fixture',
    city: '大安區',
    name: '測試無障礙公廁',
    address: '測試地址',
    latitude: '25.03',
    longitude: '121.54',
    grade: '特優',
    type: '無障礙廁所',
  },
];
const makeClient = () => {
  const fetchFn = vi.fn(
    async () =>
      new Response(JSON.stringify(toilets), { headers: { 'Content-Type': 'application/json' } }),
  );
  const getLocation = vi.fn(async () => null);
  const client = withDemoBills(createAgentToolClient({ fetchFn, getLocation }), billReadTool);
  return { client, fetchFn, getLocation };
};
describe('integrated tools and bill harness', () => {
  it('retains a pending place request and fills its district without asking for location again', async () => {
    const { client, getLocation, fetchFn } = makeClient();
    const state = initialState();
    const runner = new AgentRunner(new DemoModel(), state, client);
    await expect(runner.run('附近的無障礙廁所')).rejects.toThrow();
    expect(state.notice).toBe('needLocation');
    expect(fetchFn).not.toHaveBeenCalled();
    await runner.run('大安區');
    expect(getLocation).toHaveBeenCalledOnce();
    expect(state.domain).toBe('places');
    expect(state.records[0]?.title['zh-Hant-TW']).toBe('測試無障礙公廁');
    expect(state.source?.kind).toBe('snapshot');
    expect(state.pendingLocation).toBeNull();
  });
  it('allows switching to bills while a place request is awaiting clarification', async () => {
    const { client } = makeClient();
    const state = initialState();
    const runner = new AgentRunner(new DemoModel(), state, client);
    await expect(runner.run('附近的無障礙廁所')).rejects.toThrow();
    await runner.run('我想看到我這期的帳單與繳費狀態');
    expect(state.notice).toBe('billCategory');
    expect(state.pendingLocation).toBeNull();
    await runner.chooseBillCategory('water');
    expect(state.billResult?.records).toHaveLength(2);
    expect(state.billResult?.source).toBe('demo');
    expect(state.records).toEqual([]);
  });
  it('discovers the 16 teammate tools and bill fixture without replacing tools', async () => {
    const { client } = makeClient();
    const { tools } = await client.listTools({ signal: new AbortController().signal });
    expect(tools).toHaveLength(17);
    expect(new Set(tools.map((t) => t.name)).size).toBe(17);
  });
  it('separates general payment instructions from personal bill status', async () => {
    const state = initialState();
    const base = createAgentToolClient();
    const client = {
      listTools: base.listTools,
      callTool: vi.fn<ToolClient['callTool']>(async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ source: 'demo', records: [] }) }],
      })),
    };
    await new AgentRunner(new DemoModel(), state, client).run('怎麼繳水費');
    expect(state.domain).toBe('services');
    expect(client.callTool.mock.calls[0]?.[0]).toEqual({
      name: 'search_fee_types',
      arguments: { keyword: '水費' },
    });
  });
});

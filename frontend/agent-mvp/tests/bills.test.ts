import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner } from '../src/agent/runner';
import { DemoModel } from '../src/agent/model';
import { DemoToolClient, type ToolClient, type ToolResult } from '../src/agent/tool-client';
import { initialState, type ModelAdapter } from '../src/agent/types';
import { billReadTool, demoBillResult, parseBillOutcome } from '../src/agent/skills/bills';
import { billServiceUrl, requestNativeBillPage } from '../src/platform/service-navigation';
import { saveTask } from '../src/platform/storage';

afterEach(() => vi.unstubAllGlobals());
const result = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});
const client = () => new DemoToolClient([billReadTool]);
function fixedModel(category = 'water', period = 'current', action = 'read'): ModelAdapter {
  return {
    mode: 'local',
    complete: vi
      .fn()
      .mockResolvedValueOnce({
        calls: [{ id: 'route', name: 'select_agent', arguments: { domain: 'bills' } }],
      })
      .mockResolvedValue({
        calls: [
          { id: 'intent', name: 'select_bill_query', arguments: { category, period, action } },
        ],
      }),
  };
}

describe('bill skill orchestration', () => {
  it('does not let a model broaden an unspecified bill request to all categories', async () => {
    const state = initialState();
    const mcp = client();
    const call = vi.spyOn(mcp, 'callTool');
    await new AgentRunner(fixedModel('all'), state, mcp).run('我想看到我這期的帳單與繳費狀態');
    expect(state.notice).toBe('billCategory');
    expect(call).not.toHaveBeenCalled();
  });
  it('rejects malformed intent slots before invoking MCP', async () => {
    for (const arguments_ of [
      { category: 'water', period: ['current'], action: 'read' },
      { category: 'water', period: 'current', action: ['read'] },
      { category: 'water', period: 'current', action: 'read', userId: 'someone-else' },
    ]) {
      const model = fixedModel();
      vi.mocked(model.complete).mockResolvedValue({
        calls: [{ id: 'intent', name: 'select_bill_query', arguments: arguments_ }],
      });
      const state = initialState();
      const mcp = client();
      const call = vi.spyOn(mcp, 'callTool');
      await expect(new AgentRunner(model, state, mcp).run('water')).rejects.toThrow(
        'INVALID_BILL_INTENT',
      );
      expect(call).not.toHaveBeenCalled();
      expect(state.billResult).toBeNull();
    }
  });

  it('asks for a category without querying, then executes a button choice without inference', async () => {
    const state = initialState();
    const model = fixedModel('unknown');
    const mcp = client();
    const call = vi.spyOn(mcp, 'callTool');
    const runner = new AgentRunner(model, state, mcp);
    await runner.run('我想看到我這期的帳單與繳費狀態');
    expect(state.notice).toBe('billCategory');
    expect(call).not.toHaveBeenCalled();
    await runner.chooseBillCategory('water');
    expect(state.notice).toBe('bills');
    expect(state.billResult?.records.map((bill) => bill.status)).toEqual(['unpaid', 'paid']);
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledExactlyOnceWith(
      { name: 'list_bills', arguments: { category: 'water', period: 'current' } },
      expect.anything(),
    );
    expect(state.receipt).toBeNull();
    expect(JSON.stringify(state.traces)).not.toContain('我想看到');
    expect(() => runner.chooseBillCategory('tax')).toThrow('NO_PENDING_CATEGORY');
  });
  it('supports a typed clarification and switching to a new task', async () => {
    const state = initialState();
    const runner = new AgentRunner(new DemoModel(), state);
    await runner.run('我想看到我這期的帳單與繳費狀態');
    await runner.run('水費');
    expect(state.billResult?.records).toHaveLength(2);
    await runner.run('查帳單');
    await runner.run('幫我找圖書');
    expect(state.domain).toBe('library');
    expect(state.pendingBillCategory).toBe(false);
    expect(state.billResult).toBeNull();
    expect(state.bookResults).toHaveLength(3);
  });
  it('keeps processing and unknown distinct, and handles empty categories', async () => {
    const state = initialState();
    await new AgentRunner(fixedModel('all'), state).run('all bills');
    expect(state.billResult?.records.map((bill) => bill.status)).toEqual([
      'unpaid',
      'paid',
      'processing',
      'unknown',
    ]);
    await new AgentRunner(fixedModel('tuition'), state).run('學雜費');
    expect(state.notice).toBe('billsEmpty');
    expect(state.billResult?.records).toEqual([]);
  });
  it.each([
    ['water', 'current', 'unsupported'],
    ['parking', 'unsupported', 'read'],
    ['unsupported', 'current', 'read'],
  ])('does not query for unsupported intent %s/%s/%s', async (category, period, action) => {
    const state = initialState();
    const mcp = client();
    const call = vi.spyOn(mcp, 'callTool');
    await new AgentRunner(fixedModel(category, period, action), state, mcp).run('request');
    expect(state.notice).toBe('billUnsupported');
    expect(call).not.toHaveBeenCalled();
  });
  it('handles sign-in and service errors explicitly; retry uses the same query and no model', async () => {
    const state = initialState();
    const mcp = client();
    const call = vi
      .spyOn(mcp, 'callTool')
      .mockResolvedValueOnce(result({ source: 'demo', error: 'AUTH_REQUIRED' }))
      .mockResolvedValueOnce(result({ source: 'demo', error: 'SERVICE_UNAVAILABLE' }));
    const model = fixedModel();
    const runner = new AgentRunner(model, state, mcp);
    await runner.run('water bills');
    expect(state.notice).toBe('billAuth');
    await runner.retryBills();
    expect(state.notice).toBe('billUnavailable');
    await runner.retryBills();
    expect(state.notice).toBe('bills');
    expect(call).toHaveBeenCalledTimes(3);
    expect(model.complete).toHaveBeenCalledTimes(2);
  });
  it('shows unavailable when the teammate has not exposed list_bills', async () => {
    const state = initialState();
    const mcp = new DemoToolClient([]);
    const call = vi.spyOn(mcp, 'callTool');
    await new AgentRunner(fixedModel(), state, mcp).run('water');
    expect(state.notice).toBe('billUnavailable');
    expect(call).not.toHaveBeenCalled();
  });
  it('times out a non-cooperative MCP adapter and ignores its late response', async () => {
    const state = initialState();
    let finish!: (value: ToolResult) => void;
    const mcp = client();
    vi.spyOn(mcp, 'callTool').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const runner = new AgentRunner(fixedModel(), state, mcp, 10);
    await expect(runner.run('water')).rejects.toThrow('OPERATION_TIMEOUT');
    expect(state.notice).toBe('billUnavailable');
    finish(result(demoBillResult));
    await Promise.resolve();
    expect(state.billResult).toBeNull();
  });
  it('cancels a non-cooperative MCP call and prevents late state updates', async () => {
    const state = initialState();
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const mcp: ToolClient = {
      listTools: client().listTools.bind(client()),
      callTool: () => {
        entered();
        return new Promise(() => {});
      },
    };
    const runner = new AgentRunner(fixedModel(), state, mcp);
    const pending = runner.run('water');
    await ready;
    runner.cancel();
    await expect(pending).rejects.toThrow();
    expect(state.notice).toBe('cancelled');
    expect(state.billResult).toBeNull();
  });
  it('does not persist bills, amounts or requests', async () => {
    const state = initialState();
    await new AgentRunner(fixedModel(), state).run('water bills');
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    saveTask(state);
    expect(JSON.parse(setItem.mock.calls[0]![1])).toEqual({ draft: null, receipt: null });
  });
});

describe('bill result trust boundary', () => {
  const query = { category: 'all', period: 'current' } as const;
  it.each([
    { source: 'official' },
    { asOf: 'invalid' },
    { records: [{ ...demoBillResult.records[0], status: 'probably-paid' }] },
    { records: [{ ...demoBillResult.records[0], amount: -1 }] },
    { records: [{ ...demoBillResult.records[0], dueDate: '2026-02-30' }] },
    { records: [demoBillResult.records[0], demoBillResult.records[0]] },
    { records: [{ ...demoBillResult.records[0], category: '__proto__' }] },
  ])('rejects malformed or unapproved data %j', (change) => {
    expect(() => parseBillOutcome({ ...demoBillResult, ...change }, query)).toThrow();
  });
  it('rejects a different category and discards untrusted URL/account fields', () => {
    expect(() =>
      parseBillOutcome(demoBillResult, { category: 'water', period: 'current' }),
    ).toThrow();
    const outcome = parseBillOutcome(
      {
        ...demoBillResult,
        records: [{ ...demoBillResult.records[0], url: 'https://evil.example', account: 'secret' }],
      },
      query,
    );
    expect(JSON.stringify(outcome)).not.toMatch(/evil|secret/);
  });
});

describe('registered service navigation', () => {
  it('uses the existing native bridge and distinguishes request from completion', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', { flutterObject: { postMessage } });
    expect(requestNativeBillPage('water')).toBe('requested');
    expect(JSON.parse(postMessage.mock.calls[0]![0])).toEqual({
      name: 'open_link',
      data: 'https://taipei-pass-service.vercel.app/fee-payment/detail/fee-6/',
    });
    expect(() => billServiceUrl('__proto__' as 'water')).toThrow();
  });
  it('allows normal browser navigation without a bridge and surfaces bridge errors', () => {
    vi.stubGlobal('window', {});
    expect(requestNativeBillPage('water')).toBe('browser');
    vi.stubGlobal('window', {
      flutterObject: {
        postMessage: () => {
          throw new Error('bridge failed');
        },
      },
    });
    expect(() => requestNativeBillPage('water')).toThrow('bridge failed');
  });
});

import { afterAll, expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { AgentRunner } from '../src/agent/runner';
import { LocalModel } from '../src/agent/model';
import { initialState } from '../src/agent/types';

const model = new LocalModel(
  process.env.MODEL_ENDPOINT || 'http://127.0.0.1:11434/v1/chat/completions',
  process.env.MODEL_NAME || 'qwen3:1.7b',
  30000,
);
const cases = [
  {
    request: '幫我找圖書',
    domain: 'library',
    notice: 'books',
    ids: ['book-01', 'book-02', 'book-03'],
  },
  { request: '幫我找「一起慢慢走」', domain: 'library', notice: 'books', ids: ['book-01'] },
  { request: '找書「不存在的書」', domain: 'library', notice: 'empty', ids: [] },
  { request: '有哪些服務？', domain: 'services', notice: 'results', ids: [] },
  { request: '我想查詢叫號服務', domain: 'services', notice: 'results', ids: [] },
  {
    request: 'Find books',
    domain: 'library',
    notice: 'books',
    ids: ['book-01', 'book-02', 'book-03'],
  },
  {
    request: 'Find the book "Walking Together"',
    domain: 'library',
    notice: 'books',
    ids: ['book-01'],
  },
  { request: '我想看到我這期的帳單與繳費狀態', domain: 'bills', notice: 'billCategory', ids: [] },
  { request: '查本期水費繳了沒', domain: 'bills', notice: 'bills', ids: [] },
  {
    request: 'Show all my current bills and payment status',
    domain: 'bills',
    notice: 'bills',
    ids: [],
  },
  { request: '幫我繳水費', domain: 'bills', notice: 'billUnsupported', ids: [] },
  { request: '查上期停車費', domain: 'bills', notice: 'billUnsupported', ids: [] },
  { request: '請幫我寫一首詩', domain: 'unsupported', notice: 'unsupported', ids: [] },
];
const results: unknown[] = [];
for (const item of cases)
  test(item.request, async () => {
    const state = initialState();
    const start = performance.now();
    let error: string | undefined;
    try {
      await new AgentRunner(model, state).run(item.request);
    } catch (cause) {
      error = String(cause);
    }
    results.push({
      request: item.request,
      expected: item,
      actual: {
        domain: state.domain,
        notice: state.notice,
        ids: state.bookIds,
        billQuery: state.billQuery,
      },
      elapsedMs: Math.round(performance.now() - start),
      traces: state.traces,
      error,
    });
    expect(error).toBeUndefined();
    expect(state.domain).toBe(item.domain);
    expect(state.notice).toBe(item.notice);
    expect(state.bookIds).toEqual(item.ids);
    expect(state.receipt).toBeNull();
    if (item.request === '查本期水費繳了沒') expect(state.billQuery?.category).toBe('water');
    if (item.request.startsWith('Show all')) expect(state.billQuery?.category).toBe('all');
  });
test('bill category follow-up retains only bounded task context', async () => {
  const state = initialState();
  const runner = new AgentRunner(model, state);
  await runner.run('我想看到我這期的帳單與繳費狀態');
  expect(state.pendingBillCategory).toBe(true);
  await runner.run('水費');
  expect(state.billQuery).toEqual({ category: 'water', period: 'current' });
  expect(state.billResult?.records).toHaveLength(2);
  results.push({
    request: 'bill category follow-up: 水費',
    actual: { domain: state.domain, notice: state.notice, billQuery: state.billQuery },
    traces: state.traces,
  });
});
afterAll(() =>
  writeFileSync(
    'model-eval.latest.json',
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: process.env.MODEL_NAME || 'qwen3:1.7b',
        host: 'Mac, not phone',
        results,
      },
      null,
      2,
    ) + '\n',
  ),
);

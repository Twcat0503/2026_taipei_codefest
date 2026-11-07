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
  { request: '有哪些服務？', domain: 'services', notice: 'services', ids: [] },
  { request: '我想查詢叫號服務', domain: 'services', notice: 'services', ids: [] },
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
      actual: { domain: state.domain, notice: state.notice, ids: state.bookIds },
      elapsedMs: Math.round(performance.now() - start),
      traces: state.traces,
      error,
    });
    expect(error).toBeUndefined();
    expect(state.domain).toBe(item.domain);
    expect(state.notice).toBe(item.notice);
    expect(state.bookIds).toEqual(item.ids);
    expect(state.receipt).toBeNull();
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

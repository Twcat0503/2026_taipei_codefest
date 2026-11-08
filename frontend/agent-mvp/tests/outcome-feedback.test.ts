import { describe, expect, it } from 'vitest';
import { AgentRunner } from '../src/agent/runner';
import { DemoModel } from '../src/agent/model';
import { outcomeFeedback } from '../src/agent/outcome-feedback';
import { initialState, type ModelAdapter, type TaskState } from '../src/agent/types';
import type { FeedbackKind } from '../src/platform/feedback';

describe('haptic feedback for a finished request', () => {
  // Typed as a full record: a new notice cannot ship without deciding what it feels like.
  const expected: Record<TaskState['notice'], FeedbackKind | null> = {
    results: 'success',
    books: 'success',
    bills: 'success',
    navigate: 'success',
    profile: 'success',
    receipt: 'success',
    error: 'error',
    billUnavailable: 'error',
    billAuth: 'error',
    emergency: 'warning',
    billCategory: null,
    needLocation: null,
    empty: null,
    billsEmpty: null,
    unsupported: null,
    billUnsupported: null,
    welcome: null,
    greeting: null,
    capabilities: null,
    navigationDeclined: null,
    review: null,
    cancelled: null,
  };

  it.each(Object.entries(expected))('%s -> %s', (notice, kind) => {
    expect(outcomeFeedback(notice as TaskState['notice'])).toBe(kind);
  });

  it('stays quiet for a notice it does not know', () => {
    expect(outcomeFeedback('somethingNew' as TaskState['notice'])).toBeNull();
  });

  it('follows what the runner actually ends in', async () => {
    const after = async (request: string, model: ModelAdapter = new DemoModel()) => {
      const state = initialState();
      await new AgentRunner(model, state).run(request).catch(() => {});
      return outcomeFeedback(state.notice);
    };
    expect(await after('找「一起慢慢走」')).toBe('success');
    expect(await after('失火了！')).toBe('warning');
    expect(await after('找書「不存在的書」')).toBeNull();
    expect(await after('幫我寫一首詩')).toBeNull();
    const broken: ModelAdapter = {
      mode: 'demo',
      complete: async () => {
        throw new Error('model unavailable');
      },
    };
    expect(await after('找書', broken)).toBe('error');
  });
});

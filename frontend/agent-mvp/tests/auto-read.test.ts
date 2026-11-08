import { describe, expect, it } from 'vitest';
import { shouldReadAnswerAloud, type AutoReadConditions } from '../src/agent/auto-read';
import { AgentRunner } from '../src/agent/runner';
import { DemoModel } from '../src/agent/model';
import { initialState, type ModelAdapter, type TaskState } from '../src/agent/types';

describe('reading an answer aloud when voice feedback is on', () => {
  const allowed: AutoReadConditions = {
    voiceFeedback: true,
    screenReader: false,
    speechSupported: true,
  };

  // Typed as a full record: a new notice cannot ship without deciding whether it is read.
  const expected: Record<TaskState['notice'], boolean> = {
    results: true,
    books: true,
    bills: true,
    navigate: true,
    profile: true,
    receipt: true,
    error: true,
    billUnavailable: true,
    billAuth: true,
    emergency: true,
    billCategory: true,
    needLocation: true,
    empty: true,
    billsEmpty: true,
    unsupported: true,
    billUnsupported: true,
    greeting: true,
    capabilities: true,
    welcome: false,
    cancelled: false,
    navigationDeclined: false,
    review: false,
  };

  it.each(Object.entries(expected))('%s -> %s', (notice, reads) => {
    expect(shouldReadAnswerAloud(notice as TaskState['notice'], allowed)).toBe(reads);
  });

  it('reads nothing for a notice it does not know', () => {
    expect(shouldReadAnswerAloud('somethingNew' as TaskState['notice'], allowed)).toBe(false);
  });

  it.each<[string, Partial<AutoReadConditions>]>([
    ['voice feedback is off', { voiceFeedback: false }],
    ['a screen reader is on', { screenReader: true }],
    ['the screen reader is unknown (null, as in any browser)', { screenReader: null }],
    ['the screen reader is unknown (undefined)', { screenReader: undefined }],
    ['reading aloud is not supported', { speechSupported: false }],
  ])('stays silent when %s', (_, change) => {
    expect(shouldReadAnswerAloud('results', { ...allowed, ...change })).toBe(false);
    // The same change silences every answer, not only this one.
    for (const [notice, reads] of Object.entries(expected))
      if (reads)
        expect(
          shouldReadAnswerAloud(notice as TaskState['notice'], { ...allowed, ...change }),
        ).toBe(false);
  });

  it('follows what the runner actually ends in', async () => {
    const after = async (request: string, model: ModelAdapter = new DemoModel()) => {
      const state = initialState();
      await new AgentRunner(model, state).run(request).catch(() => {});
      return shouldReadAnswerAloud(state.notice, allowed);
    };
    expect(await after('找「一起慢慢走」')).toBe(true);
    expect(await after('失火了！')).toBe(true);
    // "Nothing found" and "not supported" are answers the person has to hear too.
    expect(await after('找書「不存在的書」')).toBe(true);
    expect(await after('幫我寫一首詩')).toBe(true);
    const broken: ModelAdapter = {
      mode: 'demo',
      complete: async () => {
        throw new Error('model unavailable');
      },
    };
    expect(await after('找書', broken)).toBe(true);

    // A stop the person asked for answers nothing.
    const state = initialState();
    const runner = new AgentRunner(new DemoModel(), state);
    const pending = runner.run('幫我找圖書');
    runner.cancel();
    await pending.catch(() => {});
    expect(state.notice).toBe('cancelled');
    expect(shouldReadAnswerAloud(state.notice, allowed)).toBe(false);
  });
});

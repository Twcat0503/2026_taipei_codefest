import { afterEach, describe, expect, it, vi } from 'vitest';
import { explainButton, streamButtonExplanation } from '../src/agent/button-explanation';
import type { ModelAdapter } from '../src/agent/types';

const result = (description: unknown = '開啟閱讀與模型設定。') => ({
  calls: [{ id: 'help', name: 'describe_button', arguments: { description } }],
});
const adapter = (): ModelAdapter => ({ mode: 'local', complete: vi.fn(async () => result()) });
afterEach(() => vi.useRealTimers());

describe('read-only model button explanations', () => {
  it('supplies only a masked button label and verified purpose, with request-scoped cancellation', async () => {
    const model = adapter();
    await expect(
      explainButton(
        model,
        '聯絡 0912345678',
        '開啟設定。',
        'zh-Hant-TW',
        new AbortController().signal,
      ),
    ).resolves.toBe('開啟閱讀與模型設定。');
    const input = vi.mocked(model.complete).mock.calls[0]![0];
    expect(input.stopOnAbort).toBe(false);
    expect(input.tools.map((tool) => tool.function.name)).toEqual(['describe_button']);
    expect(JSON.parse(input.messages[1]!.content!)).toEqual({
      button_label: '聯絡 ＊＊＊',
      verified_function: '開啟設定。',
    });
    expect(input.messages[0]!.content).toContain('Traditional Chinese');
    expect(JSON.stringify(input)).not.toContain('0912345678');
  });
  it.each([
    '',
    ' '.repeat(3),
    'x'.repeat(161),
    '<script>bad</script>',
    'https://unknown.example',
    'Opens settings. You can change the text size.',
    'x'.repeat(121),
    null,
  ])('rejects unusable model text %s', async (text) => {
    const model = adapter();
    vi.mocked(model.complete).mockResolvedValue(result(text));
    await expect(
      explainButton(model, '設定', '開啟設定。', 'en', new AbortController().signal),
    ).rejects.toThrow('INVALID_BUTTON_EXPLANATION');
  });
  it('never executes a model-selected action', async () => {
    const model = adapter();
    vi.mocked(model.complete).mockResolvedValue({
      calls: [{ id: 'bad', name: 'open_link', arguments: { url: 'https://unknown.example' } }],
    });
    await expect(
      explainButton(model, '設定', '開啟設定。', 'en', new AbortController().signal),
    ).rejects.toThrow('INVALID_BUTTON_EXPLANATION');
  });
  it('rejects long or multi-sentence Chinese explanations instead of truncating them', async () => {
    const model = adapter();
    for (const text of ['設定'.repeat(21), '開啟設定。調整字級。']) {
      vi.mocked(model.complete).mockResolvedValue(result(text));
      await expect(
        explainButton(model, '設定', '開啟設定。', 'zh-Hant-TW', new AbortController().signal),
      ).rejects.toThrow('INVALID_BUTTON_EXPLANATION');
    }
  });
  it('stops a streamed explanation after the first sentence and closes the stream', async () => {
    const closed = vi.fn();
    const model = adapter();
    model.streamText = async function* () {
      try {
        yield '開啟';
        yield '設定。';
        yield '調整字級。';
      } finally {
        closed();
      }
    };
    const spoken: string[] = [];
    for await (const text of streamButtonExplanation(
      model,
      '設定',
      '開啟設定。',
      'zh-Hant-TW',
      new AbortController().signal,
    ))
      spoken.push(text);
    expect(spoken).toEqual(['開啟設定。']);
    expect(closed).toHaveBeenCalledOnce();
  });
  it('bounds an adapter that never resolves and aborts the request', async () => {
    vi.useFakeTimers();
    const model = adapter();
    vi.mocked(model.complete).mockImplementation(() => new Promise(() => {}));
    const pending = explainButton(model, '設定', '開啟設定。', 'en', new AbortController().signal);
    const rejection = expect(pending).rejects.toThrow('Aborted');
    await vi.advanceTimersByTimeAsync(2500);
    await rejection;
    expect(vi.mocked(model.complete).mock.calls[0]![0].signal.aborted).toBe(true);
  });
  it('cancels an ignored model request without waiting for its eventual reply', async () => {
    const model = adapter();
    let finish!: (value: Awaited<ReturnType<ModelAdapter['complete']>>) => void;
    vi.mocked(model.complete).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = explainButton(model, '設定', '開啟設定。', 'en', controller.signal);
    const rejection = expect(pending).rejects.toThrow('Aborted');
    controller.abort();
    await rejection;
    finish(result('太晚的說明。'));
  });
});

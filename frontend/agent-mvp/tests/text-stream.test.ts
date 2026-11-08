import { afterEach, expect, it, vi } from 'vitest';
import { chatTextStream } from '../src/agent/text-stream';
import { LocalModel } from '../src/agent/model';
import { streamButtonExplanation } from '../src/agent/button-explanation';

afterEach(() => vi.unstubAllGlobals());
const event = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`;
it('decodes split UTF-8/event boundaries and stops at DONE', async () => {
  const bytes = new TextEncoder().encode(event('查詢') + event('圖書。') + 'data: [DONE]\r\n\r\n');
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    }),
  );
  const parts: string[] = [];
  for await (const part of chatTextStream(response)) parts.push(part);
  expect(parts).toEqual(['查詢', '圖書。']);
});
it('rejects an interrupted stream instead of treating it as complete', async () => {
  const iterator = chatTextStream(new Response(event('查詢')));
  expect((await iterator.next()).value).toBe('查詢');
  await expect(iterator.next()).rejects.toThrow('INCOMPLETE_MODEL_STREAM');
});
it('speaks the first sentence before the HTTP stream finishes and cancels the remaining generation', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const fetcher = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
          cancel: cancelled,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const model = new LocalModel('http://127.0.0.1:12345/v1/chat/completions', 'fixture');
  const iterator = streamButtonExplanation(
    model,
    '圖書',
    '查詢圖書。',
    'zh-Hant-TW',
    new AbortController().signal,
  );
  const first = iterator.next();
  await vi.waitFor(() => expect(controller).toBeDefined());
  controller.enqueue(new TextEncoder().encode(event('查詢圖書。')));
  expect((await first).value).toBe('查詢圖書。');
  const input = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(input[1].body as string).stream).toBe(true);
  await iterator.return(undefined);
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
});

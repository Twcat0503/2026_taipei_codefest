/** Bounded OpenAI SSE text, including UTF-8 and event boundaries split across network chunks. */
export async function* chatTextStream(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error('EMPTY_MODEL_STREAM');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  let finished = false;
  function parse(event: string): string | null {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return '';
    if (data.trim() === '[DONE]') {
      finished = true;
      return null;
    }
    const value = JSON.parse(data);
    const choice = value?.choices?.[0];
    if (!choice) return '';
    if (choice.finish_reason === 'length') throw new Error('TRUNCATED_RESPONSE');
    if (choice.finish_reason === 'stop') finished = true;
    if (choice.delta?.tool_calls) throw new Error('UNEXPECTED_STREAM_TOOL');
    const text = choice.delta?.content;
    if (text == null) return '';
    if (typeof text !== 'string') throw new Error('INVALID_MODEL_STREAM');
    return text;
  }
  try {
    while (true) {
      const part = await reader.read();
      size += part.value?.byteLength ?? 0;
      if (size > 100000) throw new Error('RESPONSE_TOO_LARGE');
      buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
      let split: RegExpExecArray | null;
      while ((split = /\r?\n\r?\n/u.exec(buffer))) {
        const text = parse(buffer.slice(0, split.index));
        buffer = buffer.slice(split.index + split[0].length);
        if (text === null) return;
        if (text) yield text;
      }
      if (buffer.length > 20000) throw new Error('STREAM_EVENT_TOO_LARGE');
      if (part.done) break;
    }
    if (buffer.trim()) {
      const text = parse(buffer);
      if (text) yield text;
    }
    if (!finished) throw new Error('INCOMPLETE_MODEL_STREAM');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

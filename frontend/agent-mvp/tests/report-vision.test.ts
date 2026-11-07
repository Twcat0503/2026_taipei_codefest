import { describe, expect, it, vi } from 'vitest';
import {
  VISION_IMAGE,
  parseReportVision,
  visionInstruction,
  visionSystemPrompt,
} from '../src/agent/skills/report-vision';
import { LocalModel } from '../src/agent/model';
import { AgentRunner } from '../src/agent/runner';
import { initialState, type ModelAdapter, type VisionRequest } from '../src/agent/types';

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('parseReportVision', () => {
  it('accepts a clean subject and description', () => {
    expect(
      parseReportVision('{"subject":"路面坑洞","description":"人行道上有一個大坑洞"}'),
    ).toEqual({
      subject: '路面坑洞',
      description: '人行道上有一個大坑洞',
    });
  });

  it('returns null when the model found nothing reportable (empty fields)', () => {
    expect(parseReportVision('{"subject":"","description":""}')).toBeNull();
    expect(parseReportVision('{"subject":"路燈","description":"   "}')).toBeNull();
  });

  it('rejects non-JSON and the wrong shape', () => {
    expect(parseReportVision('not json')).toBeNull();
    expect(parseReportVision('{"subject":"x"}')).toBeNull();
    expect(parseReportVision('{"subject":1,"description":"y"}')).toBeNull();
    expect(parseReportVision('["x","y"]')).toBeNull();
  });

  it('collapses whitespace and caps the lengths', () => {
    const draft = parseReportVision(
      JSON.stringify({ subject: `${'主'.repeat(60)}`, description: `a\n\n${'b'.repeat(400)}` }),
    );
    expect(draft).not.toBeNull();
    expect(draft!.subject.length).toBe(40);
    expect(draft!.description.length).toBe(300);
    expect(draft!.description).not.toContain('\n');
  });

  it('refuses an absurdly long reply', () => {
    expect(parseReportVision('x'.repeat(20_001))).toBeNull();
  });
});

describe('vision prompts', () => {
  it('sets the output language and forbids inventing a location', () => {
    const zh = visionSystemPrompt('zh-Hant-TW');
    expect(zh).toContain('Traditional Chinese');
    expect(zh).toMatch(/do NOT (guess|invent)/i);
    expect(visionSystemPrompt('en')).toContain('English');
    expect(visionInstruction('zh-Hant-TW')).toContain('JSON');
  });

  it('only allows small re-encoded image data URLs', () => {
    expect(VISION_IMAGE.pattern.test(IMAGE)).toBe(true);
    expect(VISION_IMAGE.pattern.test('data:text/html;base64,AAAA')).toBe(false);
    expect(VISION_IMAGE.pattern.test('https://example.com/a.jpg')).toBe(false);
  });
});

/** A model whose vision step returns a scripted reply, so the runner can be tested offline. */
function visionModel(reply: string | (() => Promise<string>)): ModelAdapter {
  return {
    mode: 'local',
    requestTimeoutMs: 1000,
    complete: async () => ({ calls: [] }),
    vision: typeof reply === 'string' ? async () => reply : () => reply(),
  };
}

describe('AgentRunner.describePhoto', () => {
  it('returns an editable draft from the model reply', async () => {
    const runner = new AgentRunner(
      visionModel('{"subject":"路燈故障","description":"整條路的路燈都不亮"}'),
      initialState(),
    );
    await expect(runner.describePhoto(IMAGE, 'zh-Hant-TW')).resolves.toEqual({
      subject: '路燈故障',
      description: '整條路的路燈都不亮',
    });
  });

  it('passes the photo and localized prompts to the model', async () => {
    const vision = vi.fn<(input: VisionRequest) => Promise<string>>(async () =>
      JSON.stringify({ subject: 's', description: 'd' }),
    );
    const model: ModelAdapter = {
      mode: 'phone',
      complete: async () => ({ calls: [] }),
      vision,
    };
    await new AgentRunner(model, initialState()).describePhoto(IMAGE, 'en');
    const request = vision.mock.calls[0]![0];
    expect(request.image).toBe(IMAGE);
    expect(request.system).toContain('English');
  });

  it('throws VISION_NO_RESULT when nothing reportable is found', async () => {
    const runner = new AgentRunner(visionModel('{"subject":"","description":""}'), initialState());
    await expect(runner.describePhoto(IMAGE, 'zh-Hant-TW')).rejects.toThrow('VISION_NO_RESULT');
  });

  it('throws VISION_UNAVAILABLE when the model is not multimodal', async () => {
    const model: ModelAdapter = { mode: 'demo', complete: async () => ({ calls: [] }) };
    await expect(
      new AgentRunner(model, initialState()).describePhoto(IMAGE, 'zh-Hant-TW'),
    ).rejects.toThrow('VISION_UNAVAILABLE');
  });

  it('cancelVision aborts an in-flight photo lookup', async () => {
    const model = visionModel(
      () =>
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 50),
        ),
    );
    const runner = new AgentRunner(model, initialState());
    const pending = runner.describePhoto(IMAGE, 'zh-Hant-TW');
    runner.cancelVision();
    await expect(pending).rejects.toThrow();
  });
});

describe('LocalModel.vision on a text-only model', () => {
  const endpoint = 'http://127.0.0.1:8080/v1/chat/completions';
  const request = () => ({
    image: IMAGE,
    system: 's',
    instruction: 'i',
    signal: new AbortController().signal,
  });
  const reply = (status: number, message: string) =>
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: status, message } }), { status }),
      );

  it.each([
    [
      500,
      'image input is not supported - hint: if this is unexpected, you may need to provide the mmproj',
    ],
    [500, 'this model is missing data required for image input'],
    [400, 'model "qwen3:1.7b" does not support images'],
    [400, 'Qwen3 is not a multimodal model'],
  ])('maps HTTP %i "%s" to VISION_UNAVAILABLE', async (status, message) => {
    vi.stubGlobal('fetch', reply(status, message));
    await expect(new LocalModel(endpoint, 'm').vision(request())).rejects.toThrow(
      'VISION_UNAVAILABLE',
    );
    vi.unstubAllGlobals();
  });

  it('keeps other failures and 401 as HTTP errors', async () => {
    vi.stubGlobal('fetch', reply(500, 'out of memory'));
    await expect(new LocalModel(endpoint, 'm').vision(request())).rejects.toThrow('MODEL_HTTP_500');
    vi.stubGlobal('fetch', reply(401, 'image input is not supported'));
    await expect(new LocalModel(endpoint, 'm').vision(request())).rejects.toThrow('MODEL_HTTP_401');
    vi.unstubAllGlobals();
  });

  it('reaches the person as VISION_UNAVAILABLE through the runner', async () => {
    vi.stubGlobal('fetch', reply(500, 'image input is not supported'));
    const runner = new AgentRunner(new LocalModel(endpoint, 'm'), initialState());
    await expect(runner.describePhoto(IMAGE, 'zh-Hant-TW')).rejects.toThrow('VISION_UNAVAILABLE');
    vi.unstubAllGlobals();
  });
});

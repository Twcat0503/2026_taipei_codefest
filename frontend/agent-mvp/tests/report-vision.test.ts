import { describe, expect, it, vi } from 'vitest';
import {
  VISION_IMAGE,
  parseReportVision,
  visionInstruction,
  visionSystemPrompt,
} from '../src/agent/skills/report-vision';
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

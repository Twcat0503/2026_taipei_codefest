import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function nativeVoice(page: Page, missingModel = false, previous = false, startModel = true) {
  await page.addInitScript(
    ({ missingModel, previous }) => {
      if (previous)
        localStorage.setItem(
          'townpass-agent-conversation-v1',
          JSON.stringify([{ request: 'browseBooks', notice: 'books' }]),
        );
      const listeners = new Set<(event: { data: string }) => void>();
      const names: string[] = [];
      let speechRequestId: string | undefined;
      window.flutterObject = {
        addEventListener: (_name, listener) => listeners.add(listener),
        removeEventListener: (_name, listener) => listeners.delete(listener),
        postMessage: (raw) => {
          const request = JSON.parse(raw);
          if (request.name.startsWith('speech_')) {
            names.push(request.name);
            document.documentElement.dataset.voiceRequests = names.join(',');
            if (request.name === 'speech_cancel') speechRequestId = undefined;
            else if (request.name === 'speech_start' || request.name === 'speech_stop') {
              if (request.name === 'speech_start') speechRequestId = request.data.requestId;
              if (!speechRequestId) return;
              const data = {
                requestId: speechRequestId,
                type: request.name === 'speech_start' ? 'listening' : 'final',
                ...(request.name === 'speech_stop' ? { text: '附近的無障礙廁所' } : {}),
              };
              queueMicrotask(() =>
                window.dispatchEvent(
                  new MessageEvent('message', {
                    data: JSON.stringify({ name: 'speech_start', data }),
                  }),
                ),
              );
            }
            return;
          }
          if (
            !['llm_start', 'llm_stop', 'llm_status', 'asr_start', 'asr_stop'].includes(request.name)
          )
            return;
          names.push(request.name);
          document.documentElement.dataset.voiceRequests = names.join(',');
          const running =
            request.name.endsWith('_start') && !(missingModel && request.name === 'asr_start');
          const data = {
            requestId: request.data.requestId,
            phase: running ? 'running' : 'idle',
            running,
            ...(running
              ? {
                  baseUrl: 'http://127.0.0.1:45678/v1',
                  apiKey: 'a'.repeat(64),
                  model: 'voice-fixture',
                }
              : {}),
            ...(missingModel && request.name === 'asr_start'
              ? { phase: 'error', error: 'model missing' }
              : {}),
          };
          queueMicrotask(() =>
            listeners.forEach((listener) =>
              listener({ data: JSON.stringify({ name: request.name, data }) }),
            ),
          );
        },
      };
      const createProcessor = AudioContext.prototype.createScriptProcessor;
      AudioContext.prototype.createScriptProcessor = function (
        size,
        inputChannels,
        outputChannels,
      ) {
        const processor = createProcessor.call(this, size, inputChannels, outputChannels);
        processor.addEventListener('audioprocess', () => {
          document.documentElement.dataset.voiceRecorded = 'yes';
        });
        return processor;
      };
      // A synthetic media stream drives real Web Audio/WAV encoding without using CI hardware.
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          const context = new AudioContext();
          await context.resume();
          const oscillator = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          oscillator.connect(destination);
          oscillator.start();
          for (const track of destination.stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              stop();
              oscillator.stop();
              void context.close();
              document.documentElement.dataset.microphoneStopped = 'yes';
            };
          }
          return destination.stream;
        },
      });
    },
    { missingModel, previous },
  );
  await page.goto('/');
  if (startModel) await page.getByRole('button', { name: '啟動手機模型', exact: true }).click();
  await expect(page.getByRole('button', { name: '開始語音輸入', exact: true })).toBeVisible();
}

test('phone voice can start before the text model is ready', async ({ page }) => {
  await nativeVoice(page, true, false, false);
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await expect(page.getByText(/^手機上的語音辨識模型尚未就緒/)).toBeVisible();
});

test('phone voice stays available after model startup, transcribes to editable text and has a visible back button', async ({
  page,
}) => {
  await nativeVoice(page, false, true);
  let calls = 0;
  await page.route('http://127.0.0.1:45678/v1/audio/transcriptions', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization,content-type',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
      });
      return;
    }
    calls++;
    expect(route.request().headers().authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    const audio = route.request().postDataBuffer()!.toString('latin1');
    expect(audio).toContain('audio/wav');
    expect(audio).toContain('RIFF');
    expect(audio).toContain('WAVE');
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: { text: '幫我找圖書' },
    });
  });
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await expect(page.getByText('這是已保存的摘要，查詢結果未保存。', { exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => localStorage.getItem('townpass-agent-conversation-v1')),
  ).toBeNull();
  await expect(page.getByRole('button', { name: '返回首頁', exact: true })).toBeVisible();
  await page.waitForFunction(() => document.documentElement.dataset.voiceRecorded === 'yes');
  await page.getByRole('button', { name: '完成語音輸入', exact: true }).click();
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toHaveValue('幫我找圖書');
  expect(calls).toBe(1);
  await expect(page.getByRole('button', { name: '送出需求', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: '一起慢慢走', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.microphoneStopped)).toBe('yes');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('a'.repeat(64));
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('button', { name: '返回首頁', exact: true }).click();
  await expect(page.getByRole('heading', { name: '歡迎使用', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '開始語音輸入', exact: true })).toBeVisible();
});

test('back to home cancels capture and returns without needing WebView history', async ({
  page,
}) => {
  await nativeVoice(page);
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.voiceRecorded === 'yes');
  await page.getByRole('button', { name: '返回首頁', exact: true }).click();
  await expect(page.getByRole('heading', { name: '歡迎使用', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.microphoneStopped))
    .toBe('yes');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.voiceRequests))
    .toContain('asr_stop');
});

test('missing ASR model shows a visible recovery and keeps text input usable', async ({ page }) => {
  await nativeVoice(page, true);
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await expect(page.getByText(/^手機上的語音辨識模型尚未就緒/)).toBeVisible();
  await page.getByRole('button', { name: '改用文字輸入', exact: true }).click();
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '返回首頁', exact: true })).toBeVisible();
});

test('missing local ASR can use upstream system speech without submitting the transcript', async ({
  page,
}) => {
  await nativeVoice(page, true);
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await page.getByRole('button', { name: '改用系統語音輸入', exact: true }).click();
  await expect(page.getByText('正在聆聽，請說出你的需求', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完成語音輸入', exact: true }).click();
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toHaveValue('附近的無障礙廁所');
  await expect(page.locator('section.assistant-message')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute(
    'data-voice-requests',
    /speech_start,speech_stop/,
  );
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('');
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await page.getByRole('button', { name: '改用系統語音輸入', exact: true }).click();
  await expect(page.getByText('正在聆聽，請說出你的需求', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回首頁', exact: true }).click();
  await expect(page.getByRole('heading', { name: '歡迎使用', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-voice-requests', /speech_cancel$/);
});

test('the phone back control stays visible when long results scroll', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 420 });
  await nativeVoice(page);
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('你好');
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
  await expect(page.locator('section.assistant-message')).toContainText('你好！');
  await expect(
    page
      .getByRole('button', { name: '開始語音輸入', exact: true })
      .getByText('語音', { exact: true }),
  ).toBeVisible();
  const back = page.getByRole('button', { name: '返回首頁', exact: true });
  const before = await back.boundingBox();
  await page
    .locator('.assistant-body')
    .evaluate((element) => (element.scrollTop = element.scrollHeight));
  expect(
    await page.locator('.assistant-body').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await expect(back).toBeVisible();
  expect(await back.boundingBox()).toEqual(before);
  await back.click();
  await expect(page.getByRole('heading', { name: '歡迎使用', exact: true })).toBeVisible();
});

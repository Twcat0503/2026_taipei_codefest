import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function nativeVoice(
  page: Page,
  options: { previous?: boolean; unavailable?: boolean } = {},
) {
  await page.addInitScript(({ previous, unavailable }) => {
    localStorage.setItem('tp-button-guidance', 'off');
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
        names.push(request.name);
        document.documentElement.dataset.voiceRequests = names.join(',');
        if (request.name === 'tts') {
          const events = request.data.action === 'speak' ? ['start', 'done'] : [];
          for (const event of events)
            queueMicrotask(() =>
              listeners.forEach((listener) =>
                listener({
                  data: JSON.stringify({
                    name: 'tts',
                    data: { requestId: request.data.requestId, event },
                  }),
                }),
              ),
            );
        } else if (request.name === 'speech_cancel') speechRequestId = undefined;
        else if (request.name === 'speech_start' || request.name === 'speech_stop') {
          if (request.name === 'speech_start') speechRequestId = request.data.requestId;
          if (!speechRequestId) return;
          const data = {
            requestId: speechRequestId,
            type: unavailable ? 'error' : request.name === 'speech_start' ? 'listening' : 'final',
            ...(unavailable ? { error: 'unavailable' } : {}),
            ...(request.name === 'speech_stop' ? { text: '附近的無障礙廁所' } : {}),
          };
          queueMicrotask(() =>
            window.dispatchEvent(
              new MessageEvent('message', { data: JSON.stringify({ name: 'speech_start', data }) }),
            ),
          );
        } else if (['llm_start', 'llm_stop', 'llm_status'].includes(request.name)) {
          const running = request.name === 'llm_start';
          const data = {
            requestId: request.data.requestId,
            phase: running ? 'running' : 'idle',
            running,
            ...(running
              ? { baseUrl: 'http://127.0.0.1:45678/v1', apiKey: 'a'.repeat(64), model: 'fixture' }
              : {}),
          };
          queueMicrotask(() =>
            listeners.forEach((listener) =>
              listener({ data: JSON.stringify({ name: request.name, data }) }),
            ),
          );
        }
      },
    };
  }, options);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '開始語音輸入', exact: true })).toBeVisible();
}

test('system voice starts without the phone model and leaves editable text', async ({
  page,
}) => {
  await nativeVoice(page, { previous: true });
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await expect(page.getByText('正在聆聽，請說出你的需求', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完成語音輸入', exact: true }).click();
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toHaveValue('附近的無障礙廁所');
  await expect(page.locator('section.assistant-message')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-voice-requests', /speech_start,speech_stop/);
  expect(await page.locator('html').getAttribute('data-voice-requests')).not.toContain('asr_start');
  expect(
    await page.evaluate(() => localStorage.getItem('townpass-agent-conversation-v1')),
  ).toBeNull();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('leaving the page cancels system voice', async ({ page }) => {
  await nativeVoice(page);
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await expect(page.getByText('正在聆聽，請說出你的需求', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.locator('html')).toHaveAttribute('data-voice-requests', /speech_cancel$/);
});

test('unavailable system voice keeps text input usable', async ({ page }) => {
  await nativeVoice(page, { unavailable: true });
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await expect(page.getByRole('button', { name: '改用文字輸入', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '改用文字輸入', exact: true }).click();
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toBeEnabled();
});

test('phone conversation has no duplicate web back bar when results scroll', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 420 });
  await nativeVoice(page);
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toBeEnabled();
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('你好');
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
  await expect(page.locator('section.assistant-message')).toContainText('你好！');
  await expect(
    page
      .getByRole('button', { name: '開始語音輸入', exact: true })
      .getByText('語音', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '返回首頁', exact: true })).toHaveCount(0);
  await page
    .locator('.assistant-body')
    .evaluate((element) => (element.scrollTop = element.scrollHeight));
  expect(
    await page.locator('.assistant-body').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '返回首頁', exact: true })).toHaveCount(0);
});

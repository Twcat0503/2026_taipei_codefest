import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function chooseService(page: Page, name: string) {
  await page.getByLabel(/^(你想要做什麼？|What would you like help with\?)$/).fill(name);
  await page.getByRole('button', { name: /^(送出需求|Send request)$/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByLabel('模型來源').selectOption('demo');
  await page.getByRole('button', { name: '套用接點', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
});

test('book search, editable confirmation, reload, receipt and reset', async ({ page }) => {
  await chooseService(page, '幫我找圖書');
  await expect(page.getByRole('heading', { name: '一起慢慢走', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '預約這本書', exact: true }).first().click();
  await page.getByLabel('取書館', { exact: true }).selectOption('demo-community');
  await expect(page.getByRole('heading', { name: '已完成示範預約' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('取書館', { exact: true })).toHaveValue('demo-community');
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole('button', { name: '確認示範預約', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已完成示範預約' })).toBeVisible();
  await expect(page.getByText(/^DEMO-/)).toBeVisible();
  await page.getByRole('button', { name: '開始新需求', exact: true }).click();
  await expect(page.getByText(/^DEMO-/)).toHaveCount(0);
});

test('accessible initial page and enlarged bilingual layouts', async ({ page }) => {
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('字級', { exact: true }).selectOption('1.5');
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('語言', { exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await chooseService(page, 'Find sample books');
  await expect(page.getByRole('heading', { name: 'Walking Together', exact: true })).toBeVisible();
});

test('unknown requests and cancelled drafts never produce receipts', async ({ page }) => {
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('幫我寫一首詩');
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
  await expect(page.getByText(/^我能查圖書/)).toBeVisible();
  await page.getByRole('button', { name: '幫我找圖書', exact: true }).click();
  await page.getByRole('button', { name: '預約這本書', exact: true }).first().click();
  await page.getByRole('button', { name: '取消草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '確認示範預約', exact: true })).toHaveCount(0);
  await expect(page.getByText(/^DEMO-/)).toHaveCount(0);
});

test('a greeting receives a helpful answer without a model or tool lookup', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType())) calls.push(request.url());
  });
  await chooseService(page, '你好');
  await expect(page.locator('section.assistant-message')).toContainText(
    '你好！你可以直接說想找什麼服務',
  );
  await expect(page.getByRole('button', { name: '幫我找圖書', exact: true })).toBeVisible();
  expect(calls).toEqual([]);
  await expect(page.getByText(/^DEMO-/)).toHaveCount(0);
});

test('bill clarification, statuses, browser navigation and no persistent account data', async ({
  page,
}) => {
  await chooseService(page, '我想看到我這期的帳單與繳費狀態');
  await expect(
    page.getByRole('group', { name: '你想查哪一種帳單？也可以選擇全部。' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '全部帳單', exact: true }).click();
  await expect(page.getByRole('heading', { name: '水費 · 示範帳單 1' })).toBeVisible();
  for (const status of ['已繳費', '未繳費', '處理中', '尚無法確認']) {
    await expect(
      page.locator('.bill-list strong').filter({ hasText: new RegExp(`^${status}$`) }),
    ).toBeVisible();
  }
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('語言', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByText('Not yet confirmed', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('demo-water');
  // Verify actual navigation without depending on the external template host uptime.
  await page.route('https://taipei-pass-service.vercel.app/**', (route) =>
    route.fulfill({ body: '<h1>Service template destination</h1>', contentType: 'text/html' }),
  );
  await page.getByRole('link', { name: 'Open template: Water bills', exact: true }).click();
  await expect(page).toHaveURL('https://taipei-pass-service.vercel.app/fee-payment/detail/fee-6/');
  await page.goBack();
  await page.reload();
  await expect(page.locator('.bill-list li')).toHaveCount(0);
});

test('native bill navigation requests the registered route and reports bridge failure', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.flutterObject = {
      postMessage: (message: string) => {
        document.documentElement.dataset.bridgeRequest = message;
      },
    };
  });
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('查本期水費繳費狀態');
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
  await page.getByRole('link', { name: '開啟範本：水費', exact: true }).click();
  const sent = await page.evaluate(() => document.documentElement.dataset.bridgeRequest);
  expect(JSON.parse(sent!)).toEqual({
    name: 'open_link',
    data: 'https://taipei-pass-service.vercel.app/fee-payment/detail/fee-6/',
  });
  await expect(page.getByText(/已請 App 開啟服務頁/)).toBeVisible();
  await page.evaluate(() => {
    window.flutterObject = {
      postMessage: () => {
        throw new Error('disconnected');
      },
    };
  });
  await page.getByRole('link', { name: '開啟範本：水費', exact: true }).click();
  await expect(page.getByText(/無法請 App 開啟頁面/)).toBeVisible();
});

test('phone model startup, authenticated structured calls, and stop', async ({ page }) => {
  const fixtureKey = 'b'.repeat(64);
  await page.evaluate((key) => {
    const listeners = new Set<(event: { data: string }) => void>();
    let running = false;
    window.flutterObject = {
      addEventListener: (_name, fn) => {
        listeners.add(fn);
      },
      removeEventListener: (_name, fn) => {
        listeners.delete(fn);
      },
      postMessage: (raw) => {
        const request = JSON.parse(raw);
        if (request.name === 'llm_start') running = true;
        if (request.name === 'llm_stop') running = false;
        const data = {
          requestId: request.data.requestId,
          phase: running ? 'running' : 'idle',
          running,
          ...(running ? { baseUrl: 'http://127.0.0.1:5555/v1', model: 'phone-fixture' } : {}),
          ...(request.name === 'llm_start' ? { apiKey: key } : {}),
        };
        for (const fn of listeners) fn({ data: JSON.stringify({ name: request.name, data }) });
      },
    };
  }, fixtureKey);
  const calls: string[] = [];
  await page.route('http://127.0.0.1:5555/v1/chat/completions', async (route) => {
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
    expect(route.request().headers().authorization).toBe(`Bearer ${fixtureKey}`);
    const body = route.request().postDataJSON();
    expect(body.model).toBe('phone-fixture');
    expect(body.reasoning_effort).toBeUndefined();
    const name = body.response_format.json_schema.schema.properties.name.const;
    calls.push(name);
    const arguments_ =
      name === 'select_agent'
        ? { domain: 'bills' }
        : { category: 'water', period: 'current', action: 'read' };
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ name, arguments: arguments_ }) } }],
      }),
    });
  });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByLabel('模型來源').selectOption('phone');
  await page.getByRole('button', { name: '套用接點', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '送出需求', exact: true, includeHidden: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '啟動手機模型', exact: true }).click();
  await expect(page.getByRole('button', { name: '開始語音輸入', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('已連接手機模型，可以提出需求。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('查本期水費繳費狀態');
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
  await expect(page.getByRole('heading', { name: '水費 · 示範帳單 1' })).toBeVisible();
  expect(calls).toEqual(['select_agent', 'select_bill_query']);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(fixtureKey);
  expect(await page.locator('body').innerText()).not.toContain(fixtureKey);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: '停止並釋放模型', exact: true }).click();
  await expect(page.getByText('模型尚未啟動。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '送出需求', exact: true, includeHidden: true }),
  ).toBeDisabled();
});

test('home navigation preserves a draft and settings return keyboard focus', async ({ page }) => {
  const settings = page.getByRole('button', { name: '設定', exact: true });
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();

  await chooseService(page, '幫我找圖書');
  await page.getByRole('button', { name: '預約這本書', exact: true }).first().click();
  await page.getByLabel('取書館', { exact: true }).selectOption('demo-community');
  await page.getByRole('button', { name: '回到安心助手首頁', exact: true }).click();
  await expect(page.getByRole('heading', { name: '歡迎使用', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '繼續目前的需求', exact: true }).click();
  await expect(page.getByLabel('取書館', { exact: true })).toHaveValue('demo-community');
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toBeDisabled();
  await expect(page.getByText(/^DEMO-/)).toHaveCount(0);
});

test('unavailable voice input has a working text fallback', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: undefined,
    });
  });
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await expect(page.getByText(/^這個環境尚未提供語音輸入/)).toBeVisible();
  await page.getByRole('button', { name: '改用文字輸入', exact: true }).click();
  const input = page.getByLabel('你想要做什麼？', { exact: true });
  await expect(input).toBeFocused();
  await input.fill('幫我找圖書');
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: '一起慢慢走', exact: true })).toBeVisible();
});

test('recognized voice is editable and never submits automatically', async ({ page }) => {
  await page.evaluate(() => {
    class RecognitionFixture {
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
      start() {
        this.onstart?.();
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: '幫我找圖書' }]] });
          this.onend?.();
        }, 50);
      }
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: RecognitionFixture,
    });
  });
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  const input = page.getByLabel('你想要做什麼？', { exact: true });
  await expect(input).toHaveValue('幫我找圖書');
  await expect(input).toBeFocused();
  await expect(page.getByRole('heading', { name: '一起慢慢走', exact: true })).toHaveCount(0);
  await input.fill('找「一起慢慢走」');
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
  await expect(page.getByRole('heading', { name: '一起慢慢走', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('找「一起慢慢走」');
});

test('microphone denial stays visible and cancellation keeps the conversation usable', async ({
  page,
}) => {
  await page.evaluate(() => {
    class DeniedRecognition {
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          this.onerror?.({ error: 'not-allowed' });
          this.onend?.();
        }, 10);
      }
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: DeniedRecognition,
    });
  });
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  await expect(page.getByText(/^尚未取得麥克風權限/)).toBeVisible();
  await page.getByRole('button', { name: '取消語音輸入', exact: true }).click();
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('幫我找圖書');
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
  await page.getByRole('button', { name: '停止處理', exact: true }).click();
  await expect(page.getByText('已停止這次操作。你可以重新開始。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '確認示範預約', exact: true })).toHaveCount(0);
});

test('welcome, settings and composer reflow at 200% in both orientations', async ({ page }) => {
  for (const locale of ['zh-Hant-TW', 'en']) {
    await page.getByRole('button', { name: /^(設定|Settings)$/ }).click();
    await page.getByLabel(/^(語言|Language)$/).selectOption(locale);
    await page.getByRole('button', { name: /^(關閉設定|Close settings)$/ }).click();
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await expect
        .poll(() =>
          page
            .locator('.assistant-body')
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page
            .locator('.welcome-panel')
            .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page
            .locator('.welcome-suggestions > button, .voice-launch')
            .evaluateAll((elements) =>
              elements.every((element) => element.scrollHeight <= element.clientHeight + 1),
            ),
        )
        .toBe(true);
      expect(await page.locator('.composer-box').isVisible()).toBe(true);
      const plus = await page
        .getByRole('button', {
          name: locale === 'en' ? 'Add a photo to help describe' : '加照片幫我描述',
        })
        .boundingBox();
      const composer = await page.locator('.composer-box').boundingBox();
      expect(Math.abs(plus!.height - composer!.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(plus!.y - composer!.y)).toBeLessThanOrEqual(1);
      expect(
        await page
          .locator('.voice-label')
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await expect(page.locator('.suggestion-previous, .suggestion-next')).toHaveCount(0);
      await page.getByRole('button', { name: /^(設定|Settings)$/ }).click();
      expect(
        await page
          .getByRole('dialog')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page.getByRole('button', { name: /^(關閉設定|Close settings)$/ }).click();
    }
  }
});

test('the app fills the viewport and only conversation content scrolls', async ({ page }) => {
  for (const viewport of [
    { width: 393, height: 727 },
    { width: 420, height: 856 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page
          .locator('.assistant-shell')
          .evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight })),
      )
      .toEqual(viewport);
    await expect
      .poll(() =>
        page
          .locator('.welcome-panel')
          .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
      )
      .toBe(true);
    await page.mouse.wheel(0, 500);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.locator('.assistant-body').evaluate((element) => element.scrollTop)).toBe(0);
    const voice = await page
      .getByRole('button', { name: '開始語音輸入', exact: true })
      .boundingBox();
    const composer = await page.locator('.composer-dock').boundingBox();
    expect(voice!.y + voice!.height).toBeLessThanOrEqual(composer!.y + 1);
  }
  await page.setViewportSize({ width: 393, height: 727 });
  await chooseService(page, '幫我找圖書');
  await expect(page.getByRole('heading', { name: '一起慢慢走', exact: true })).toBeVisible();
  const before = await page.locator('.composer-dock').boundingBox();
  await page
    .locator('.assistant-body')
    .evaluate((element) => (element.scrollTop = element.scrollHeight));
  expect(
    await page.locator('.assistant-body').evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  expect(await page.locator('.composer-dock').boundingBox()).toEqual(before);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('an existing session uses the same home layout at small and large text sizes', async ({
  page,
}) => {
  await chooseService(page, '幫我找圖書');
  await page.getByRole('button', { name: '預約這本書', exact: true }).first().click();
  await page.getByLabel('取書館', { exact: true }).selectOption('demo-community');
  await page.reload();
  await page.getByRole('button', { name: '回到安心助手首頁', exact: true }).click();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 393, height: 727 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const size of [100, 200]) {
      await page.evaluate((value) => (document.documentElement.style.fontSize = `${value}%`), size);
      await expect
        .poll(() =>
          page
            .locator('.welcome-panel')
            .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page
            .locator('.welcome-suggestions > button, .voice-launch')
            .evaluateAll((elements) =>
              elements.every((element) => element.scrollHeight <= element.clientHeight + 1),
            ),
        )
        .toBe(true);
      expect(await page.locator('.composer-box').isVisible()).toBe(true);
    }
  }
  await page.getByRole('button', { name: '繼續確認目前需求', exact: true }).click();
  await expect(page.getByLabel('取書館', { exact: true })).toHaveValue('demo-community');
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toBeDisabled();
  await expect(page.getByText(/^DEMO-/)).toHaveCount(0);
});

test('native model setup stays in settings and does not push the home off screen', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.flutterObject = { postMessage() {}, addEventListener() {}, removeEventListener() {} };
  });
  await page.setViewportSize({ width: 393, height: 727 });
  await page.reload();
  await expect(page.locator('.chat-header')).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator('.welcome-panel')
        .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: '啟動手機模型', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '開始語音輸入', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '加照片幫我描述', exact: true }).click();
  await expect(page.getByText('請先啟動手機模型，再用照片辨識。', { exact: true })).toBeVisible();
  expect(
    await page
      .locator('#assistant-photo-input')
      .evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(0);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '啟動手機模型', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '歡迎使用', exact: true })).toBeVisible();
});

test('the plus shortcut only accepts photos when a model can describe them', async ({ page }) => {
  const plus = page.getByRole('button', { name: '加照片幫我描述', exact: true });
  await expect(plus).toBeVisible();
  await expect(page.locator('#assistant-photo-input')).toHaveAttribute(
    'accept',
    'image/jpeg,image/png,image/webp',
  );
  await plus.click();
  await expect(
    page.getByText('規則模擬模式不會辨識照片；請切換到手機或本機模型。', { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator('#assistant-photo-input')
      .evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(0);
  await expect(page.locator('.navigation-card')).toHaveCount(0);
});

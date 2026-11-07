import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByLabel('模型來源').selectOption('demo');
  await page.getByRole('button', { name: '套用接點', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
});

test('book search, editable confirmation, reload, receipt and reset', async ({ page }) => {
  await page.getByRole('button', { name: '幫我找圖書', exact: true }).click();
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
  await page.getByRole('button', { name: 'Find sample books', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Walking Together', exact: true })).toBeVisible();
});

test('unknown requests and cancelled drafts never produce receipts', async ({ page }) => {
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('幫我寫一首詩');
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
  await expect(
    page.getByText('目前能協助查詢示範帳單、服務與圖書。請選擇其中一項，或換個方式告訴我。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '幫我找圖書', exact: true }).click();
  await page.getByRole('button', { name: '預約這本書', exact: true }).first().click();
  await page.getByRole('button', { name: '取消草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '確認示範預約', exact: true })).toHaveCount(0);
  await expect(page.getByText(/^DEMO-/)).toHaveCount(0);
});

test('bill clarification, statuses, browser navigation and no persistent account data', async ({
  page,
}) => {
  await page.getByRole('button', { name: '我想看到我這期的帳單與繳費狀態', exact: true }).click();
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
  await page.getByLabel('語言', { exact: true }).selectOption('en');
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
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByLabel('模型來源').selectOption('phone');
  await page.getByRole('button', { name: '套用接點', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await expect(page.getByRole('button', { name: '送出需求', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '啟動手機模型', exact: true }).click();
  await expect(page.getByText('已連接手機模型，可以提出需求。', { exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: '停止並釋放模型', exact: true }).click();
  await expect(page.getByText('模型尚未啟動。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '送出需求', exact: true })).toBeDisabled();
});

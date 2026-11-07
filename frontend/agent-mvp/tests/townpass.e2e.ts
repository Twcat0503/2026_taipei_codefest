import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  // This server uses the real tool adapter in its default real-data mode; only HTTP
  // responses and location are fixtures. Toilets come from the bundled official snapshot.
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByLabel('模型來源').selectOption('demo');
  await page.getByRole('button', { name: '套用接點', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
});

const send = async (page: Page, text: string) => {
  await page.getByLabel('你想要做什麼？', { exact: true }).fill(text);
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
};
const stubBridge = (page: Page) =>
  page.evaluate(() => {
    window.flutterObject = {
      postMessage: (message) => {
        document.documentElement.dataset.navigation = message;
      },
    };
  });
const posted = async (page: Page) => {
  const raw = await page.evaluate(() => document.documentElement.dataset.navigation);
  return raw ? JSON.parse(raw) : null;
};

test('official toilets resume with district and in-app services ask before leaving', async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_success: unknown, failure: () => void) => failure() },
    });
  });
  await send(page, '附近的無障礙廁所');
  await expect(page.locator('section.assistant-message')).toContainText('我需要知道位置才能查附近');
  // The district is a choice, not something to type.
  await expect(page.getByRole('heading', { name: '你在哪一區？' })).toBeVisible();
  await page.getByRole('button', { name: '大安區', exact: true }).click();
  const answer = page.locator('section.assistant-message');
  await expect(answer).toContainText('官方開放資料');
  await expect(answer).toContainText('臺北市政府環境保護局');
  await expect(answer.locator('.result-card').first()).toContainText('無障礙廁座');
  await expect(page.getByRole('heading', { name: '接下來你可以' })).toBeVisible();
  await expect(page.getByRole('button', { name: '附近有身障車位的停車場' }).first()).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);

  // Personal bills are not invented: the in-app Town Pass payment page is offered instead.
  await stubBridge(page);
  await send(page, '我想看到我這期的帳單與繳費狀態');
  await expect(page.getByRole('heading', { name: '繳費', exact: true })).toBeVisible();
  await expect(answer).toContainText('台北通「繳費」');
  await expect(answer).toContainText('示範資料');
  await expect(answer).not.toContainText('示範帳單');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('button', { name: '先不要', exact: true }).click();
  await expect(answer).toContainText('好的，先留在這裡');
  expect(await posted(page)).toBeNull();

  await send(page, '路燈壞了我要陳情');
  await expect(page.getByRole('heading', { name: '有話要說' })).toBeVisible();
  await page.getByRole('button', { name: '前往', exact: true }).click();
  // The report form opens with a draft built from what was said.
  expect(await posted(page)).toEqual({
    name: 'open_link',
    data: {
      url: 'https://taipei-pass-service.vercel.app/citizen-report/form/R-99',
      prefill: { title: '路燈故障', description: '路燈壞了' },
    },
  });
  await expect(answer).toContainText('已請手機開啟');
});

test('live YouBike results offer the Town Pass map instead of Google Maps', async ({ page }) => {
  await page.route('**/youbike_immediate.json', (route) =>
    route.fulfill({
      json: [
        {
          sno: 'fixture',
          sna: '測試站點',
          sarea: '大安區',
          ar: '測試地址',
          act: '1',
          updateTime: '2026-11-07 16:00:00',
          Quantity: 20,
          available_rent_bikes: 7,
          available_return_bikes: 13,
          latitude: 25.03,
          longitude: 121.54,
        },
      ],
    }),
  );
  await send(page, '大安區 YouBike');
  await expect(page.getByRole('heading', { name: '測試站點' })).toBeVisible();
  const answer = page.locator('section.assistant-message');
  await expect(answer).toContainText('即時資料');
  await expect(answer.locator('dd').filter({ hasText: /^7$/ })).toBeVisible();
  // The data is shown first; no card links out to Google Maps.
  await expect(answer.getByRole('button', { name: /地圖上看|開啟服務頁面/ })).toHaveCount(0);
  await stubBridge(page);
  await page.getByRole('button', { name: '在台北通「找地點」看地圖' }).click();
  await expect(page.getByRole('heading', { name: '找地點', exact: true })).toBeVisible();
  await expect(answer).toContainText('台北通「找地點」');
  expect(await posted(page)).toBeNull();
  await page.getByRole('button', { name: '前往', exact: true }).click();
  expect(await posted(page)).toEqual({
    name: 'open_link',
    data: 'https://taipei-pass-service.vercel.app/surrounding-service/',
  });
});

test('disaster requests consistently offer the official service and never a local mock', async ({
  page,
}) => {
  for (const request of ['通報災情', '我要通報災情', '淹水了要通報災情']) {
    await send(page, request);
    const card = page.locator('.navigation-card');
    await expect(card.getByRole('heading', { name: '災情通報', exact: true })).toBeVisible();
    await expect(card).toContainText('台北通');
    await expect(page.getByRole('button', { name: '前往', exact: true })).toBeVisible();
    await expect(page.getByText('前端示範 · 不會定位、判讀照片或送出通報')).toHaveCount(0);
    await page.getByRole('button', { name: '先不要', exact: true }).click();
    await expect(card).toHaveCount(0);
  }
});

test('greeting and urgent requests have distinct, actionable responses', async ({ page }) => {
  await send(page, '你好');
  await expect(page.locator('section.assistant-message')).toContainText(
    '你好！你可以直接說想找什麼服務',
  );
  await expect(page.locator('.navigation-card')).toHaveCount(0);
  await send(page, '失火了！');
  await expect(page.getByRole('heading', { name: /119/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /119/ })).toBeVisible();
  await expect(page.locator('.navigation-card')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('失火了');
});

test('water fee asks for the account number once, then fills it in', async ({ page }) => {
  await stubBridge(page);
  await send(page, '我要繳水費');
  await expect(page.getByRole('heading', { name: '繳水費', exact: true })).toBeVisible();
  await page.getByLabel('你的水號是？').fill('1-23-456789');
  await page.getByRole('button', { name: '前往', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('10 碼');
  expect(await posted(page)).toBeNull();
  await page.getByLabel('你的水號是？').fill('1-23-456789-0');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('button', { name: '前往', exact: true }).click();
  expect(await posted(page)).toEqual({
    name: 'open_link',
    data: {
      url: 'https://taipei-pass-service.vercel.app/fee-payment/detail/fee-6/',
      prefill: { water_number: '1234567890' },
    },
  });

  // Next time nothing has to be typed.
  await send(page, '我要繳水費');
  const card = page.locator('.navigation-card');
  await expect(card).toContainText('將帶入水號');
  await expect(card).toContainText('1-23-456789-0');
  await expect(card.getByLabel('你的水號是？')).toHaveCount(0);

  // People can see and delete what is remembered.
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('.remembered')).toContainText('1-23-456789-0');
  await page.getByRole('button', { name: '刪除', exact: true }).click();
  await expect(page.locator('.remembered')).toContainText('目前沒有記住任何資料');
});

test('a citizen report is drafted from what was said and opens the form filled in', async ({
  page,
}) => {
  await stubBridge(page);
  await send(page, '大安區和平東路二段100號前的路燈不亮好幾天了，我要陳情');
  await expect(page.getByRole('heading', { name: '有話要說' })).toBeVisible();
  await expect(page.getByLabel('案件主旨')).toHaveValue('路燈故障');
  await expect(page.getByLabel(/^描述（/)).toHaveValue(
    '大安區和平東路二段100號前的路燈不亮好幾天了',
  );
  await expect(page.getByLabel(/發生地點/)).toHaveValue('大安區和平東路二段100號前');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);

  // People can correct the draft; a half-empty draft is caught before leaving.
  await page.getByLabel('案件主旨').fill('');
  await page.getByRole('button', { name: '前往', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('主旨和描述都要填');
  expect(await posted(page)).toBeNull();
  await page.getByLabel('案件主旨').fill('路燈不亮');
  await page.getByRole('button', { name: '前往', exact: true }).click();
  expect(await posted(page)).toEqual({
    name: 'open_link',
    data: {
      url: 'https://taipei-pass-service.vercel.app/citizen-report/form/R-99',
      prefill: {
        title: '路燈不亮',
        description: '大安區和平東路二段100號前的路燈不亮好幾天了',
        location: '大安區和平東路二段100號前',
      },
    },
  });
});

test('a photo is described only inside the editable report form, never submitted automatically', async ({
  page,
}) => {
  let visionCalls = 0;
  await page.route('http://127.0.0.1:11434/v1/chat/completions', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'content-type',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
      });
      return;
    }
    const body = route.request().postDataJSON();
    const isVision = Array.isArray(body.messages?.[1]?.content);
    if (isVision) {
      visionCalls++;
      expect(body.messages[1].content[1].type).toBe('image_url');
      expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    }
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify(
                isVision
                  ? { subject: '樹倒', description: '照片可見路邊樹木倒下。' }
                  : { name: 'select_agent', arguments: { domain: 'services' } },
              ),
            },
          },
        ],
      },
    });
  });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByLabel('模型來源').selectOption('local');
  await page.getByRole('button', { name: '套用接點', exact: true }).click();
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
  await send(page, '路燈壞了我要陳情');
  await expect(page.getByRole('heading', { name: '有話要說', exact: true })).toBeVisible();
  await expect(page.getByText('加照片幫我描述', { exact: true })).toBeVisible();
  await page.locator('#report-photo-input').setInputFiles({
    name: 'street.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(page.locator('#draft-description')).toHaveValue(/照片可見路邊樹木倒下/);
  expect(visionCalls).toBe(1);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await expect(page.getByRole('button', { name: '前往', exact: true })).toBeVisible();
  expect(await posted(page)).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('data:image/jpeg');
});

test('police report opens the contact form with the member phone and email filled in', async ({
  page,
}) => {
  await page.evaluate(() => {
    const listeners: ((event: { data: string }) => void)[] = [];
    window.flutterObject = {
      addEventListener: (_type: string, listener: (event: { data: string }) => void) =>
        listeners.push(listener),
      removeEventListener: () => {},
      postMessage: (message: string) => {
        const { name } = JSON.parse(message);
        if (name !== 'userinfo') {
          document.documentElement.dataset.navigation = message;
          return;
        }
        const data = {
          idNo: 'A123456789',
          realName: '王小明',
          phoneNo: '0912345678',
          email: 'ming@example.com',
          residentAddress: '臺北市中山區吉林路69號',
        };
        setTimeout(() => listeners.forEach((l) => l({ data: JSON.stringify({ name, data }) })));
      },
    } as unknown as typeof window.flutterObject;
  });
  await send(page, '我的機車被偷了我要報案');
  await expect(page.getByText('0912***678')).toBeVisible();
  await page.getByRole('button', { name: '前往', exact: true }).click();
  expect(await posted(page)).toEqual({
    name: 'open_link',
    data: {
      url: 'https://taipei-pass-service.vercel.app/police-report/form',
      prefill: { mobile_number: '0912345678', mail: 'ming@example.com' },
    },
  });
});

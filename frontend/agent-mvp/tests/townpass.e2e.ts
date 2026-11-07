import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  // This server uses the real tool adapter in its default real-data mode; only HTTP
  // responses and location are fixtures. Toilets come from the bundled official snapshot.
  await page.goto('/');
  await page.getByText('設定', { exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByLabel('模型來源').selectOption('demo');
  await page.getByRole('button', { name: '套用接點', exact: true }).click();
  await page.getByText('設定', { exact: true }).click();
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
  expect(await posted(page)).toEqual({
    name: 'open_link',
    data: 'https://taipei-pass-service.vercel.app/citizen-report/',
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

test('water fee asks for the account number once, then fills it in', async ({ page }) => {
  await stubBridge(page);
  await send(page, '我要繳水費');
  await expect(page.getByRole('heading', { name: '繳水費' })).toBeVisible();
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
  await page.getByText('設定', { exact: true }).click();
  await expect(page.locator('.remembered')).toContainText('1-23-456789-0');
  await page.getByRole('button', { name: '刪除', exact: true }).click();
  await expect(page.locator('.remembered')).toContainText('目前沒有記住任何資料');
});

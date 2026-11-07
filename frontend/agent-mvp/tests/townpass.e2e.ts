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

test('official toilets resume with district and official services ask before leaving', async ({
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
  await send(page, '大安區');
  const answer = page.locator('section.assistant-message');
  await expect(answer).toContainText('官方開放資料');
  await expect(answer).toContainText('臺北市政府環境保護局');
  await expect(answer.locator('.result-card').first()).toContainText('無障礙廁座');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);

  // Personal bills are not invented: the official payment platform is offered instead.
  await stubBridge(page);
  await send(page, '我想看到我這期的帳單與繳費狀態');
  await expect(page.getByRole('heading', { name: '臺北市政府智慧支付平台' })).toBeVisible();
  await expect(answer).toContainText('pay.taipei');
  await expect(answer).not.toContainText('示範帳單');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('button', { name: '先不要', exact: true }).click();
  await expect(answer).toContainText('好的，先留在這裡');
  expect(await posted(page)).toBeNull();

  await send(page, '路燈壞了我要陳情');
  await expect(page.getByRole('heading', { name: '臺北市陳情系統' })).toBeVisible();
  await page.getByRole('button', { name: '前往', exact: true }).click();
  expect(await posted(page)).toEqual({ name: 'open_link', data: 'https://1999.gov.taipei/' });
  await expect(answer).toContainText('已請手機開啟');
});

test('live YouBike cards confirm before opening the map', async ({ page }) => {
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
  await expect(page.locator('section.assistant-message')).toContainText('即時資料');
  await expect(
    page.locator('section.assistant-message dd').filter({ hasText: /^7$/ }),
  ).toBeVisible();
  await stubBridge(page);
  await page.getByRole('button', { name: '在地圖上看', exact: true }).click();
  await expect(page.getByText('要離開助手，開啟 www.google.com 嗎？')).toBeVisible();
  expect(await posted(page)).toBeNull();
  await page.getByRole('button', { name: '前往', exact: true }).click();
  // Google Maps cannot render in a WebView, so it goes to the native map app.
  expect(await posted(page)).toEqual({
    name: 'launch_map',
    data: 'https://www.google.com/maps/search/?api=1&query=25.03,121.54',
  });
});

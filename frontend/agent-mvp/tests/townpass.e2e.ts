import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  // This server uses the real tool adapter; only HTTP responses/location are fixtures.
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByLabel('模型來源').selectOption('demo');
  await page.getByRole('button', { name: '套用接點', exact: true }).click();
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
});

test('nearby lookup resumes with district, shows source, and keeps bill clarification', async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_success: unknown, failure: () => void) => failure() },
    });
  });
  await page.route('**/mock/find-place/public_toilet_taipei.json', (route) =>
    route.fulfill({
      json: [
        {
          number: 'fixture',
          city: '大安區',
          name: '測試無障礙公廁',
          address: '測試地址',
          latitude: '25.03',
          longitude: '121.54',
          grade: '特優',
          type: '無障礙廁所',
        },
      ],
    }),
  );
  const send = async (text: string) => {
    await page.getByLabel('你想要做什麼？', { exact: true }).fill(text);
    await page.getByRole('button', { name: '送出需求', exact: true }).click();
  };
  await send('附近的無障礙廁所');
  await expect(page.locator('section.assistant-message')).toContainText('我需要知道位置才能查附近');
  await send('大安區');
  await expect(page.getByRole('heading', { name: '測試無障礙公廁', exact: true })).toBeVisible();
  await expect(page.locator('section.assistant-message')).toContainText('靜態資料快照');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await send('我想看到我這期的帳單與繳費狀態');
  await page.getByRole('button', { name: '水費', exact: true }).click();
  await expect(page.getByRole('heading', { name: '水費 · 示範帳單 1' })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('測試無障礙公廁');
});

test('live YouBike cards show counts and open through native navigation', async ({ page }) => {
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
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('大安區 YouBike');
  await page.getByRole('button', { name: '送出需求', exact: true }).click();
  await expect(page.getByRole('heading', { name: '測試站點' })).toBeVisible();
  await expect(page.locator('section.assistant-message')).toContainText('即時資料');
  await expect(
    page.locator('section.assistant-message dd').filter({ hasText: /^7$/ }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.flutterObject = {
      postMessage: (message) => {
        document.documentElement.dataset.navigation = message;
      },
    };
  });
  await page.getByRole('button', { name: '開啟服務頁面', exact: true }).click();
  expect(
    JSON.parse((await page.evaluate(() => document.documentElement.dataset.navigation))!),
  ).toEqual({
    name: 'open_link',
    data: 'https://www.google.com/maps/search/?api=1&query=25.03,121.54',
  });
});

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByText('設定', { exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByLabel('模型來源').selectOption('demo');
  await page.getByRole('button', { name: '套用接點', exact: true }).click();
  await page.getByText('開發者檢視與接點設定', { exact: true }).click();
  await page.getByText('設定', { exact: true }).click();
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
  await page.getByText('設定', { exact: true }).click();
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
  await page.getByText('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Find sample books', exact: true }).click();
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

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const setting = '按鈕語音導覽：單點說明、雙點執行';
const endpoint = 'http://127.0.0.1:11434/v1/chat/completions';
async function keyboardClick(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).focus();
  await page.keyboard.press('Enter');
}
async function enable(page: Page) {
  await keyboardClick(page, '設定');
  await page.getByRole('checkbox', { name: setting, exact: true }).check();
}
async function localModel(page: Page) {
  await page.getByText('開發者檢視與接點設定', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('模型來源').selectOption('local');
  await page.getByLabel('Chat Completions 位址').fill(endpoint);
  await keyboardClick(page, '套用接點');
}
async function dynamicAction(page: Page) {
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = '查詢服務';
    button.onclick = () => {
      document.documentElement.dataset.buttonActivated = 'true';
    };
    document.querySelector('.assistant-shell')!.append(button);
  });
  return page.getByRole('button', { name: '查詢服務', exact: true });
}
function streamed(text: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    window.SpeechSynthesisUtterance = class {
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    } as typeof SpeechSynthesisUtterance;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [],
        cancel() {},
        speak(utterance: SpeechSynthesisUtterance) {
          spoken.push(utterance.text);
          document.documentElement.dataset.buttonSpoken = JSON.stringify(spoken);
          queueMicrotask(() => utterance.onend?.({} as SpeechSynthesisEvent));
        },
      },
    });
  });
  await page.goto('/');
});

test('the home screen introduces its layout and repeats on return', async ({ page }) => {
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'))
    .toContain('右上角是設定');
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'))
    .toContain('語音輸入按鈕');
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'))
    .toContain('加號可以加入照片');
  await page.getByLabel('你想要做什麼？', { exact: true }).focus();
  await page.getByRole('button', { name: '回到安心助手首頁', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => {
      const spoken = JSON.parse(
        (await page.locator('html').getAttribute('data-button-spoken')) ?? '[]',
      ) as string[];
      return spoken.filter((text) => text.includes('右上角是設定')).length;
    })
    .toBe(2);
});

test('home introduction respects the disabled guidance preference', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tp-button-guidance', 'off'));
  await page.reload();
  await page.waitForTimeout(500);
  expect(await page.locator('html').getAttribute('data-button-spoken')).toBeNull();
});

test('guidance defaults on, speaks basic help and remembers opting out', async ({ page }) => {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: setting, exact: true })).toBeChecked();
  const close = page.getByRole('button', { name: '關閉設定', exact: true });
  await close.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.button-guide-note')).toHaveCount(0);
  await expect(page.getByText('按鈕基本說明', { exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'))
    .toBe(JSON.stringify(['開啟設定。', '關閉設定。']));
  await close.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  const settings = page.getByRole('button', { name: '設定', exact: true });
  await settings.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(settings).toHaveAttribute('aria-description', /開啟設定/);
  await settings.click();
  await expect(page.getByRole('checkbox', { name: setting, exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: setting, exact: true }).uncheck();
  await close.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await settings.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: setting, exact: true })).not.toBeChecked();
});

test('explaining a home button keeps its touch target in place for the second tap', async ({
  page,
}) => {
  await enable(page);
  await keyboardClick(page, '關閉設定');
  const voice = page.getByRole('button', { name: '開始語音輸入', exact: true });
  await expect(voice).toBeVisible();
  const before = await voice.boundingBox();
  await voice.click();
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'))
    .toContain('語音辨識');
  await expect(page.locator('.button-guide-note')).toHaveCount(0);
  expect(await voice.boundingBox()).toEqual(before);
  await expect(page.locator('.voice-dock')).toHaveCount(0);
});

test('fixed home controls speak immediately without calling the model', async ({ page }) => {
  await keyboardClick(page, '設定');
  await localModel(page);
  await page.getByRole('checkbox', { name: setting, exact: true }).check();
  await keyboardClick(page, '關閉設定');
  let requests = 0;
  await page.route(endpoint, (route) => {
    requests++;
    return route.abort();
  });
  await page.getByRole('button', { name: '開始語音輸入', exact: true }).click();
  expect(await page.locator('html').getAttribute('data-button-spoken')).toContain('語音辨識');
  expect(requests).toBe(0);
});

test('input exploration does not focus, clear progress or start editing until the second tap', async ({
  page,
}) => {
  await enable(page);
  await keyboardClick(page, '關閉設定');
  const input = page.getByLabel('你想要做什麼？', { exact: true });
  await input.tap();
  await expect(input).not.toBeFocused();
  await expect(page.getByRole('heading', { name: '歡迎使用', exact: true })).toBeVisible();
  expect(await page.locator('html').getAttribute('data-button-spoken')).toContain('輸入或修改');
  await input.tap();
  await expect(input).toBeFocused();
  await page.keyboard.type('hello');
  await expect(input).toHaveValue('hello');
});

test('photo picking is explained first and retains the real user gesture on the second tap', async ({
  page,
}) => {
  await keyboardClick(page, '設定');
  await localModel(page);
  await page.getByRole('checkbox', { name: setting, exact: true }).check();
  await keyboardClick(page, '關閉設定');
  let pickers = 0;
  page.on('filechooser', () => pickers++);
  const photo = page.getByRole('button', { name: '用照片報案', exact: true });
  await photo.click();
  expect(pickers).toBe(0);
  expect(await page.locator('html').getAttribute('data-button-spoken')).toContain('照片');
  const picker = page.waitForEvent('filechooser');
  await photo.click();
  await picker;
  expect(pickers).toBe(1);
});

test('a model explains a button without seeing typed input or running its action', async ({
  page,
}) => {
  await keyboardClick(page, '設定');
  await localModel(page);
  await page.getByRole('checkbox', { name: setting, exact: true }).check();
  await keyboardClick(page, '關閉設定');
  const action = await dynamicAction(page);
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('private draft must stay here');
  let requests = 0;
  await page.route(endpoint, async (route) => {
    requests++;
    const body = route.request().postDataJSON();
    expect(JSON.stringify(body)).not.toContain('private draft');
    expect(body.messages[0].content).toContain('exactly one short');
    await route.fulfill({
      contentType: 'text/event-stream',
      body: streamed('執行這個選項。'),
    });
  });
  await action.click();
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'))
    .toBe(JSON.stringify(['執行這個選項。']));
  await expect(page.getByText('執行這個選項。', { exact: true })).toHaveCount(0);
  await expect(page.locator('.button-guide-note')).toHaveCount(0);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(requests).toBe(1);
  expect(await page.locator('html').getAttribute('data-button-activated')).toBeNull();
});

test('suggestion voice guidance is immediate and retains the demo warning without model calls', async ({
  page,
}) => {
  await keyboardClick(page, '設定');
  await localModel(page);
  await page.getByRole('checkbox', { name: setting, exact: true }).check();
  await keyboardClick(page, '關閉設定');
  const refresh = page.locator('.welcome-panel').getByRole('button', { name: '換一組建議' });
  let requests = 0;
  await page.route(endpoint, async (route) => {
    requests++;
    await route.abort();
  });
  await refresh.click();
  await refresh.click();
  for (const name of ['附近有孕婦車位的停車場', '附近的 YouBike']) {
    await page.locator('.welcome-panel').getByRole('button', { name }).click();
    await expect
      .poll(() => page.locator('html').getAttribute('data-button-spoken'))
      .toContain(name);
  }
  await refresh.click();
  await refresh.click();
  const water = page.locator('.welcome-panel').getByRole('button', { name: '我要繳水費' });
  await water.click();
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'))
    .toContain('開啟的台北通頁面使用示範資料。');
  await expect(page.locator('.welcome-panel')).toBeVisible();
  expect(requests).toBe(0);
});

test('changing suggestions requires a second tap when guidance is on', async ({ page }) => {
  await keyboardClick(page, '設定');
  await localModel(page);
  await page.getByRole('checkbox', { name: setting, exact: true }).check();
  await keyboardClick(page, '關閉設定');
  await page.route(endpoint, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route
      .fulfill({ contentType: 'text/event-stream', body: streamed('切換到下一組建議。') })
      .catch(() => {});
  });
  const home = page.locator('.welcome-panel');
  const refresh = home.getByRole('button', { name: '換一組建議' });
  await refresh.click();
  await expect(home.getByRole('button', { name: '附近有孕婦車位的停車場' })).toHaveCount(0);
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'))
    .toContain('切換');
  await refresh.click();
  await expect(home.getByRole('button', { name: '附近有孕婦車位的停車場' })).toBeVisible({
    timeout: 1000,
  });
  await refresh.click();
  await refresh.click();
  await expect(home.getByRole('button', { name: '我要繳水費' })).toBeVisible({ timeout: 1000 });
  await page.getByLabel('你想要做什麼？', { exact: true }).focus();
  const quick = page.locator('.quick-chips');
  const quickRefresh = quick.getByRole('button', { name: '換一組建議' });
  await quickRefresh.click();
  await expect(quick.getByRole('button', { name: '附近有孕婦車位的停車場' })).toHaveCount(0);
  await quickRefresh.click();
  await expect(quick.getByRole('button', { name: '附近有孕婦車位的停車場' })).toBeVisible({
    timeout: 1000,
  });
});

test('double tapping submits once; keyboard activation and model timeout keep working', async ({
  page,
}) => {
  await enable(page);
  await keyboardClick(page, '關閉設定');
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('你好');
  const send = page.getByRole('button', { name: '送出需求', exact: true });
  await send.click();
  await expect(page.locator('section.assistant-message')).toHaveCount(0);
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toHaveValue('你好');
  await send.click();
  await expect(page.locator('section.assistant-message')).toContainText('你好！');
  await expect(page.getByLabel('你想要做什麼？', { exact: true })).toHaveValue('');
  await keyboardClick(page, '設定');
  await localModel(page);
  await keyboardClick(page, '關閉設定');
  const action = await dynamicAction(page);
  await page.route(endpoint, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await route
      .fulfill({
        json: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: 'describe_button',
                  arguments: { description: '不能遲到朗讀的內容' },
                }),
              },
            },
          ],
        },
      })
      .catch(() => {});
  });
  await action.click();
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'), { timeout: 6000 })
    .toContain('執行這個選項。');
  expect(await page.locator('html').getAttribute('data-button-spoken')).not.toContain('不能遲到');
  await keyboardClick(page, '設定');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('changing target and executing cancels delayed model narration', async ({ page }) => {
  await keyboardClick(page, '設定');
  await localModel(page);
  await page.getByRole('checkbox', { name: setting, exact: true }).check();
  await keyboardClick(page, '關閉設定');
  const action = await dynamicAction(page);
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(endpoint, async (route) => {
    requested();
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route
      .fulfill({
        json: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: 'describe_button',
                  arguments: { description: '已取消的舊說明' },
                }),
              },
            },
          ],
        },
      })
      .catch(() => {});
  });
  await action.click();
  await started;
  await action.click();
  await expect(page.locator('html')).toHaveAttribute('data-button-activated', 'true');
  await page.waitForTimeout(800);
  expect(await page.locator('html').getAttribute('data-button-spoken')).toBeNull();
});

test('disabled buttons can be explained without enabling their action', async ({ page }) => {
  await enable(page);
  await page.getByText('開發者檢視與接點設定', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('模型來源').selectOption('phone');
  await keyboardClick(page, '套用接點');
  const start = page.getByRole('dialog').getByRole('button', { name: '啟動手機模型', exact: true });
  await expect(start).toBeDisabled();
  await start.click({ force: true });
  await expect
    .poll(() => page.locator('html').getAttribute('data-button-spoken'))
    .toContain('這個按鈕目前無法使用');
  await expect(start).toBeDisabled();
});

test('dynamic emergency actions never execute on an exploratory tap', async ({ page }) => {
  await enable(page);
  await keyboardClick(page, '關閉設定');
  await page.getByLabel('你想要做什麼？', { exact: true }).fill('失火了！');
  await page.getByLabel('你想要做什麼？', { exact: true }).press('Enter');
  const call = page.getByRole('button', { name: '撥打 119（火災、救護車）', exact: true });
  await expect(call).toHaveAttribute('aria-description', /開啟撥號畫面/);
  await page.evaluate(() => {
    window.flutterObject = {
      postMessage(raw) {
        const message = JSON.parse(raw);
        if (message.name === 'phone_call')
          document.documentElement.dataset.buttonOpened = JSON.stringify(message);
      },
    };
  });
  await call.click();
  expect(await page.locator('html').getAttribute('data-button-opened')).toBeNull();
  await expect(call).toHaveAttribute('aria-description', /由你決定是否撥出電話/);
  await call.click();
  await expect(page.locator('html')).toHaveAttribute('data-button-opened', /"data":"119"/);
});

test('screen readers retain native activation and descriptions without duplicate speech', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('tp-button-guidance', 'on');
    const listeners = new Set<(event: { data: string }) => void>();
    window.flutterObject = {
      addEventListener: (_name, listener) => listeners.add(listener),
      removeEventListener: (_name, listener) => listeners.delete(listener),
      postMessage(raw) {
        const request = JSON.parse(raw);
        if (request.name === 'tts') throw new Error('Must not duplicate the screen reader');
        if (!['a11y_state', 'button_guidance'].includes(request.name)) return;
        queueMicrotask(() =>
          listeners.forEach((listener) =>
            listener({
              data: JSON.stringify({
                name: request.name,
                data:
                  request.name === 'a11y_state'
                    ? { requestId: request.data.requestId, screenReader: true }
                    : { requestId: request.data.requestId, ok: true, enabled: true },
              }),
            }),
          ),
        );
      },
    };
  });
  await page.reload();
  await expect(page.locator('[data-a11y-announcer="polite"]')).toContainText('右上角是設定');
  const settings = page.getByRole('button', { name: '設定', exact: true });
  await expect(settings).toHaveAttribute('aria-description', /螢幕閱讀器原有/);
  await settings.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('已偵測到螢幕閱讀器', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await page.locator('html').getAttribute('data-button-spoken')).toBeNull();
});

test('speech-only guidance stays accessible at 200% and preserves activation when speech is unavailable', async ({
  page,
}) => {
  await page.evaluate(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  });
  await enable(page);
  await page.getByLabel('字級', { exact: true }).selectOption('1.5');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.getByRole('button', { name: '關閉設定', exact: true }).click();
  await expect(
    page.getByText('目前無法朗讀按鈕說明，仍可連點兩下執行。', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.button-guide-note')).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('語言', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close settings', exact: true })).toHaveAttribute(
    'aria-description',
    /Closes settings/,
  );
  await expect(
    page.getByText('Button speech is unavailable. You can still double-tap to activate.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await keyboardClick(page, 'Close settings');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

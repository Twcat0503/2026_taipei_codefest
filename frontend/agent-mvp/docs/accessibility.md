# 無障礙基礎層

這一層**沒有任何可見 UI**，只提供 UI 可以直接呼叫的 API：螢幕閱讀器播報、震動回饋、App 內朗讀，以及讀取系統無障礙設定。畫面仍在 Figma 設計，之後的 component 只要呼叫下面的 API，不需要自己處理 Flutter bridge 或瀏覽器差異。

原則：**文字永遠是主要管道**。播報、震動、語音都只是額外的輔助，沒有它們也要能完成任務。

## 模組

| 檔案                            | 用途                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/platform/native-bridge.ts` | `window.flutterObject` 的通用 request／reply 層：`hasNativeBridge()`、`postNative()`、`requestNative()`、`listenNative()` |
| `src/platform/feedback.ts`      | `feedback(kind, message?)`：給 UI 的**單一**多感官回饋入口                                                                |
| `src/platform/announcer.ts`     | `announce(message, { assertive })`：螢幕閱讀器用的 live region                                                            |
| `src/platform/haptics.ts`       | `haptic(type)`、`hapticsEnabled()`、`setHapticsEnabled()`                                                                 |
| `src/platform/speech.ts`        | `canReadAloud()`、`readAloud()`、`stopReading()`：App 內走 `tts` bridge，瀏覽器走 `speechSynthesis`                       |
| `src/platform/a11y.ts`          | `a11yState`（reactive）、`loadA11yState()`、`applyA11yState()`、`initAccessibility()`                                     |
| `src/a11y.css`                  | 依 `<html>` 上的 `data-a11y-*` 屬性關閉動態、加粗文字、提高對比                                                           |

`initAccessibility()` 由 `src/main.ts` 呼叫一次（不等待結果）：掛上 live region、讀取並套用系統設定，並在頁面重新變成可見時（例如使用者從系統設定回來）再讀一次。它不會丟出錯誤，也不會擋住 App 啟動。

## Native bridge 契約

Flutter 端與前端的約定，視為固定。App 與 web 必須是對應的版本。

**通用規則**

- 送出：`window.flutterObject.postMessage(JSON.stringify({ name, data }))`。
- 回覆：`window.flutterObject` 的 `message` event（有 `addEventListener` 就用它，否則用 `onmessage`），`event.data` 是 JSON 字串 `{ name, data }`。
- 如果送出的 `data.requestId`（字串，≤ 64 字元）存在，每一則回覆的 `data.requestId` 都會原樣帶回，同一個 `requestId` 可以有多則回覆。前端用 `name` 加 `data.requestId` 對應請求。
- 格式錯誤、不相關或超過 10000 字元的訊息會被忽略。

**`haptic`**

| 方向 | 內容                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 送出 | `{ requestId?, type }`，`type` 為 `selection`、`light`、`medium`、`heavy`、`success`、`warning`、`error` |
| 回覆 | `{ ok: true }` 或 `{ ok: false, error: 'unknown_type' }`                                                 |

前端以 fire-and-forget 送出，不帶 `requestId`，也不等回覆。

**`tts`**

| 動作  | 送出                                                                                                                    | 回覆                                                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| speak | `{ requestId, action: 'speak', text, lang: 'zh-TW' \| 'en-US', rate }`，`rate` 與 Web Speech API 相同（1.0 為正常速度） | 先 `{ requestId, event: 'start' }`，之後**恰好一則** `{ requestId, event: 'done' }`、`{ requestId, event: 'stopped' }` 或 `{ requestId, event: 'error', error }` |
| stop  | `{ requestId, action: 'stop' }`                                                                                         | `{ requestId, ok: true }`；被中斷的 speak 請求會收到 `event: 'stopped'`                                                                                          |

前端對應：`done`、`stopped` → `finished()`；`error` → `failed()`；送出後 5 秒內沒有收到 `start` → `failed()` 並補送一則 stop。過期（已被新的朗讀取代或已停止）的請求的事件一律忽略，所以 `finished` 與 `failed` 不會同時呼叫，也不會呼叫兩次。

**`a11y_state`**

| 方向 | 內容                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 送出 | `{ requestId }`                                                                                                       |
| 回覆 | `{ requestId, screenReader: boolean \| null, boldText, highContrast, reduceMotion, invertColors, textScale: number }` |

前端 1.5 秒內沒收到回覆就視為失敗。每個欄位各自檢查型別（`textScale` 必須是大於 0 的有限數字）；欄位無效、缺少，或整個請求失敗時，改用瀏覽器 fallback 的值：`reduceMotion`、`highContrast` 來自 media query，其餘欄位是預設值（見下方「瀏覽器 fallback 與限制」）。

| `a11yState` 欄位                            | 套用到 `<html>`             | `src/a11y.css` 的效果                                                            |
| ------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `reduceMotion`                              | `data-a11y-motion="reduce"` | 動畫與 transition 縮到 0.01ms、關閉平滑捲動                                      |
| `boldText`                                  | `data-a11y-bold`            | `body` 字重 600                                                                  |
| `highContrast`                              | `data-a11y-contrast`        | 覆寫 `tokens.css` 的 `--muted`、`--border`、`--teal`、`--amber-ink` 為更深的顏色 |
| `invertColors`、`textScale`、`screenReader` | 無                          | 只放在 `a11yState`，需要時由 component 自行讀取                                  |

## 怎麼用

### `feedback()`：預設選擇

```ts
import { feedback } from './platform/feedback';

feedback('success', t.value.receiptReady); // 播報（polite）＋ success 震動
feedback('error', t.value.submitFailed); // 播報（assertive）＋ error 震動
feedback('selection'); // 只有震動，沒有文字時用
```

`kind` 為 `success`、`warning`、`error`、`info`、`selection`。依序執行：

1. 有 `message` 就 `announce()`（`error` 用 assertive，其他用 polite）。
2. `haptic()`：`success`、`warning`、`error`、`selection` 對應同名震動，`info` 沒有震動。
3. 只有同時符合下面三個條件才語音朗讀：偏好 `tp-voice-feedback` 是 `on`（預設 `off`）、`a11yState.screenReader !== true`、有 `message`。語言跟著 `<html lang>`（`en` 開頭用英文，其餘用繁體中文），速度固定 1。

任何一個管道失敗都不會影響其他管道，`feedback()` 本身不會丟出錯誤。注意語音走 `readAloud()`，會中斷正在進行的朗讀。

### `announce()`：只通知螢幕閱讀器

```ts
import { announce } from './platform/announcer';

announce(t.value.resultsLoaded); // polite（role="status"）
announce(t.value.sessionExpired, { assertive: true }); // assertive（role="alert"）
```

- 兩個視覺隱藏的 live region 在 `initAccessibility()` 掛上；掛上之前呼叫沒有作用。
- 訊息會先清空 region，約 50 ms 後才寫入，所以連續兩次相同的訊息 TalkBack 也會再念一次。50 ms 內對同一個 region 連續呼叫，只有最後一則會念出來。
- 畫面已經用程式把 focus 移到結果標題時，螢幕閱讀器會念出標題，不要再 `announce()` 同一段文字。
- 同一段文字用 `feedback()` 就不要再呼叫 `announce()`。

### `haptic()`

```ts
import { haptic, hapticsEnabled, setHapticsEnabled } from './platform/haptics';

haptic('light');
setHapticsEnabled(false); // 設定頁的開關：寫入 tp-haptics = 'off'
```

七種 type：`selection`、`light`、`medium`、`heavy`、`success`、`warning`、`error`。偏好 `tp-haptics` 為 `on`／`off`，預設 `on`。`haptic()` 永遠不會丟出錯誤，也沒有回傳值。

### `a11yState`

```ts
import { a11yState } from './platform/a11y';

const largeText = computed(() => a11yState.textScale >= 1.3);
```

`a11yState` 是 Vue `reactive` 物件，可以直接用在 `computed`、`watch` 與 template。預設值：`screenReader: null`、其他布林值 `false`、`textScale: 1`。每次 `loadA11yState()` 完成才會更新；較早開始、較晚回來的讀取不會蓋掉較新的結果。

### `readAloud()`、`stopReading()`、`canReadAloud()`

```ts
import { canReadAloud, readAloud, stopReading } from './platform/speech';

readAloud(
  text,
  locale,
  rate,
  () => (speaking.value = false),
  () => (speechFailed.value = true),
);
```

簽名與以往相同。`locale` 為 `'en'` 時用英文，其餘用繁體中文。`rate` 與 Web Speech API 相同。

- `finished`：朗讀結束，或被原生端中斷（`done`、`stopped`）。
- `failed`：朗讀失敗、5 秒內沒有開始、或 bridge 無法送出。
- 呼叫 `stopReading()` 之後，那一次朗讀的 callback 都不會再被呼叫，所以呼叫端自己要把 `speaking` 之類的狀態設回來。
- `stopReading()` 在 App 內只有朗讀進行中才會送出 `tts` stop；沒在朗讀時不送任何 bridge 訊息（原生端每次開始朗讀前也會先停掉上一段）。

## 目前接在哪裡（`src/App.vue`）

呼叫 `feedback(kind)` 時**不帶文字**：畫面上的 `role="status"` 已經會播報同一段文字，再帶文字會讓螢幕閱讀器念兩次。

| 時機                                                                           | `kind`      |
| ------------------------------------------------------------------------------ | ----------- |
| 請求結束且有可用的結果：查到資料、找到要前往的地方、回答「我的資料」、示範回執 | `success`   |
| 請求失敗（`error`、`billUnavailable`、`billAuth`，畫面上有重試）               | `error`     |
| 緊急卡片出現                                                                   | `warning`   |
| 點選建議或選項：首頁建議、輸入框上方的快捷鈕、回答下方的選項與建議、帳單種類   | `selection` |

- 助手反問（問位置、問帳單種類）、沒有結果、不支援、使用者按「停止」都不震動，因為成功或失敗的震動都不符合事實。
- 只在請求剛結束時觸發；還原上次的對話與草稿時不會。
- 結果對照表在 `src/agent/outcome-feedback.ts`，由 `tests/outcome-feedback.test.ts` 檢查。
- 語音回饋只念帶文字的 `feedback()`，上面的呼叫都不帶文字，所以目前還不會出聲。
- 震動走 `haptic` bridge，所以測試裡假的 `window.flutterObject.postMessage` 會收到 `haptic` 訊息；只關心導向的測試要自己略過。

## 隱私：`screenReader`

`a11yState.screenReader` 是身心障礙相關資訊，專案不蒐集障別等健康資料。規則：

- **只放在記憶體**。不寫入 `localStorage`、`sessionStorage`、IndexedDB、cookie，不放進 URL。
- 不 `console.log`（包含整個 `a11yState`）、不寫進 trace、錯誤回報或 analytics。
- 不傳給任何伺服器、LLM prompt 或 MCP。
- 只用在本機的即時決策，例如「要不要播放語音回饋」。

`tests/accessibility.test.ts` 的 `keeps the screen reader setting in memory` 檢查這一點。

## 螢幕閱讀器執行中，不要自動朗讀

`a11yState.screenReader === true` 時，TalkBack 已經在念畫面，App 再自動朗讀會兩個聲音互相蓋過。建議：

- **自動觸發**的朗讀（進頁面就念、結果出現就念、語音回饋）要先檢查 `a11yState.screenReader !== true`。`feedback()` 已經這樣做。
- **使用者主動按下「朗讀」**的按鈕照常執行，因為那是明確的意圖。
- `screenReader` 是 `null`（瀏覽器，或 App 無法判斷）代表不知道，不要當成「沒有螢幕閱讀器」而預設開啟自動朗讀；自動朗讀與語音回饋都維持預設關閉，讓使用者自己在設定頁打開。

## 瀏覽器 fallback 與限制

| 功能           | 在 App（Flutter WebView） | 在一般瀏覽器                                                                                                                                                                         |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 震動           | `haptic` bridge           | `navigator.vibrate(pattern)`                                                                                                                                                         |
| 朗讀           | `tts` bridge              | `speechSynthesis`（聲音是否離線取決於系統語音引擎）                                                                                                                                  |
| 系統無障礙設定 | `a11y_state` bridge       | `matchMedia('(prefers-reduced-motion: reduce)')` 與 `matchMedia('(prefers-contrast: more)')`，`screenReader` 永遠是 `null`，`boldText`、`invertColors`、`textScale` 取不到而維持預設 |
| 播報           | live region               | live region                                                                                                                                                                          |

限制：

- iOS Safari 沒有 `navigator.vibrate`，震動不會有任何作用。
- `navigator.vibrate` 需要頁面先有使用者點擊（user activation）才會生效，裝置在靜音（silent ringer）模式時也不會震動。桌機瀏覽器通常也沒有作用。
- Android 11 以前沒有 `success`、`warning`、`error` 專用的 haptic，這三種在舊機型上分不出差別（實際退化方式由 Flutter 端決定）。
- App 與 web 必須搭配對應的 bridge 版本：App 太舊（沒有 `tts`、`haptic`、`a11y_state` handler）就不會有回覆，前端的處理是 `a11y_state` 1.5 秒後退回瀏覽器 fallback、`readAloud()` 5 秒後呼叫 `failed()`、`haptic()` 靜默沒有作用。UI 不能假設這些一定成功，所以文字一定要在畫面上。
- 一般瀏覽器的朗讀行為與以前相同；在 App 內朗讀改走 `tts` bridge，不再使用 `speechSynthesis`。

## 給 Figma 設計的檢核清單

- 每個可操作元件都有可見的 focus 樣式（與相鄰顏色對比 ≥ 3:1），不要移除 outline。
- 觸控目標 ≥ 48 dp。
- **每一則狀態訊息都有可見文字**（成功、失敗、載入、無結果）；震動、播報、語音都不能是唯一的管道，也不能只靠顏色或圖示。
- 設定頁有三個開關：震動回饋（`setHapticsEnabled`）、語音回饋（`setVoiceFeedbackEnabled`）、朗讀速度（`readAloud` 的 `rate`），並記住使用者的選擇。
- 版面在 200% 字級下不截斷、不橫向捲動；同時開啟粗體（`data-a11y-bold`）也要成立。
- 顏色一律用 `tokens.css` 的 token，不要硬編碼，否則高對比模式（`data-a11y-contrast`）覆寫不到。
- 動畫不能是傳達資訊的唯一方式，因為 `data-a11y-motion="reduce"` 會把動畫縮到幾乎為零。

## 驗證狀態

`tests/accessibility.test.ts` 在 vitest（node 環境，用 fake bridge 與 fake DOM）涵蓋 bridge 的對應與 timeout、朗讀生命週期、震動、系統設定、live region 與 `feedback()`。尚未在實機與 TalkBack 驗證，也還沒和 Flutter 端的 handler 聯調；兩邊的契約以上面為準。

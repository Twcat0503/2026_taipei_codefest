# 無障礙基礎層

這一層提供螢幕閱讀器播報、震動回饋、App 內朗讀、系統無障礙設定，以及可選用的按鈕語音導覽。畫面透過這些 API 使用 Flutter bridge 或瀏覽器能力。

原則：**文字永遠是主要管道**。播報、震動、語音都只是額外的輔助，沒有它們也要能完成任務。

停車場結果先顯示前 3 處的名稱、距離、指定車位數與地址；其餘結果可展開，費率及其他欄位收在「詳細資料」。自動朗讀與「朗讀這段」共用精簡摘要，只介紹第一處的名稱、直線距離與指定車位數，並提醒數字不是即時空位；行政區查詢不稱第一處為「最近」。語音不照念費率、地址或整串結果，完整資料與來源日期／授權仍可展開閱讀。

## 按鈕語音導覽（選用）

「按鈕語音導覽：單點說明、雙點執行」預設開啟，可在「設定 → 閱讀設定」用一次點擊取消勾選。網頁以 `tp-button-guidance` 記住操作偏好，App 則由原生偏好同步；已儲存的關閉選擇會保留。它不記錄是否有視覺障礙。

- 開啟後，助手與服務表單內的按鈕、連結、輸入框、選單、核取方塊及上傳區共用事件代理，包含動態結果及掛在頁面外層的彈出視窗。按一下只說明功能，不開連結、不送表單、不啟動麥克風或選照片；1.2 秒內再點同一個控制項才操作。文字欄位首次點擊不取得焦點或清除舊對話，第二次才開始編輯，編輯中可正常移動游標。
- 首頁、設定、返回、關閉、輸入及拍照等固定功能，直接使用事先定義的精簡說明，立即朗讀，不等待模型。只有動態功能才使用 `ModelAdapter.streamText()` 的 OpenAI SSE 串流；第一句完成後立刻朗讀並結束生成，不等待整個 HTTP 回應。沒有串流介面的 adapter 才沿用唯讀 `describe_button` 契約。App 走原生 TTS 或已啟用的自然語音，瀏覽器走 `speechSynthesis`。
- 只提供按鈕名稱與程式定義的功能，不提供表單值、會員資料或對話內容；名稱中的識別碼先遮蔽。模型回覆不會交給工具執行，也不會改動按鈕的原本功能。
- 語音只念一句功能重點，不重複按鈕名稱或雙點手勢；停用時只念無法使用。AI 說明限中文 40 字／英文 120 字以內，超長、多句或無效時改讀精簡的基本說明，不截斷可能影響意思的提醒；示範預約與非即時空位等必要說明仍保留。
- 動態說明先等待 100 毫秒，以免快速雙點產生多餘推論；每次串流讀取最多等待 2.5 秒，整次生成上限 8 秒。沒有模型、模型忙碌、格式錯誤或逾時時，改讀基本說明。功能僅朗讀，不顯示文字說明區或預留版面空間；朗讀失敗會提示，但雙點操作仍可使用。
- 第二次點擊沿用原始使用者事件，所以照片選擇與媒體操作不會因為程式補點而失去使用者手勢。換按鈕、執行操作、關閉導覽、切換語言或離頁時，取消先前推論及朗讀，忽略遲到回覆。這種推論取消只中止該次請求，不停止共用的手機模型。
- 鍵盤 Enter／Space 與輔助工具產生的啟用事件仍直接執行。已偵測到 TalkBack／螢幕閱讀器時，不再攔截啟用或額外播放 TTS；按鈕附加的 `aria-description` 提供功能說明，沿用螢幕閱讀器本來的探索與雙點手勢。
- 導覽設定開關本身維持一次點擊，可隨時停用；鍵盤及螢幕閱讀器照常操作表單。停用的控制項不會因為雙點而啟用。上傳標籤轉送給檔案輸入框的事件不會再被攔截一次，因此第二次點擊仍能開啟真正的檔案選擇器。

### 跨頁與原生工具列

新版 App 的 `button_guidance` bridge 以 requestId 配對讀寫 `{ enabled, lang }`，只接受助手與核准服務來源的主 frame。`ButtonGuidanceService` 在原生偏好儲存中保留開關及語言，供 WebView 返回／關閉鍵共用；每個核准網頁在載入前取得初始偏好，服務表單再經 bridge 更新，避免不同網域的 localStorage 互不相通。

原生工具列直接朗讀固定說明，單點不返回或關閉，第二次點擊才執行；TalkBack 語意啟用及鍵盤仍直接操作。這些跨頁功能需要新版 APK 與服務網頁部署，舊版 bridge 無回覆時，助手會顯示同步失敗提示，既有文字輸入及一般流程仍可使用。

共用攔截器在 `frontend/shared/interaction-guidance.ts`；助手的 `src/platform/button-guidance.ts` 接上模型與朗讀，服務表單由 `frontend/src/composables/useButtonGuidance.ts` 接上固定說明及 bridge。自動化涵蓋輸入／上傳／下一步／彈窗關閉、原生工具列、串流首句提前輸出、取消與偏好來源限制；實際觸控探索與 TalkBack 仍須在 Android 裝置驗證。

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

前端對應：`done`、`stopped` → `finished()`；`error` → `failed()`；送出後 5 秒內沒有收到 `start` → `failed()` 並補送一則 stop；收到 `start` 之後，超過 15 秒加每個字 400 毫秒（再除以 `rate`）還沒收到 `done`、`stopped` 或 `error` → 補送一則 stop 並 `finished()`，這只是防止結束事件遺失而一直顯示朗讀中，實際朗讀遠比這短。被 `stopReading()` 停止或被下一次 `readAloud()` 取代的朗讀會立刻 `finished()`，之後那個請求的事件一律忽略，所以每一次朗讀的 `finished` 與 `failed` 加起來恰好呼叫一次，不會同時呼叫，也不會呼叫兩次。

**`a11y_state`**

| 方向 | 內容                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 送出 | `{ requestId }`                                                                                                       |
| 回覆 | `{ requestId, screenReader: boolean \| null, boldText, highContrast, reduceMotion, invertColors, textScale: number }` |

前端 1.5 秒內沒收到回覆就視為失敗。每個欄位各自檢查型別（`textScale` 必須是大於 0 的有限數字）；欄位無效、缺少，或整個請求失敗時，改用瀏覽器 fallback 的值：`reduceMotion`、`highContrast` 來自 media query，其餘欄位是預設值（見下方「瀏覽器 fallback 與限制」）。

| `a11yState` 欄位                            | 套用到 `<html>`             | `src/a11y.css` 的效果                                                                                                                                                            |
| ------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reduceMotion`                              | `data-a11y-motion="reduce"` | 動畫與 transition 縮到 0.01ms、關閉平滑捲動                                                                                                                                      |
| `boldText`                                  | `data-a11y-bold`            | `body` 字重 600                                                                                                                                                                  |
| `highContrast`                              | `data-a11y-contrast`        | 覆寫 `tokens.css` 的 `--muted`、`--border`、`--teal`、`--amber-ink` 為更深的顏色，`--primary`、`--surface`、`--bubble`、`--user-bubble` 為更淺的底色，並替對話泡泡與清單加上邊框 |
| `invertColors`、`textScale`、`screenReader` | 無                          | 只放在 `a11yState`，需要時由 component 自行讀取                                                                                                                                  |

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

任何一個管道失敗都不會影響其他管道，`feedback()` 本身不會丟出錯誤。注意語音走 `readAloud()`，會中斷正在進行的朗讀；被中斷的那一次會呼叫它的 `finished`。App 目前的 `feedback()` 呼叫都不帶文字，「語音回饋」自動朗讀回答是另一條路，見「目前接在哪裡」。

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

- `finished`：朗讀結束（`done`）、被 `stopReading()` 停止、被下一次 `readAloud()` 取代、被原生端中斷（`stopped`），或在 App 內開始後太久沒有收到結束事件（見上方的 15 秒加每字 400 毫秒）。瀏覽器的 `cancel()` 造成的 `interrupted`、`canceled` 也算。
- `failed`：朗讀失敗（原生 `error`，或瀏覽器的其他 `error`）、App 內 5 秒內沒有開始、或 bridge 無法送出。
- 每一次朗讀的 callback 恰好呼叫一次。`stopReading()` 與下一次 `readAloud()` 會**同步**先對被停止、被取代的那一次呼叫 `finished`，所以 `speaking` 之類的狀態會被設回來（`feedback()` 的語音取代使用者按下的朗讀時也一樣），停止時也不會出現朗讀失敗的訊息。
- `stopReading()` 在 App 內只有朗讀進行中才會送出 `tts` stop；沒在朗讀時不送任何 bridge 訊息（原生端每次開始朗讀前也會先停掉上一段）。
- 設定的「本機自然語音」開著、服務就緒時，App 內的中文朗讀改由本機 BlueMagpie 念（`natural-voice.ts`），沒就緒、英文與瀏覽器仍用系統語音。它走同一條「恰好一次」的規則：念完、被 `stopReading()` 停止、被下一次 `readAloud()` 取代，都和上面一樣回呼 `finished`。差別是它沒有交給 `tts` bridge，所以停止它**不會**送 `tts` stop。念不出來的部分（某一句合成失敗、逾時、播放被擋）交給系統語音念完，交接時不會呼叫 `finished`，之後由那次系統朗讀回呼 `finished` 或 `failed`，所以整段朗讀仍然只回呼一次。WebView 預設要使用者手勢才能出聲，而一段語音要等網路回來才播，所以所有片段都用同一個共用的 `<audio>`：開著本機自然語音時，頁面上第一次互動（`pointerdown`、`pointerup`、`keydown`、`click`；觸控要放開才算手勢）用程式產生的無聲 WAV 先把它解鎖，之後每一段只換 `src`。解鎖前或 `play()` 仍被拒絕，就和其他失敗一樣交給系統語音。

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
- 設定的「閱讀與語音」有「震動回饋」（`hapticsEnabled`、預設開）與「語音回饋」（`voiceFeedbackEnabled`、預設關）兩個核取方塊，偏好存在這支手機。
- 「語音回饋」不是靠上面不帶文字的 `feedback()`，而是請求結束時自動朗讀回答，見下一節。
- 震動走 `haptic` bridge，所以測試裡假的 `window.flutterObject.postMessage` 會收到 `haptic` 訊息，自動朗讀則會收到 `tts` 訊息；只關心導向的測試要自己略過。

### 語音回饋：自動朗讀回答

「語音回饋」打開時，請求剛結束就像按下「朗讀這段」一樣把回答唸出來，人不用再去找按鈕。同時符合下面四個條件才唸（`src/agent/auto-read.ts` 的 `shouldReadAnswerAloud()`，由 `tests/auto-read.test.ts` 檢查）：

1. 偏好 `tp-voice-feedback` 是 `on`（`voiceFeedbackEnabled()`，預設 `off`）。
2. `a11yState.screenReader === false`：App 回報**確定**沒開螢幕閱讀器。`true`、`null`、`undefined`（一般瀏覽器，或 App 無法判斷）都不唸，免得蓋過沒偵測到的螢幕閱讀器。
3. 這個頁面可以朗讀（`speechSupported`，也就是畫面上有「朗讀這段」按鈕）。
4. 請求結束的狀態有回答可念。

- 走的是按鈕用的同一個函式 `startReading()`：唸的文字相同（回覆、找到的項目、可以點選的選項），語言與速度跟著設定，唸的時候 `speaking` 為 true、按鈕顯示「停止朗讀」，按下就停。唸出聲失敗時，也和按鈕一樣在回答下方顯示「朗讀未能啟動」。
- 已經在朗讀的話，新的回答取代它：`startReading()` 先 `stopReading()`，舊的那一次的 `finished` 會先把 `speaking` 設回 false，再設成 true。順序不能反過來。
- 觸發點和震動相同，都在 `feedbackForAnswer()`：`submit`、`showBookDetails`、`billAction`、`confirm`；另外還有對「你好」的回覆（打招呼沒有震動，但會唸）。還原上次的對話與草稿時不會唸，因為只有請求剛結束才呼叫。
- 不唸：起始畫面（`welcome`）、使用者自己按了「停止」（`cancelled`），以及不是請求結束的狀態（`navigationDeclined`、`review`）。其他都唸，包括出錯、沒有結果、不支援，以及助手反問（問位置、問帳單種類，選項一起唸）。完整對照在 `src/agent/auto-read.ts`。
- 唸的和按鈕一樣，所以緊急狀況只唸「這聽起來很緊急，請先照下面的方式求助。」，不唸緊急卡片上的撥號說明。
- 一般瀏覽器的 `screenReader` 永遠是 `null`，所以不會自動朗讀；只有在 App 內，而且 App 回報沒開螢幕閱讀器時才會。
- e2e（`tests/app.e2e.ts`）用假的 bridge 回報 `screenReader` 並記錄 `tts` 訊息：回報 `false` 且語音回饋打開才會有一則 `speak`，回報 `true`、`null` 或語音回饋關閉都沒有。

## 隱私：`screenReader`

`a11yState.screenReader` 是身心障礙相關資訊，專案不蒐集障別等健康資料。規則：

- **只放在記憶體**。不寫入 `localStorage`、`sessionStorage`、IndexedDB、cookie，不放進 URL。
- 不 `console.log`（包含整個 `a11yState`）、不寫進 trace、錯誤回報或 analytics。
- 不傳給任何伺服器、LLM prompt 或 MCP。
- 只用在本機的即時決策，例如「要不要播放語音回饋」。

`tests/accessibility.test.ts` 的 `keeps the screen reader setting in memory` 檢查這一點。

## 螢幕閱讀器執行中，不要自動朗讀

`a11yState.screenReader === true` 時，TalkBack 已經在念畫面，App 再自動朗讀會兩個聲音互相蓋過。建議：

- **自動觸發**的朗讀（進頁面就念、結果出現就念、語音回饋）要先檢查 `a11yState.screenReader`。帶文字的 `feedback()` 排除 `true`（`!== true`）；App 的自動朗讀回答更保守，要 `=== false` 才唸（見上面的「語音回饋：自動朗讀回答」）。
- **使用者主動按下「朗讀」**的按鈕照常執行，因為那是明確的意圖。
- `screenReader` 是 `null`（瀏覽器，或 App 無法判斷）代表不知道，不要當成「沒有螢幕閱讀器」而預設開啟自動朗讀；自動朗讀與語音回饋都維持預設關閉，讓使用者自己在設定頁打開。自動朗讀回答遇到 `null` 就不唸。

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
- 一般瀏覽器仍用 `speechSynthesis`；只有在 App 內朗讀才改走 `tts` bridge。
- 「語音回饋」的自動朗讀要 App 回報 `screenReader === false`，所以一般瀏覽器不會觸發，按鈕仍然可以手動朗讀。

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

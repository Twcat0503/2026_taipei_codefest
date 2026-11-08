import { controlName, type ControlHelp } from '../../shared/interaction-guidance';

export const guidanceMessages = {
  'zh-Hant-TW': {
    gesture: '雙點執行。',
    disabled: '目前無法使用。',
    screenReader: '使用螢幕閱讀器原有的啟用手勢。',
    input: '輸入或修改內容，不會自動送出。',
    select: '選擇欄位項目。',
    toggle: '切換勾選狀態。',
    photo: '選擇照片或附件。',
    next: '檢查資料並前往下一步。',
    close: '關閉視窗，回到表單。',
    remove: '移除附件。',
    info: '查看附件格式與大小限制。',
    confirm: '確認視窗內容。',
    submit: '檢查並送出表單。',
    back: '返回上一頁。',
    generic: '執行這個選項。',
    unnamed: '操作項目',
    speechFailed: '目前無法朗讀操作說明，仍可連點兩下操作。',
    uploadInfo: '附件格式說明',
    removePhoto: '移除附件'
  },
  en: {
    gesture: 'Double-tap to act.',
    disabled: 'Currently unavailable.',
    screenReader: 'Use your screen reader’s usual activation gesture.',
    input: 'Edits this field without submitting.',
    select: 'Chooses a field option.',
    toggle: 'Toggles this option.',
    photo: 'Chooses a photo or attachment.',
    next: 'Checks details and goes to the next step.',
    close: 'Closes this dialog.',
    remove: 'Removes this attachment.',
    info: 'Shows file format and size limits.',
    confirm: 'Confirms these details.',
    submit: 'Checks and submits this form.',
    back: 'Goes back.',
    generic: 'Activates this option.',
    unnamed: 'Control',
    speechFailed: 'Control speech is unavailable. You can still double-tap to use it.',
    uploadInfo: 'Attachment requirements',
    removePhoto: 'Remove attachment'
  }
};
export type GuideLanguage = keyof typeof guidanceMessages;
export function formControlHelp(control: HTMLElement, lang: GuideLanguage): ControlHelp {
  const t = guidanceMessages[lang];
  const label = controlName(control, t.unnamed);
  const purpose =
    control.matches('input[type="file"]') || control.classList.contains('upload-box')
      ? t.photo
      : control.matches(
            'textarea, input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="reset"])'
          )
        ? t.input
        : control.matches('select')
          ? t.select
          : control.matches('input[type="checkbox"], input[type="radio"]')
            ? t.toggle
            : /下一步|下一頁|next/i.test(label)
              ? t.next
              : /關閉|close|取消|cancel/i.test(label)
                ? t.close
                : /移除|刪除|remove|delete/i.test(label)
                  ? t.remove
                  : /附件格式|requirements/i.test(label)
                    ? t.info
                    : /確認|確定|confirm|ok/i.test(label)
                      ? t.confirm
                      : /送出|submit/i.test(label)
                        ? t.submit
                        : /返回|上一步|back/i.test(label)
                          ? t.back
                          : t.generic;
  return { label, purpose, fixed: true };
}

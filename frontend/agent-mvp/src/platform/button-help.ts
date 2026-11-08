import type { Locale } from '../agent/types';
import { messages } from '../i18n';
import { controlName, controlSelector } from '../../../shared/interaction-guidance';

export const buttonSelector = controlSelector;

/** Accessible names and curated functions, without reading input values or surrounding messages. */
export function buttonHelp(button: HTMLElement, locale: Locale) {
  const t = messages[locale];
  const label = controlName(button, t.guideUnnamed);
  const suggestionGuide = button.dataset.suggestionGuide;
  if (
    suggestionGuide === 'demo' ||
    suggestionGuide === 'request' ||
    suggestionGuide === 'refresh'
  ) {
    return {
      label,
      purpose:
        suggestionGuide === 'refresh'
          ? t.guideMoreSuggestions
          : `${label}。${suggestionGuide === 'demo' ? t.guideSuggestionDemo : t.guideRequest}`,
      fixed: true,
    };
  }
  const descriptions = new Map<string, string>([
    [t.settings, t.guideSettings],
    [t.closeSettings, t.guideCloseSettings],
    [t.backHome, t.guideHome],
    [t.backToHome, t.guideHome],
    [t.continueConversation, t.guideResume],
    [t.newTask, t.guideClear],
    [t.clearProgress, t.guideClear],
    [t.send, t.guideSend],
    [t.voiceLabel, t.guideVoice],
    [t.waterVoiceStart, t.guideVoice],
    [t.voiceRetry, t.guideVoice],
    [t.voiceSystem, t.guideSystemVoice],
    [t.voiceFinish, t.guideFinishVoice],
    [t.voiceCancel, t.guideCancelVoice],
    [t.useKeyboard, t.guideKeyboard],
    [t.phoneStart, t.guideStartModel],
    [t.phoneCancel, t.guideStopModel],
    [t.phoneStop, t.guideStopModel],
    [t.phoneRefresh, t.guideRefreshModel],
    [t.read, t.guideRead],
    [t.stopRead, t.guideStopRead],
    [t.stop, t.guideStopTask],
    [t.photoReport, t.guidePhoto],
    [t.photoAdd, t.guidePhoto],
    [t.photoRemove, t.guideRemovePhoto],
    [t.apply, t.guideApply],
    [t.leaveGo, t.guideOpen],
    [t.leaveStay, t.guideStay],
    [t.reserve, t.guideReserve],
    [t.confirm, t.guideConfirm],
    [t.cancel, t.guideCancelDraft],
    [t.details, t.guideDetails],
    [t.openPage, t.guideConfirmLink],
    [t.openMap, t.guideConfirmLink],
    [t.parkingSourceLink, t.guideOpen],
    [t.rememberedDelete, t.guideForget],
    [t.parkingExpand, t.guideParking],
    [t.parkingSearchAgain, t.guideParking],
    [t.parkingRetryLocation, t.guideLocation],
    [t.parkingSearchDistrict, t.guideDistrict],
    [t.parkingSwitchPregnancy, t.guideParking],
    [t.parkingSwitchDisabled, t.guideParking],
    [t.billRetry, t.guideRequest],
    [t.prefillWaterChange, t.guideForm],
    [t.toiletSuggestion, t.guideRequest],
    [t.parkingSuggestion, t.guideParking],
    [t.disabledSuggestion, t.guideRequest],
    [t.nearestParking, t.guideParking],
    [t.leaveDial, t.guideCall],
  ]);
  if (button.matches('input[type="file"]')) return { label, purpose: t.guidePhoto, fixed: true };
  if (
    button.matches('textarea, input:not([type="button"]):not([type="submit"]):not([type="reset"])')
  )
    return {
      label,
      purpose: button.matches('[type="checkbox"], [type="radio"]') ? t.guideToggle : t.guideInput,
      fixed: true,
    };
  if (button.matches('select')) return { label, purpose: t.guideSelect, fixed: true };
  const purpose =
    descriptions.get(label) ??
    (button.closest('.emergency-card') ||
    /^(撥打\s|Call\s)/u.test(label) ||
    button.getAttribute('href')?.startsWith('tel:')
      ? t.guideCall
      : button.tagName === 'SUMMARY'
        ? t.guideExpand
        : button.closest(
              '.welcome-suggestions, .recovery-options, .choices, .quick-services, .bill-options',
            )
          ? t.guideRequest
          : button.closest('.parking-actions')
            ? t.guideParking
            : button.tagName === 'A'
              ? t.guideOpen
              : button.closest('.navigation-card')
                ? t.guideForm
                : t.guideGeneric);
  return {
    label,
    purpose,
    fixed:
      descriptions.has(label) ||
      button.tagName === 'SUMMARY' ||
      button.classList.contains('welcome-suggestion') ||
      purpose === t.guideCall,
  };
}

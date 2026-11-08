import type { Locale } from '../agent/types';
import { messages } from '../i18n';
import { buttonHelp } from './button-help';
import { createInteractionGuidance } from '../../../shared/interaction-guidance';

type Options = {
  locale: () => Locale;
  screenReader: () => boolean | null;
  explain: (
    label: string,
    purpose: string,
    signal: AbortSignal,
  ) => AsyncIterable<string> | Promise<string>;
  reportSpeechFailure: (failed: boolean) => void;
  speak: (text: string, finished: () => void, failed: () => void) => void;
  stop: () => void;
};
export function createButtonGuidance(root: HTMLElement, options: Options) {
  return createInteractionGuidance(root, {
    ...options,
    help: (control) => buttonHelp(control, options.locale()),
    gesture: () => messages[options.locale()].guideGesture,
    disabledHint: () => messages[options.locale()].guideDisabled,
    screenReaderHint: () => messages[options.locale()].guideScreenReaderHint,
  });
}

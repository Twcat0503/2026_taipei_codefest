import { onBeforeUnmount, onMounted, ref } from 'vue';
import { createInteractionGuidance } from '../../shared/interaction-guidance';
import {
  guidanceBridge,
  guideRequest,
  initialGuidance,
  loadGuidancePreference,
  listenGuideMessage
} from '../../shared/guidance-preference';
import { formControlHelp, guidanceMessages, type GuideLanguage } from '@/data/buttonGuidance';

export function useButtonGuidance() {
  const failed = ref(false);
  const language = ref<GuideLanguage>(initialGuidance().lang === 'en' ? 'en' : 'zh-Hant-TW');
  let screenReader: boolean | null = null;
  let enabled = initialGuidance().enabled;
  let guide: ReturnType<typeof createInteractionGuidance> | undefined;
  let disposed = false;
  let stopSpeech: (() => void) | undefined;
  function stop() {
    stopSpeech?.();
    stopSpeech = undefined;
  }
  function speak(text: string, done: () => void, error: () => void) {
    stop();
    const bridge = guidanceBridge();
    if (bridge) {
      const requestId = `guide-tts-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let ended = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (callback: () => void) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        unlisten();
        callback();
      };
      const receive = (event: { data: unknown }) => {
        if (typeof event.data !== 'string' || event.data.length > 10000) return;
        try {
          const reply = JSON.parse(event.data);
          if (reply.name !== 'tts' || reply.data?.requestId !== requestId) return;
          if (reply.data.event === 'start') {
            clearTimeout(timer);
            timer = setTimeout(() => finish(error), 15000 + text.length * 400);
          } else if (reply.data.event === 'done' || reply.data.event === 'stopped') finish(done);
          else if (reply.data.event === 'error') finish(error);
        } catch {
          /* Ignore unrelated replies. */
        }
      };
      const sendStop = () => {
        try {
          bridge.postMessage(
            JSON.stringify({
              name: 'tts',
              data: { requestId: `${requestId}-stop`, action: 'stop' }
            })
          );
        } catch {
          /* Page may have closed. */
        }
      };
      stopSpeech = () => {
        if (!ended) {
          sendStop();
          finish(done);
        }
      };
      timer = setTimeout(() => {
        sendStop();
        finish(error);
      }, 5000);
      const unlisten = listenGuideMessage(bridge, receive);
      try {
        bridge.postMessage(
          JSON.stringify({
            name: 'tts',
            data: {
              requestId,
              action: 'speak',
              text,
              lang: language.value === 'en' ? 'en-US' : 'zh-TW',
              rate: 0.9
            }
          })
        );
      } catch {
        finish(error);
      }
    } else if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language.value === 'en' ? 'en-US' : 'zh-TW';
      utterance.onend = done;
      utterance.onerror = error;
      stopSpeech = () => {
        utterance.onend = utterance.onerror = null;
        window.speechSynthesis.cancel();
      };
      window.speechSynthesis.speak(utterance);
    } else error();
  }
  async function refresh() {
    const [pref, accessibility] = await Promise.all([
      loadGuidancePreference(),
      guideRequest('a11y_state')
    ]);
    if (disposed) return;
    const lang = pref.lang === 'en' ? 'en' : 'zh-Hant-TW';
    const reader =
      typeof accessibility.screenReader === 'boolean' ? accessibility.screenReader : null;
    const changed = enabled !== pref.enabled || language.value !== lang || screenReader !== reader;
    language.value = lang;
    screenReader = reader;
    enabled = pref.enabled;
    if (changed) guide?.enable(enabled);
  }
  const visible = () => {
    if (document.visibilityState === 'visible') void refresh();
  };
  onMounted(() => {
    guide = createInteractionGuidance(document.body, {
      help: (control) => formControlHelp(control, language.value),
      locale: () => language.value,
      gesture: () => guidanceMessages[language.value].gesture,
      disabledHint: () => guidanceMessages[language.value].disabled,
      screenReaderHint: () => guidanceMessages[language.value].screenReader,
      screenReader: () => screenReader,
      explain: async function* (_label, purpose) {
        yield purpose;
      },
      reportSpeechFailure: (value) => {
        failed.value = value;
      },
      speak,
      stop
    });
    guide.enable(enabled);
    void refresh();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', visible);
    window.addEventListener('storage', visible);
  });
  onBeforeUnmount(() => {
    disposed = true;
    guide?.dispose();
    stop();
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('pageshow', visible);
    window.removeEventListener('storage', visible);
  });
  return { failed, language, messages: guidanceMessages };
}

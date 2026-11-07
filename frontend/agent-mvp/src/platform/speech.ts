export function canReadAloud() {
  // The MVP has not integrated the native TTS reply and completion lifecycle yet.
  return (
    !window.flutterObject && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  );
}
export function stopReading() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
export function readAloud(
  text: string,
  lang: string,
  rate: number,
  finished: () => void,
  failed: () => void,
) {
  if (!canReadAloud()) {
    failed();
    return;
  }
  stopReading();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'en' ? 'en-US' : 'zh-TW';
  utterance.rate = rate;
  // Prefer an installed voice, avoiding network-backed voice selection where available.
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.localService && v.lang.toLowerCase() === utterance.lang.toLowerCase());
  if (voice) utterance.voice = voice;
  utterance.onend = finished;
  utterance.onerror = failed;
  window.speechSynthesis.speak(utterance);
}

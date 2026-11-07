/** Mono PCM16 WAV accepted by the on-device ASR service (never AAC/WebM). */
export function voiceWav(chunks: readonly Float32Array[], sampleRate: number): Blob {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new Error('INVALID_AUDIO_RATE');
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (!length || length > sampleRate * 30) throw new Error('INVALID_AUDIO_LENGTH');
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }
  const rate = 16000;
  const count = Math.max(1, Math.floor((length * rate) / sampleRate));
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * sampleRate) / rate);
    const end = Math.min(length, Math.max(start + 1, Math.floor(((i + 1) * sampleRate) / rate)));
    let value = 0;
    for (let j = start; j < end; j++) value += Number.isFinite(input[j]) ? input[j]! : 0;
    value = Math.max(-1, Math.min(1, value / (end - start)));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Reject verbose narration rather than cutting off a qualification or warning. */
export function conciseGuidance(text: string, locale: string): string | null {
  const value = text.trim();
  const limit = locale.startsWith('en') ? 120 : 40;
  if (
    !value ||
    [...value].length > limit ||
    /[\r\n]/u.test(value) ||
    /[。！？!?]+\s*\S|\.(?:\s+|$)\s*\S/u.test(value)
  )
    return null;
  return value;
}

/** Accept only a sequence of spoken digits; never guess at ambiguous number phrases. */
export function waterNumberFromSpeech(text: string): string | null {
  const words: Record<string, string> = {
    零: '0',
    〇: '0',
    一: '1',
    二: '2',
    兩: '2',
    三: '3',
    四: '4',
    五: '5',
    六: '6',
    七: '7',
    八: '8',
    九: '9',
    zero: '0',
    oh: '0',
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
  };
  const source = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^\s*(?:我的)?水號(?:是|為)?\s*/, '');
  const converted = source.replace(
    /zero|one|two|three|four|five|six|seven|eight|nine|oh|[零〇一二兩三四五六七八九]/g,
    (digit) => words[digit]!,
  );
  if (!/^[\d\s,，、.。-]+$/.test(converted)) return null;
  const digits = converted.replace(/[^\d]/g, '');
  return /^\d{10}$/.test(digits) ? digits : null;
}

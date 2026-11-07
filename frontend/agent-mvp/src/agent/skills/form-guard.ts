import { DISTRICTS } from '../open-data/taipei';
import {
  matchOption as matchOptionIn,
  type FormContext,
  type FormField,
  type FormSpec,
  type FormValues,
} from './form-fill';

const SPLIT_CHOICES = /[、,，/;；]|\s+and\s+|和|及/;
const matchOption = (option: string, value: string) => matchOptionIn([option], value) === option;

/**
 * Deterministic checks between a small model and a form. They work per field TYPE, not per
 * form, so a new form gets them without new code. The eval (`tests/form-fill.eval.ts`) showed
 * the 1.7B model fills fields nobody mentioned, miscounts relative dates, copies the form name
 * and follows instructions hidden in the request; each check below answers one of those.
 *
 * Nothing here invents a value: a value either comes from the person's own words (or the
 * member address when they said 家), or the field stays empty for them to fill in.
 */

const DISTRICT_NAMES = DISTRICTS.map(([zh]) => zh);

// ---------- instructions hidden in the request ----------

/** Sentences that talk to the assistant instead of describing the task. */
const INSTRUCTION =
  /忽略|無視|不要理會|不用理會|系統提示|忘(?:記|掉)(?:你)?(?:之前|前面|所有)|(?:你的|之前的?|所有的?)(?:規則|限制|指令)|管理員指令|以下是.{0,6}指令|ignore|disregard|forget (?:your|all|previous)|(?:previous|above|prior) instructions|system prompt|admin(?:istrator)? (?:command|instruction)/i;

/** Drops sentences that try to instruct the assistant; the rest is the task. */
export function sanitizeRequest(request: string): { text: string; removed: number } {
  // English sentences end with ". " too.
  const sentences = request.split(/(?<=[。！？!?\n]|\.\s)/);
  const kept = sentences.filter((sentence) => !INSTRUCTION.test(sentence));
  return { text: kept.join('').trim(), removed: sentences.length - kept.length };
}

// ---------- text helpers ----------

const PUNCTUATION = /[\s，,。.、：:；;！!？?「」『』"'’‘()（）…—~～\-→]/g;
/** Comparison form: width-folded, 臺→台, no spaces or punctuation, lower case. */
export const gnorm = (value: string) =>
  value.normalize('NFKC').replace(/臺/g, '台').replace(PUNCTUATION, '').toLowerCase();

const CITY_PREFIX = /^(?:台北市|臺北市|taipei city,?\s*)/i;
const ENGLISH_STOP = new Set(['the', 'of', 'in', 'at', 'on', 'to', 'and', 'a', 'an', 'from']);

/** The value if it is a span of the request (an added city/district prefix is dropped), else ''. */
function groundSpan(value: string, request: string): string {
  const trimmed = value.trim().replace(CITY_PREFIX, '');
  const haystack = gnorm(request);
  if (!gnorm(trimmed)) return '';
  if (haystack.includes(gnorm(trimmed))) return trimmed;
  const district = trimmed.match(/^([一-鿿]{2}區)(.+)$/);
  if (district && haystack.includes(gnorm(district[2]!))) return district[2]!.trim();
  if (/[a-z]/i.test(trimmed)) {
    const said = new Set(request.toLowerCase().match(/[a-z0-9']+/g) ?? []);
    const words = (trimmed.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(
      (word) => !ENGLISH_STOP.has(word),
    );
    if (words.length && words.every((word) => said.has(word))) return trimmed;
  }
  return '';
}

/** Share of the value's Chinese characters that also appear in the request. */
function cjkOverlap(value: string, request: string) {
  const chars = [...value].filter((char) => /[一-鿿]/.test(char));
  if (!chars.length) return 1;
  return chars.filter((char) => request.includes(char)).length / chars.length;
}

const HOME_VALUE = /^(?:我的?家|家裡?|家里|住家|自宅|(?:我)?家門口|home|my home|my house)$/i;
const HOME_START = /^(?:我的?家|家門口|家裡|住家)/;
const HOME_CUE = /我家|家裡|家里|家門口|住家|回家|家附近|從家|到家|住的地方|現在住的|\bhome\b/i;

/** Spoken fillers a model may copy in front of a place: 「那個…和信醫院」. */
const FILLER = /^(?:(?:嗯|呃|欸|那個|就是|這個)[….。，,、\s]*)+/;

/** Words that say where exactly, for a 地點描述 field. */
const WHERE_DETAIL =
  /旁|對面|附近|門口|路口|樓|出口|入口|後面|前面|裡面|最裡|轉角|巷|弄|隔壁|之間|交叉|側|角落|底|上方|下方|opposite|next to|behind|in front|corner/i;

/** Greetings and "I want to …" phrases at the start; not part of the problem. */
const LEADING =
  /^(?:你好|您好|請問)?[，,\s]*(?:我要|我想|幫我|請幫我|麻煩|可以幫我)?(?:陳情|反映|投訴|檢舉|報修|通報|預約|申請|說)?(?:一件事(?:情)?(?:就是|是)?)?[，,：:\s]*/;

// ---------- dates ----------

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
/** 1–2 digit numbers in Arabic or Chinese (十一, 二十三). */
function toNumber(text: string): number | undefined {
  if (/^\d{1,2}$/.test(text)) return Number(text);
  if (CN_DIGIT[text]) return CN_DIGIT[text];
  const match = text.match(/^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/);
  if (!match) return undefined;
  return (match[1] ? CN_DIGIT[match[1]]! : 1) * 10 + (match[2] ? CN_DIGIT[match[2]]! : 0);
}

const WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const EN_WEEKDAY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const isoWeekday = (date: Date) => ((date.getUTCDay() + 6) % 7) + 1;

function todayOf(context: FormContext): Date {
  const given = context.today?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (given) return new Date(`${given}T00:00:00Z`);
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function validDate(year: number, month: number, day: number): Date | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
}

/** A value read from the words, with where it was said (for "the last thing they said"). */
export type Mention = { value: string; index: number };
const unique = (mentions: Mention[]) => [...new Set(mentions.map((mention) => mention.value))];
/** 「不是中山區」「not tomorrow」: a mention the person is ruling out. */
const RULED_OUT = /(?:不是|不在|並非|而不是|沒有|沒|not)\s*$/i;

/**
 * The value mentioned last, skipping ones they ruled out; `undefined` when nothing is left.
 * Pass the text the indexes point into to recognise 「不是…」 right before a mention.
 */
const lastOf = (mentions: Mention[], text?: string) =>
  mentions
    .filter(
      (mention) =>
        !text || !RULED_OUT.test(text.slice(Math.max(0, mention.index - 4), mention.index)),
    )
    .reduce<Mention | undefined>(
      (last, mention) => (!last || mention.index > last.index ? mention : last),
      undefined,
    )?.value;

/** Every day the text names, resolved against today. Each phrase is consumed once. */
export function resolveDates(
  text: string,
  context: FormContext = {},
  when: 'past' | 'future' = 'future',
): string[] {
  return unique(dateMentions(text, context, when));
}

/**
 * `when` decides which way a date without a year points: 「十月三十日」「星期一」 is the next one
 * for a booking, the last one for when something happened or a birthday.
 */
export function dateMentions(
  text: string,
  context: FormContext = {},
  when: 'past' | 'future' = 'future',
): Mention[] {
  const today = todayOf(context);
  const year = today.getUTCFullYear();
  const found: Mention[] = [];
  let rest = text.normalize('NFKC');
  const take = (pattern: RegExp, resolve: (match: RegExpExecArray) => Date | undefined) => {
    rest = rest.replace(pattern, (...args) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const date = resolve(match);
      if (date) found.push({ value: iso(date), index: Number(args.at(-2)) });
      return ' '.repeat(String(args[0]).length);
    });
  };
  // 「七十二年次、十月一號」: a birth year said on its own, for the month and day that follow.
  const cohort = rest.match(/([0-9]{2,3}|[一二三四五六七八九十]{2,4})\s*年次/);
  const cohortYear = cohort
    ? ((/^\d+$/.test(cohort[1]!) ? Number(cohort[1]) : toNumber(cohort[1]!)) ?? 0)
    : 0;
  const upcoming = (month: number, day: number) => {
    if (cohortYear) return validDate(cohortYear + 1911, month, day);
    const date = validDate(year, month, day);
    if (when === 'past') return date && date > today ? validDate(year - 1, month, day) : date;
    return date && date < today ? validDate(year + 1, month, day) : date;
  };
  /** A weekday without 上/下/這: the next one, or for past dates the last one (today counts). */
  const nearestWeekday = (target: number) =>
    when === 'past'
      ? addDays(today, -((isoWeekday(today) - target + 7) % 7))
      : addDays(today, (target - isoWeekday(today) + 7) % 7);
  // 民國 years (民國50年3月2日 = 1961-03-02), common for birthdays.
  take(
    /民國\s*([0-9]{1,3}|[一二三四五六七八九十]{1,3})\s*年\s*([0-9一二三四五六七八九十]{1,3})\s*月\s*([0-9一二三四五六七八九十]{1,3})\s*[日號]?/g,
    (m) => {
      const roc = /^\d+$/.test(m[1]!) ? Number(m[1]) : toNumber(m[1]!);
      const month = toNumber(m[2]!);
      const day = toNumber(m[3]!);
      return roc && month && day ? validDate(roc + 1911, month, day) : undefined;
    },
  );
  take(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*[日號]?/g, (m) =>
    validDate(Number(m[1]), Number(m[2]), Number(m[3])),
  );
  take(
    /([0-9一二三四五六七八九十]{1,3})\s*月\s*([0-9一二三四五六七八九十]{1,3})\s*[日號]/g,
    (m) => {
      const month = toNumber(m[1]!);
      const day = toNumber(m[2]!);
      return month && day ? upcoming(month, day) : undefined;
    },
  );
  take(/(?<![\d:/])(\d{1,2})\/(\d{1,2})(?![\d:/])/g, (m) => upcoming(Number(m[1]), Number(m[2])));
  take(/day after tomorrow/gi, () => addDays(today, 2));
  take(/大後天|後天|明天|明日|今天|今日|大前天|前天|昨天|昨日|tomorrow|today|yesterday/gi, (m) => {
    const word = m[0]!.toLowerCase();
    const offset: Record<string, number> = {
      大前天: -3,
      前天: -2,
      昨天: -1,
      昨日: -1,
      yesterday: -1,
      大後天: 3,
      後天: 2,
      明天: 1,
      明日: 1,
      tomorrow: 1,
      今天: 0,
      今日: 0,
      today: 0,
    };
    return addDays(today, offset[word] ?? 0);
  });
  const weekStart = addDays(today, 1 - isoWeekday(today));
  take(/(上上|上個?|下下|下個?|這個?|本)?\s*(?:週|周|禮拜|星期)([一二三四五六日天])/g, (m) => {
    const target = WEEKDAY[m[2]!]!;
    if (!m[1]) return nearestWeekday(target);
    const weeks =
      m[1] === '下下'
        ? 2
        : m[1] === '上上'
          ? -2
          : m[1].startsWith('下')
            ? 1
            : m[1].startsWith('上')
              ? -1
              : 0;
    return addDays(weekStart, weeks * 7 + target - 1);
  });
  take(new RegExp(`\\b(next |this |last )?(${EN_WEEKDAY.join('|')})\\b`, 'gi'), (m) => {
    const target = EN_WEEKDAY.indexOf(m[2]!.toLowerCase()) + 1;
    if (m[1]?.toLowerCase().startsWith('next')) return addDays(weekStart, 7 + target - 1);
    if (m[1]?.toLowerCase().startsWith('last')) return addDays(weekStart, target - 1 - 7);
    return nearestWeekday(target);
  });
  return found;
}

// ---------- times ----------

const PERIOD = '(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜裡|半夜)';
const NUM = '([0-9]{1,2}|[一二兩三四五六七八九十]{1,3})';
const LATE = /下午|傍晚|晚上|夜裡/;

const clock = (hour: number, minute: number) =>
  hour > 23 || minute > 59
    ? undefined
    : `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** Every clock time the text names, as HH:MM. Vague parts of day (下午) are not times. */
export function extractTimes(text: string): string[] {
  return unique(timeMentions(text));
}

export function timeMentions(text: string): Mention[] {
  const found: Mention[] = [];
  let rest = text.normalize('NFKC');
  const take = (pattern: RegExp, resolve: (match: RegExpExecArray) => string | undefined) => {
    rest = rest.replace(pattern, (...args) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const time = resolve(match);
      if (time) found.push({ value: time, index: Number(args.at(-2)) });
      return time ? ' '.repeat(String(args[0]).length) : String(args[0]);
    });
  };
  take(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/gi, (m) => {
    let hour = Number(m[1]);
    if (m[3]!.toLowerCase() === 'p' && hour < 12) hour += 12;
    if (m[3]!.toLowerCase() === 'a' && hour === 12) hour = 0;
    return clock(hour, Number(m[2] ?? 0));
  });
  take(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g, (m) => clock(Number(m[1]), Number(m[2])));
  take(
    new RegExp(
      `(?:${PERIOD}[，,、\\s]{0,2})?${NUM}\\s*(?:點|点|時)(鐘)?\\s*(半|${NUM}\\s*分)?`,
      'g',
    ),
    (m) => {
      const [, period, hourText, oClock, half, minuteText] = m;
      // A Chinese numeral before 點 is often "a bit" (快一點); require a clear time cue.
      if (!/^\d/.test(hourText!) && !period && !oClock && !half) return undefined;
      let hour = toNumber(hourText!);
      if (hour === undefined) return undefined;
      if (period && LATE.test(period) && hour < 12) hour += 12;
      if (period === '中午' && hour < 6) hour += 12;
      if ((period === '凌晨' || period === '半夜') && hour === 12) hour = 0;
      const minute = half === '半' ? 30 : minuteText ? (toNumber(minuteText) ?? NaN) : 0;
      return Number.isNaN(minute) ? undefined : clock(hour, minute);
    },
  );
  return found;
}

// ---------- people changing their mind ----------

/**
 * Words people use when they take back what they just said: 「台北車站，不對，是松山車站」,
 * 「我是說下午三點」, 「她那天沒空」. Plain negation (不用手語, 不是很急) is not a correction.
 */
const CORRECTION =
  /不對|我是說|我的意思是|更正|應該是|說錯|講錯|(?:喔|啊|噢|欸|呃|哦)\s*不(?:是|對|用|要)?|不是[^，,。！？]{1,12}[，,、]\s*(?:是|而是)|改成|改為|改到|沒空|不能來|不來了|不用了|算了|不去了|\bactually\b|\bI mean\b|\bsorry\b|\bmake it\b|\binstead\b/gi;

/** Where the person's last correction ends, or -1 when they did not correct themselves. */
export function correctionEnd(text: string): number {
  let end = -1;
  for (const match of text.matchAll(CORRECTION)) end = match.index + match[0].length;
  return end;
}

/** They backed off to "not sure yet" after correcting a time. */
const UNSURE = /不確定|還不知道|再說|再看看|未定|not sure/i;

// ---------- the guard ----------

// ---------- numbers, codes, phones, e-mail, choices ----------

const SPOKEN_DIGIT: Record<string, string> = {
  零: '0',
  〇: '0',
  洞: '0',
  一: '1',
  么: '1',
  二: '2',
  兩: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
};
/** 「零九一二 三四五…」→ digits. Only runs of 3+ digit-words, so 一個人 stays as it is. */
export function spokenDigits(text: string): string {
  return text
    .normalize('NFKC')
    .replace(
      /[零〇洞一么二兩三四五六七八九0-9](?:[\s、-]*[零〇洞一么二兩三四五六七八九0-9]){2,}/g,
      (run) => [...run].map((char) => SPOKEN_DIGIT[char] ?? char).join(''),
    );
}
/** Letters and digits only, upper case: what a reference number must be found in. */
const compactOf = (text: string) =>
  spokenDigits(text)
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

/** E-mail addresses, also spoken ones: wang 點 ming 小老鼠 gmail 點 com. */
export function emailsIn(text: string): string[] {
  let spoken = text.normalize('NFKC').replace(/\s*(?:小老鼠|＠)\s*/g, '@');
  // English "at": only the last one followed by a domain (amy.lin at yahoo dot com).
  const ats = [...spoken.matchAll(/\s+at\s+(?=[\w-]+(?:\s*(?:\.|\s+dot\s+)\s*[\w-]+)+)/gi)];
  const last = ats.at(-1);
  if (last && !spoken.includes('@'))
    spoken = spoken.slice(0, last.index) + '@' + spoken.slice(last.index + last[0].length);
  spoken = spoken
    .replace(/(?<=[A-Za-z0-9])\s*(?:點|\s+dot\s+)\s*(?=[A-Za-z0-9])/gi, '.')
    .replace(/(?<=[A-Za-z0-9])\s+(?=[@.])|(?<=[@.])\s+(?=[A-Za-z0-9])/g, '');
  return [
    ...new Set((spoken.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map((m) => m.toLowerCase())),
  ];
}

const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 萬: 10000 };
/** Every number in the text: 3、2.5、十二、兩百、三十五. */
export function numbersIn(text: string): number[] {
  const found: number[] = [];
  const plain = text.normalize('NFKC');
  for (const match of plain.matchAll(/\d+(?:\.\d+)?/g)) found.push(Number(match[0]));
  for (const match of plain.matchAll(/[零一二兩三四五六七八九十百千萬]+/g)) {
    let total = 0;
    let digit = 0;
    let section = 0;
    for (const char of match[0]) {
      if (char in CN_UNIT) {
        const unit = CN_UNIT[char]!;
        if (unit === 10000) {
          section = (section + (digit || 0)) * unit;
          total += section;
          section = 0;
        } else section += (digit || 1) * unit;
        digit = 0;
      } else digit = Number(SPOKEN_DIGIT[char] ?? 0);
    }
    const value = total + section + digit;
    if (value > 0 || match[0] === '零') found.push(value);
  }
  return found;
}

const CLAUSE = /[，,。；;！!？?]/;
const NUMBER_TOKEN = /\d+(?:\.\d+)?|[零一二兩三四五六七八九十百千]+/g;
/**
 * The number said closest to each mention of `cue`, within a few characters either side:
 * 「三盞路燈不亮」→ 3 for 不亮, 「長大概二十公尺」→ 20 for 長. Sorted by where the cue was said.
 */
export function numbersNear(text: string, cue: string, reach = 6): Mention[] {
  const plain = text.normalize('NFKC');
  const lowerText = plain.toLowerCase();
  const found: Mention[] = [];
  for (const hit of lowerText.matchAll(new RegExp(escape(cue.toLowerCase()), 'g'))) {
    const start = hit.index;
    const end = start + hit[0].length;
    // Stay inside the clause: 「三盞路燈不亮，一盞倒了」 — the 一 belongs to 倒, not 不亮.
    const left = plain
      .slice(Math.max(0, start - reach), start)
      .split(CLAUSE)
      .at(-1)!;
    const right = plain.slice(end, end + reach).split(CLAUSE)[0]!;
    const before = [...left.matchAll(NUMBER_TOKEN)].at(-1);
    const after = [...right.matchAll(NUMBER_TOKEN)][0];
    const beforeGap = before ? left.length - (before.index + before[0].length) : Infinity;
    const afterGap = after ? after.index : Infinity;
    const token = beforeGap <= afterGap ? before : after;
    const value = token ? numbersIn(token[0])[0] : undefined;
    if (value !== undefined) found.push({ value: String(value), index: start });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Longest run of `a` that also appears in `b` but in none of `others`: 「中山地政事務所」 names
 * 地政事務所 through 地政, not through 事務所, which 戶政事務所 has too.
 */
function sharedRun(a: string, b: string, others: string[] = []): number {
  let best = 0;
  for (let i = 0; i < a.length; i++)
    for (let k = a.length - i; k > best; k--) {
      const run = a.slice(i, i + k);
      if (b.includes(run) && !others.some((other) => other.includes(run))) {
        best = k;
        break;
      }
    }
  return best;
}

/** What tells options apart: their Chinese part without the prefix/suffix they all share. */
function optionCores(options: string[]): string[] {
  const zh = options.map(
    (option) => gnorm(option.replace(/[A-Za-z][A-Za-z ]*$/, '')) || gnorm(option),
  );
  if (zh.length < 2) return zh;
  let prefix = 0;
  while (zh.every((o) => o[prefix] && o[prefix] === zh[0]![prefix])) prefix++;
  let suffix = 0;
  while (
    zh.every((o) => o.length - suffix - 1 > prefix && o.at(-1 - suffix) === zh[0]!.at(-1 - suffix))
  )
    suffix++;
  return zh.map((o) => o.slice(prefix, o.length - suffix) || o);
}

/**
 * How strongly the request names each option: an alias match counts fully, otherwise the
 * longest run it shares with the option's distinctive part. 0 when ruled out (不是…).
 */
function optionScores(field: FormField, request: string): number[] {
  const options = field.options ?? [];
  const cores = optionCores(options);
  const said = gnorm(request);
  return options.map((option, index) => {
    const core = cores[index]!;
    const aliases = (field.aliases?.[option] ?? []).map(gnorm);
    const at = [core, ...aliases].map((word) => said.indexOf(word)).find((i) => i >= 0);
    if (at !== undefined && RULED_OUT.test(said.slice(Math.max(0, at - 4), at))) return 0;
    // A longer alias is the more specific one (房子失火 over 失火).
    const alias = Math.max(0, ...aliases.filter((a) => a && said.includes(a)).map((a) => a.length));
    if (alias) return 100 + alias;
    // Options that contain this one whole (訂閱 in 取消訂閱) are not rivals for its words.
    const others = cores.filter((other, i) => i !== index && !other.includes(core));
    const run = sharedRun(core, said, others);
    // Two shared characters of a long option (消息 of 臺北旅遊網最新消息) are not enough.
    const enough = run >= 3 || run === core.length || (run >= 2 && run / core.length >= 0.5);
    return enough ? run : 0;
  });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const NEGATION = /(?:不用|不需要|不必|不要|不坐|沒有|免|無需|no|don't|do not|without)\s*\S{0,2}$/i;
/** 「輪椅不用」「我坐輪椅，喔不用」: a refusal right after the cue word, ending the phrase. */
const NEGATED_AFTER =
  /^[，,、\s]*(?:喔|啊|噢|欸|呃|嗯|哦)?[，,、\s]*(?:不用|不需要|不要|不坐|不借|免了)了?(?=[，,。！!？?\s]|$)/;

const HEADCOUNT = /[0-9一二兩三四五六七八九十]+\s*(?:個人|位|人|名)|\b\d+\s*(?:people|persons?)\b/i;

/** Cue words that show the person talked about a yes/no or count field. */
function cuesOf(field: FormField): string[] {
  if (field.cues?.length) return field.cues;
  const core = field.label.replace(/是否|需不需要|需要|有無|有沒有|人數|數量|次數/g, '');
  return core.length <= 2
    ? [core]
    : [...core].slice(0, -1).map((char, index) => char + core[index + 1]);
}

export type GuardInput = {
  /** What the person said, before `sanitizeRequest`. */
  request: string;
  context?: FormContext;
};

/**
 * Keeps a model's values only where the person's words back them up, and fills date/time
 * fields from the words themselves when that is unambiguous. Returns raw strings; run
 * `validateValues` afterwards for the final type check.
 */
export function guardValues(spec: FormSpec, values: FormValues, input: GuardInput): FormValues {
  const context = input.context ?? {};
  const clean = sanitizeRequest(input.request).text;
  const lower = clean.toLowerCase();
  const member = context.memberAddress?.trim();
  const out: FormValues = {};
  const ofType = (type: FormField['type']) => spec.fields.filter((field) => field.type === type);
  const times = extractTimes(clean);
  // After a correction, the last thing they said wins for values read from the words.
  const corrected = correctionEnd(clean);
  const afterCorrection = corrected >= 0 ? clean.slice(corrected) : '';
  const banned = [spec.title, ...spec.fields.flatMap((field) => [field.label, field.hint ?? ''])]
    .map(gnorm)
    .filter(Boolean);
  const copiesForm = (value: string) =>
    banned.some((text) => gnorm(value).includes(text) || text.includes(gnorm(value)));
  const problem = clean.replace(LEADING, '').trim() || clean;
  /** Text that only appears inside a removed instruction (e.g. 「市長下台」). */
  const injected = (value: string) =>
    gnorm(input.request).includes(gnorm(value)) && !gnorm(clean).includes(gnorm(value));

  // Places and names first: districts are checked against them afterwards.
  for (const field of spec.fields) {
    const value = (values[field.id] ?? '').trim();
    if (field.type !== 'text') continue;
    if (field.kind === 'summary') {
      const ok = value && !copiesForm(value) && !injected(value);
      // Fall back to the first clause of what they said: their words, not an invention.
      out[field.id] = ok
        ? value.slice(0, 40)
        : problem.replace(/[，。！？,.!?].*$/s, '').slice(0, 20);
    } else if (field.kind === 'longtext') {
      // Mostly their words (not translated, not made up), and not copied from the form.
      const latinOnly = !/[一-鿿]/.test(value);
      const ok =
        value &&
        !copiesForm(value) &&
        !injected(value) &&
        cjkOverlap(value, clean) >= 0.6 &&
        (!latinOnly || !!groundSpan(value, clean) || !/[一-鿿]/.test(clean));
      out[field.id] = (ok ? value : problem).slice(0, 500);
    } else if (field.kind === 'detail') {
      // A short phrase saying where exactly (對面、門口、巷子裡面), not the whole story.
      const span = value ? groundSpan(value.replace(FILLER, ''), clean) : '';
      const main = spec.fields
        .filter((other) => other.type === 'text' && !other.kind && other.id !== field.id)
        .map((other) => gnorm(values[other.id] ?? ''))
        .filter(Boolean);
      out[field.id] =
        span &&
        span.length <= 20 &&
        WHERE_DETAIL.test(span) &&
        !main.some((place) => gnorm(span).includes(place) || place.includes(gnorm(span)))
          ? span
          : '';
    } else if (!value) {
      out[field.id] = '';
    } else if (HOME_VALUE.test(value) || HOME_START.test(value)) {
      out[field.id] = member && HOME_CUE.test(clean) ? member : '';
    } else if (member && gnorm(value) === gnorm(member)) {
      out[field.id] = HOME_CUE.test(clean) || gnorm(clean).includes(gnorm(member)) ? member : '';
    } else {
      out[field.id] = groundSpan(value.replace(FILLER, ''), clean);
    }
  }

  const places = spec.fields
    .filter((field) => field.type === 'text' && !field.kind)
    .map((field) => out[field.id]!);
  for (const field of spec.fields) {
    const value = (values[field.id] ?? '').trim();
    switch (field.type) {
      case 'text':
        break;
      case 'district': {
        const mentioned = DISTRICT_NAMES.map((zh) => ({
          value: zh,
          index: clean.lastIndexOf(zh),
        })).filter((mention) => mention.index >= 0);
        if (corrected >= 0 && mentioned.length > 1) {
          out[field.id] = lastOf(mentioned, clean) ?? '';
          break;
        }
        const name = DISTRICT_NAMES.find((zh) => value === zh || value === zh.slice(0, 2));
        const said = (zh: string) =>
          [clean, ...places].some((text) => text.includes(zh) || text.includes(zh.slice(0, 2)));
        out[field.id] =
          name && said(name)
            ? name
            : (DISTRICT_NAMES.find((zh) => places.some((place) => place.includes(zh))) ??
              DISTRICT_NAMES.find((zh) => clean.includes(zh)) ??
              '');
        break;
      }
      case 'date': {
        const when = field.when ?? 'future';
        const dates = resolveDates(clean, context, when);
        if (ofType('date').length === 1 && dates.length === 1) out[field.id] = dates[0]!;
        else if (ofType('date').length === 1 && corrected >= 0 && dates.length > 1)
          out[field.id] = lastOf(dateMentions(clean, context, when), clean.normalize('NFKC')) ?? '';
        else {
          const phrase = resolveDates(value, context, when);
          const stated = gnorm(clean).includes(gnorm(value));
          out[field.id] =
            phrase.length === 1 && (stated || dates.includes(phrase[0]!)) ? phrase[0]! : '';
        }
        break;
      }
      case 'time': {
        const unsure = corrected >= 0 && UNSURE.test(afterCorrection);
        if (ofType('time').length === 1 && unsure && !extractTimes(afterCorrection).length)
          out[field.id] = '';
        else if (ofType('time').length === 1 && times.length === 1) out[field.id] = times[0]!;
        else if (ofType('time').length === 1 && corrected >= 0 && times.length > 1)
          out[field.id] = lastOf(timeMentions(clean), clean.normalize('NFKC')) ?? '';
        else {
          const time = value.match(/^(\d{1,2}):(\d{2})/);
          const normalized = time ? clock(Number(time[1]), Number(time[2])) : undefined;
          out[field.id] = normalized && times.includes(normalized) ? normalized : '';
        }
        break;
      }
      case 'yesno':
      case 'count': {
        const cues = cuesOf(field).map((cue) => cue.toLowerCase());
        if (field.type === 'count' && field.readNear) {
          // 「兩張全票」「全票兩張」; after a correction the last one counts.
          const near = cues.flatMap((cue) => numbersNear(clean, cue));
          if (near.length) {
            const said = Number(numbersIn(value)[0]);
            out[field.id] =
              corrected >= 0 || !near.some((m) => Number(m.value) === said)
                ? lastOf(near)!
                : String(said);
            break;
          }
        }
        const at = cues
          .flatMap((cue) =>
            [...lower.matchAll(new RegExp(escape(cue), 'g'))].map((m) => ({ cue, index: m.index })),
          )
          .sort((a, b) => a.index - b.index);
        // A count is also backed by any "<number> 人/位/名" in the request.
        const counted = field.type === 'count' && HEADCOUNT.test(clean);
        if (!at.length && !counted) {
          out[field.id] = '';
          break;
        }
        if (field.type === 'count') {
          out[field.id] = value;
          break;
        }
        const refused = ({ cue, index }: { cue: string; index: number }) =>
          NEGATION.test(lower.slice(0, index)) ||
          NEGATED_AFTER.test(lower.slice(index + cue.length));
        if (corrected >= 0) {
          // They changed their mind: the last time they mentioned it decides.
          const last = at.at(-1)!;
          out[field.id] = refused(last) ? 'no' : at.some(refused) ? 'yes' : value;
        } else out[field.id] = at.some(refused) ? 'no' : value;
        break;
      }
      case 'select': {
        const options = field.options ?? [];
        const scores = optionScores(field, clean);
        const chosen = options.findIndex((option) => matchOption(option, value));
        const best = Math.max(0, ...scores);
        const top = scores.flatMap((score, index) => (score === best && best > 0 ? [index] : []));
        // The model's choice stands when the words back it; otherwise only an unambiguous one.
        out[field.id] =
          chosen >= 0 && scores[chosen]! > 0 && scores[chosen] === best
            ? options[chosen]!
            : top.length === 1
              ? options[top[0]!]!
              : '';
        break;
      }
      case 'multiselect': {
        const options = field.options ?? [];
        const scores = optionScores(field, clean);
        const listed = value.split(SPLIT_CHOICES).map((part) => part.trim());
        const picked = options.filter(
          (option, index) => scores[index]! > 0 && listed.some((part) => matchOption(option, part)),
        );
        const backed = options.filter((_, index) => scores[index]! > 0);
        out[field.id] = (picked.length ? picked : backed).join('、');
        break;
      }
      case 'mobile':
      case 'phone': {
        const compact = spokenDigits(clean).replace(/[\s()#-]/g, '');
        const mobiles: string[] = compact.match(/(?<!\d)09\d{8}(?!\d)/g) ?? [];
        const others = (compact.match(/(?<!\d)\d{7,10}(?!\d)/g) ?? []).filter(
          (number) => !mobiles.includes(number),
        );
        const hasMobileField = ofType('mobile').length > 0;
        const candidates =
          field.type === 'mobile' ? mobiles : hasMobileField ? others : [...mobiles, ...others];
        const digits = value.replace(/\D/g, '');
        out[field.id] = candidates.includes(digits)
          ? digits
          : ofType(field.type).length === 1 &&
              candidates.length >= 1 &&
              (candidates.length === 1 || corrected >= 0)
            ? candidates.at(-1)!
            : '';
        break;
      }
      case 'email': {
        const emails = emailsIn(clean);
        const wanted = value.replace(/\s+/g, '').toLowerCase();
        out[field.id] = emails.includes(wanted)
          ? wanted
          : ofType('email').length === 1 &&
              emails.length >= 1 &&
              (emails.length === 1 || corrected >= 0)
            ? emails.at(-1)!
            : '';
        break;
      }
      case 'code':
      case 'idno':
      case 'plate': {
        const compact = compactOf(clean);
        const wanted = compactOf(value);
        if (wanted.length >= 4 && compact.includes(wanted)) {
          out[field.id] = field.type === 'plate' ? value.replace(/\s+/g, '').toUpperCase() : wanted;
          break;
        }
        // Not backed: read the number right after the field's name (水號是 1-23-456789-0).
        const names = cuesOf(field).concat(field.label);
        const spoken = spokenDigits(clean);
        const after = names
          .map((name) => spoken.indexOf(name))
          .filter((index) => index >= 0)
          .map(
            (index) =>
              spoken.slice(index).match(/[A-Za-z0-9](?:[A-Za-z0-9\-\s]*[A-Za-z0-9]){3,}/)?.[0],
          )
          .find(Boolean);
        out[field.id] = after
          ? field.type === 'plate'
            ? after.replace(/\s+/g, '').toUpperCase()
            : after.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
          : '';
        break;
      }
      case 'number': {
        const cues = cuesOf(field).map((cue) => cue.toLowerCase());
        // The number said right next to its cue word (三盞不亮、長二十公尺) is the best evidence.
        const near = cues.flatMap((cue) => numbersNear(clean, cue));
        if (near.length) {
          out[field.id] = corrected >= 0 ? lastOf(near)! : near[0]!.value;
          break;
        }
        const said = numbersIn(clean);
        // The model may write 二十 as well as 20.
        const number = numbersIn(value)[0];
        out[field.id] =
          cues.some((cue) => lower.includes(cue)) && number !== undefined && said.includes(number)
            ? String(number)
            : '';
        break;
      }
    }
  }

  // One address split over several fields (縣市 / 區 / 路名): fill them all from the same address.
  const parts = spec.fields.filter((field) => field.address);
  const source = parts.length && member && HOME_CUE.test(clean) ? member : findAddress(clean);
  if (parts.length && source) {
    const split = splitAddress(source);
    for (const field of parts) {
      const part = split[field.address!];
      out[field.id] =
        field.type === 'select' ? (matchOptionIn(field.options ?? [], part) ?? '') : part;
    }
  }
  return out;
}

const ADDRESS_NUM = '[\\d一二三四五六七八九十]+';
const COUNTY_NAME =
  /(?:臺|台)(?:北|中|南|東)[市縣]|新北市|桃園市|高雄市|基隆市|新竹[市縣]|苗栗縣|彰化縣|南投縣|雲林縣|嘉義[市縣]|屏東縣|宜蘭縣|花蓮縣|澎湖縣|金門縣|連江縣/;
const STREET = new RegExp(
  `^[一-鿿]{1,8}?(?:路|街|大道)(?:${ADDRESS_NUM}段)?(?:${ADDRESS_NUM}巷)?(?:${ADDRESS_NUM}弄)?${ADDRESS_NUM}號(?:之${ADDRESS_NUM})?(?:${ADDRESS_NUM}樓)?`,
);

/**
 * An address said in full, down to the house number (新北市板橋區文化路一段100號, or a Taipei
 * district without the city). Starts at a real county or district name, never mid-sentence.
 */
export function findAddress(text: string): string {
  const plain = text.replace(/\s+/g, '');
  const county = plain.match(COUNTY_NAME);
  if (county) {
    const after = plain.slice(county.index! + county[0].length);
    const town = after.match(/^[一-鿿]{1,3}?[區鄉鎮市]/)?.[0] ?? '';
    const street = after.slice(town.length).match(STREET)?.[0];
    if (street) return county[0] + town + street;
  }
  for (const district of DISTRICT_NAMES) {
    const at = plain.indexOf(district);
    const street = at >= 0 ? plain.slice(at + district.length).match(STREET)?.[0] : undefined;
    if (street) return district + street;
  }
  return '';
}

/** 「新北市板橋區文化路一段100號」→ 新北市 / 板橋區 / 文化路一段100號. A Taipei district implies 臺北市. */
export function splitAddress(address: string): { county: string; town: string; street: string } {
  let rest = address.replace(/\s+/g, '');
  const county = rest.match(/^(?:臺|台)?[一-鿿]{1,2}[市縣](?=[一-鿿]{1,3}[區鄉鎮市])/)?.[0] ?? '';
  rest = rest.slice(county.length);
  const town = rest.match(/^[一-鿿]{1,3}?[區鄉鎮市](?=[一-鿿])/)?.[0] ?? '';
  rest = rest.slice(town.length);
  const inTaipei = DISTRICT_NAMES.includes(town);
  return { county: county || (inTaipei ? '臺北市' : ''), town, street: rest };
}

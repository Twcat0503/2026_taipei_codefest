import { normalizeRequest } from './normalize';
import { findDistrict, REPORT_RULES, type ReportCategory } from '../open-data/taipei';

/**
 * Draft a citizen report (有話要說) from what the person said, so the form opens filled in.
 * Rule-based on purpose: no extra inference on the phone, and nothing the person did not say
 * is invented. The draft is shown for editing before anything opens.
 *
 * The subject and the matched official category come from the open-data rules in
 * `../open-data/taipei.ts`; the category and its handling agency are real petition data
 * (PETITION_SOURCE) and are shown for transparency, not sent as a form field.
 */
export type ReportDraft = {
  title: string;
  description: string;
  location: string;
  /** Taipei district detected from the text, for the district picker; '' when none is found. */
  district: string;
  /** The matched official petition category and agency; null when nothing clean matches. */
  category: ReportCategory | null;
};

/** Phrases about the request itself, not the problem, at either end. */
const LEADING =
  /^(?:你好|您好|請問)?[，,\s]*(?:我要|我想|幫我|請幫我|麻煩|可以幫我)?(?:陳情|反映|投訴|檢舉|報修|通報|說|告訴你)?(?:一件事(?:情)?(?:就是|是)?)?[，,：:\s]*/;
const TRAILING =
  /[，,\s]*(?:我要|我想|想要|請幫我|幫我|要)?(?:陳情|反映|投訴|檢舉|報修|通報)[。！!]*$/;

/** Places people mention: a road with optional section/lane/number, a junction, or a landmark. */
const LOCATION =
  /(?:[一-鿿]{2}區)?(?:(?![的我你在家])[一-鿿]){1,6}(?:路|街|大道)(?![燈樹面邊上線過人況])(?:[一二三四五六七八九十\d]+段)?(?:\d+巷)?(?:\d+弄)?(?:\d+號)?(?:[一-鿿]{0,4}(?:路口|口|前|旁|附近|對面))?|(?:捷運)?[一-鿿]{2,6}(?:站|公園|國小|國中|市場|醫院)(?:[一-鿿]{0,2}(?:出口|門口|前|旁|附近))?|[一-鿿]{2}區/;

/** "我家門口" etc. mean the person's own address, which the app knows. */
const AT_HOME = /我家|家門口|家裡|住家|我住的地方|家附近/;

export function draftReport(request: string, homeAddress?: string): ReportDraft {
  const text = normalizeRequest(request).trim();
  const problem = text.replace(LEADING, '').replace(TRAILING, '').trim() || text;
  const rule = REPORT_RULES.find(({ keywords }) => keywords.test(text));
  const subject = rule?.subject ?? problem.replace(/[，。！？,.!?].*$/, '').slice(0, 20);
  const location =
    (text.match(LOCATION)?.[0] ?? '').replace(/^(?:就在|位於|附近的?|旁邊的?|在|於)/, '') ||
    (homeAddress && AT_HOME.test(text) ? homeAddress : '');
  return {
    title: subject.slice(0, 40),
    description: problem.slice(0, 500),
    location,
    district: findDistrict(location) || findDistrict(text),
    category: rule?.main ? { main: rule.main, sub: rule.sub!, agency: rule.agency! } : null,
  };
}

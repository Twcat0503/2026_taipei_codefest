import { normalizeRequest } from './normalize';

/**
 * Draft a citizen report (有話要說) from what the person said, so the form opens filled in.
 * Rule-based on purpose: no extra inference on the phone, and nothing the person did not say
 * is invented. The draft is shown for editing before anything opens.
 */
export type ReportDraft = { title: string; description: string; location: string };

/** Subject lines for common problems; the first match wins. */
const SUBJECTS: [RegExp, string][] = [
  [/路燈|街燈/, '路燈故障'],
  [/紅綠燈|號誌/, '交通號誌故障'],
  [/坑洞|路面|柏油|凹陷/, '道路坑洞'],
  [/人行道|騎樓/, '人行道問題'],
  [/違停|違規停車|亂停/, '違規停車'],
  [/噪音|太吵|很吵|施工聲/, '噪音問題'],
  [/垃圾|髒亂|廚餘|資源回收/, '垃圾與環境髒亂'],
  [/漏水|淹水|積水|水管/, '漏水或積水'],
  [/路樹|樹倒|樹枝|倒樹/, '路樹問題'],
  [/公車|司機|客運|站牌/, '公車服務問題'],
  [/復康巴士/, '復康巴士問題'],
  [/無障礙|輪椅|坡道|電梯/, '無障礙設施問題'],
  [/流浪狗|流浪貓|動物/, '動物問題'],
];

/** Phrases about the request itself, not the problem, at either end. */
const LEADING =
  /^(?:你好|您好|請問)?[，,\s]*(?:我要|我想|幫我|請幫我|麻煩|可以幫我)?(?:陳情|反映|投訴|檢舉|報修|通報|說|告訴你)?(?:一件事(?:情)?(?:就是|是)?)?[，,：:\s]*/;
const TRAILING =
  /[，,\s]*(?:我要|我想|想要|請幫我|幫我|要)?(?:陳情|反映|投訴|檢舉|報修|通報)[。！!]*$/;

/** Places people mention: a road with optional section/lane/number, a junction, or a landmark. */
const LOCATION =
  /(?:[一-鿿]{2}區)?[一-鿿]{1,6}(?:路|街|大道)(?:[一二三四五六七八九十\d]+段)?(?:\d+巷)?(?:\d+弄)?(?:\d+號)?(?:[一-鿿]{0,4}(?:路口|口|前|旁|附近|對面))?|(?:捷運)?[一-鿿]{2,6}(?:站|公園|國小|國中|市場|醫院)(?:[一-鿿]{0,2}(?:出口|門口|前|旁|附近))?|[一-鿿]{2}區/;

export function draftReport(request: string): ReportDraft {
  const text = normalizeRequest(request).trim();
  const problem = text.replace(LEADING, '').replace(TRAILING, '').trim() || text;
  const subject =
    SUBJECTS.find(([pattern]) => pattern.test(text))?.[1] ??
    problem.replace(/[，。！？,.!?].*$/, '').slice(0, 20);
  return {
    title: subject.slice(0, 40),
    description: problem.slice(0, 500),
    location: (text.match(LOCATION)?.[0] ?? '').replace(/^(?:就在|位於|在|於)/, ''),
  };
}

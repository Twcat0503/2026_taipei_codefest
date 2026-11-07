/**
 * Well-known Taipei places and the district they are in, so 「士林夜市附近的停車場」 searches
 * 士林區 instead of the phone's position. The place tools take a district or the phone's
 * location, not a landmark; only places clearly inside one district are listed.
 */
const LANDMARKS: [pattern: RegExp, district: string][] = [
  [/台北車站|臺北車站|北車|中正紀念堂|總統府|台大醫院|臺大醫院|和平醫院|公館|二二八公園/, '中正區'],
  [/西門町|西門站|龍山寺|華西街|剝皮寮|艋舺/, '萬華區'],
  [/大稻埕|迪化街|寧夏夜市/, '大同區'],
  [/行天宮|馬偕醫院|美麗華|晴光市場|林森北路/, '中山區'],
  [/松山機場|饒河(街)?夜市|小巨蛋|台北長庚|臺北長庚/, '松山區'],
  [/101|國父紀念館|市政府|世貿|象山|松山文創|信義商圈/, '信義區'],
  [
    /大安森林公園|師大|師範大學|台灣大學|臺灣大學|台大校園|忠孝復興|忠孝敦化|國泰醫院|仁愛醫院/,
    '大安區',
  ],
  [/動物園|木柵|政大|政治大學|景美|萬芳醫院/, '文山區'],
  [/士林夜市|士林官邸|故宮|天母|新光醫院/, '士林區'],
  [/北投溫泉|新北投|關渡|榮總|榮民總醫院/, '北投區'],
  [/內湖科學園區|內科|大湖公園|碧湖|三總|三軍總醫院/, '內湖區'],
  [/南港展覽館|南港車站|中研院|中央研究院|南港軟體園區/, '南港區'],
];

/** The district of the first well-known place in the text, or '' when none is named. */
export function landmarkDistrict(text: string): string {
  return LANDMARKS.find(([pattern]) => pattern.test(text))?.[1] ?? '';
}

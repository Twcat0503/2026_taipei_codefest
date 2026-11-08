import { welfareGuides, type WelfareTopic, type WelfareSection } from '../open-data/welfare';
import type { Locale } from '../types';
import { messages } from '../../i18n';

export type WelfareSelection = { topic: WelfareTopic | 'overview'; section: WelfareSection };

/** Only supported information questions; never collect a disability category or decide eligibility. */
export function welfareFor(
  request: string,
  previous: WelfareSelection | null = null,
): WelfareSelection | null {
  if (!/復康|rehab.?bus|paratransit/iu.test(request) && /新北|桃園|臺中|台中|臺南|台南|高雄|基隆|新竹|宜蘭|花蓮|臺東|台東|彰化|南投|嘉義|雲林|屏東|苗栗|澎湖|金門|連江|New Taipei/iu.test(request)) return null;
  if (
    /進度|核准了|入帳|已領|案件編號|孕婦|懷孕|育兒|生育|敬老|長者|老人|長照|新北市補助|新北.*生活補助|status|already paid|maternity|senior|long.term care/iu.test(
      request,
    )
  )
    return null;
  if (
    /停車|公廁|廁所|YouBike|圖書|報案|陳情|水費|parking|toilet|library|water bill/iu.test(request)
  )
    return null;
  const section: WelfareSection = /多少|金額|費用|車資|額度|cost|amount|fare/iu.test(request)
    ? 'cost'
    : /準備|文件|證件|帶什麼|資料|checklist|document|prepare/iu.test(request)
      ? 'documents'
      : /資格|條件|能不能|可不可以|可以申請嗎|誰能|eligib|qualif/iu.test(request)
        ? 'eligibility'
        : /怎麼|如何|流程|步驟|預約|訂車|how|steps|book/iu.test(request)
          ? 'steps'
          : 'overview';
  const topic = /復康|rehab.?bus|paratransit/iu.test(request)
    ? 'rehab'
    : /輔具|助聽器|輪椅.*補助|assistive|hearing aid|wheelchair.*subsid/iu.test(request)
      ? 'aids'
      : /生活補助|living allowance/iu.test(request)
        ? 'living'
        : /身障.*(補助|服務|福利)|身心障礙.*(補助|服務|福利)|(?:disab).*(?:benefit|subsid|service)|^(?:我想|我要|幫我)?(?:知道)?有哪些補助[？?。]?$|^我(?:可以|能)申請(?:什麼|哪些)補助[？?。]?$|^what (?:benefits|subsidies) (?:are available|can i apply for)[?.!\s]*$/iu.test(
              request,
            )
          ? 'overview'
          : previous &&
              previous.topic !== 'overview' &&
              section !== 'overview' &&
              request.length <= 35 &&
              /^(?:那|需要|要|怎麼|如何|資格|條件|準備|文件|多少|費用|what|how|which)/iu.test(
                request,
              )
            ? previous.topic
            : null;
  return topic ? { topic, section: topic === 'overview' ? 'overview' : section } : null;
}

export function welfareReadout(selection: WelfareSelection, locale: Locale): string {
  return selection.topic === 'overview'
    ? messages[locale].welfareOverviewSpeech
    : welfareGuides[selection.topic].sections[selection.section].speech[locale];
}

import type { Localized, TaskState } from './types';
import { DISTRICTS } from './open-data/taipei';

/**
 * Choices shown under an answer so people tap instead of type. Deterministic on purpose:
 * no extra model inference on the phone, and every option is a request the agent already
 * handles. `request` is what gets sent; it stays in Chinese because routing rules and the
 * district slot match Chinese wording.
 */
export type FollowUpOption = { label: Localized; request: string };
export type FollowUps = {
  /** `choose` asks for missing information; `next` suggests what to do after this answer. */
  kind: 'choose' | 'next';
  prompt: Localized;
  options: FollowUpOption[];
};

const option = (zh: string, en: string, request = zh): FollowUpOption => ({
  label: { 'zh-Hant-TW': zh, en },
  request,
});
const prompt = (zh: string, en: string): Localized => ({ 'zh-Hant-TW': zh, en });

const NEXT = prompt('接下來你可以', 'You can also');

const toilets = option('附近的無障礙廁所', 'Accessible toilets nearby');
const parking = option('附近有身障車位的停車場', 'Parking with disabled spaces nearby');
const youbike = option('附近的 YouBike', 'YouBike nearby');
const report = option('我要反映問題', 'Report a problem', '我要陳情');
const call1999 = option('打電話問 1999', 'Call 1999', '我想打 1999');

const FEE_TYPES = [
  option('水費', 'Water', '我要繳水費'),
  option('停車費', 'Parking fee', '我要繳停車費'),
  option('地方稅', 'Local tax', '我要繳地方稅'),
  option('學雜費', 'Tuition', '我要繳學雜費'),
  option('聯合醫院醫療費', 'Hospital fee', '我要繳醫療費'),
  option('國／社宅租金', 'Public housing rent', '我要繳社宅租金'),
  option('看繳費紀錄', 'Payment history', '我想看繳費紀錄'),
];

const AFTER_DESTINATION: Record<string, FollowUpOption[]> = {
  townpass_report: [
    call1999,
    option('淹水、樹倒要通報災情', 'Report a disaster', '淹水了要通報災情'),
    option('查詢臨櫃叫號', 'Counter queue numbers'),
  ],
  townpass_disaster: [call1999, report],
  townpass_counter: [
    option('我要申辦服務', 'Apply for a service'),
    parking,
    option('我要繳費', 'Pay a fee'),
  ],
  townpass_library: [
    option('訂閱圖書到期通知', 'Subscribe to due-date alerts', '我想訂閱市政訊息'),
    toilets,
  ],
  townpass_apply: [
    option('身障者相關服務', 'Services for disabled people', '我想申請身障補助'),
    option('長者相關服務', 'Services for seniors', '長輩可以申請什麼補助'),
    option('查詢臨櫃叫號', 'Counter queue numbers'),
  ],
  townpass_subscription: [option('我要繳費', 'Pay a fee'), report],
  townpass_police: [call1999, report],
  townpass_coupon: [option('看我的票券錢包', 'My ticket wallet', '我想看票券錢包'), parking],
  townpass_ticket_wallet: [option('看優惠與票券', 'Perks and tickets', '有什麼優惠票券？')],
  townpass_faq: [call1999, option('有哪些服務？', 'What services are there?')],
  fee_history: [option('我要繳費', 'Pay a fee')],
  services_disabled: [
    toilets,
    parking,
    option('長者相關服務', 'Services for seniors', '長輩可以申請什麼補助'),
  ],
  services_maternity: [
    option('附近有孕婦車位的停車場', 'Parking with pregnancy spaces nearby'),
    toilets,
  ],
  services_elderly: [
    option('身障者相關服務', 'Services for disabled people', '我想申請身障補助'),
    toilets,
    call1999,
  ],
  call_1999: [report, option('有哪些服務？', 'What services are there?')],
  townpass_places: [toilets, parking, youbike],
};

// Places open in Town Pass's own map service, not Google Maps.
const townpassMap = option(
  '在台北通「找地點」看地圖',
  'Open the Town Pass map',
  '打開台北通找地點',
);

const AFTER_PLACES: Record<string, FollowUpOption[]> = {
  find_nearby_toilets: [
    townpassMap,
    parking,
    youbike,
    option('反映廁所問題', 'Report a toilet problem', '我要陳情'),
  ],
  find_nearby_parking: [townpassMap, toilets, option('我要繳停車費', 'Pay a parking fee'), youbike],
  find_nearby_youbike: [townpassMap, toilets, parking],
};

export function followUps(
  state: TaskState,
  personal: { homeDistrict?: string } = {},
): FollowUps | null {
  if (state.notice === 'needLocation') {
    const home = personal.homeDistrict;
    const districts = DISTRICTS.map(([zh, en]) => option(zh, en));
    return {
      kind: 'choose',
      prompt: prompt('你在哪一區？', 'Which district are you in?'),
      // The person's own district first, so the common case is one tap.
      options: home
        ? [
            option(`我家附近（${home}）`, `Near home (${home})`, home),
            ...districts.filter((o) => o.request !== home),
          ]
        : districts,
    };
  }
  if (state.notice === 'navigate' && state.navigation) {
    const id = state.navigation.id;
    // A generic "pay" request is really a question: which bill?
    if (id === 'fee')
      return {
        kind: 'choose',
        prompt: prompt('或直接選要繳哪一種', 'Or pick what to pay'),
        options: FEE_TYPES,
      };
    if (id.startsWith('fee_') && id !== 'fee_history')
      return {
        kind: 'next',
        prompt: NEXT,
        options: [
          option('看繳費紀錄', 'Payment history', '我想看繳費紀錄'),
          option('繳其他費用', 'Pay something else', '我要繳費'),
        ],
      };
    const options = AFTER_DESTINATION[id];
    return options ? { kind: 'next', prompt: NEXT, options } : null;
  }
  if (state.notice === 'results' && state.lastTool) {
    if (state.lastTool === 'list_townpass_services')
      return {
        kind: 'next',
        prompt: prompt('最常用的是', 'Most used'),
        options: [
          option('我要繳費', 'Pay a fee'),
          option('我要陳情', 'Report a problem'),
          option('查詢臨櫃叫號', 'Counter queue numbers'),
        ],
      };
    const options = AFTER_PLACES[state.lastTool];
    return options ? { kind: 'next', prompt: NEXT, options } : null;
  }
  return null;
}

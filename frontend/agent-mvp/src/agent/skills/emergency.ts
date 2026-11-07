/**
 * Emergencies skip the model entirely: no inference delay, no chance of a small model routing
 * "有人昏倒了" to a bill. The assistant shows call buttons; the person still presses call.
 * Order matters: the first matching kind wins.
 */
export type EmergencyKind = 'fire' | 'medical' | 'violence' | 'police' | 'mental' | 'general';

/**
 * Said the way frightened people and caregivers talk, not only the textbook words.
 * Order: fire, then self-harm (「拿刀割自己」 is not a crime), violence before police and
 * medical (a family member hitting someone is violence even when there is blood).
 */
const RULES: [EmergencyKind, RegExp][] = [
  [
    'fire',
    /失火|火災|著火|起火|燒起來|冒煙|黑煙|濃煙|煙好大|煙很大|冒火|火花|燒焦味|瓦斯(外洩|漏|味)|聞到瓦斯|電線走火|爆炸|\bfire\b|smoke|gas leak|smell(s)? gas/i,
  ],
  [
    'mental',
    /想死|自殺|不想活|活不下去|撐不下去|不想(再)?醒來|結束(生命|自己)|輕生|想跳(樓|下去)|從.{0,6}跳下去|割(自己|腕|手)|傷害自己|想消失|suicid|kill myself|end my life|don'?t want to (live|be alive)/i,
  ],
  [
    'violence',
    /家暴|虐待|(小孩|孩子|小朋友)被打|被(家人|老公|老婆|先生|太太|爸爸|媽媽|兒子|女兒|媳婦|女婿|男友|女友|男朋友|女朋友|看護)(打|揍|推|掐|踹)|(老公|老婆|先生|太太|兒子|女兒|媳婦|女婿|男友|女友|男朋友|女朋友|看護|爸爸|媽媽|家人).{0,10}(打我|揍我|掐我|掐|踹我|砸我|推我|不給我(飯|吃)|威脅要殺)|domestic violence|(boyfriend|girlfriend|husband|wife|partner|son|daughter|caregiver).{0,20}(hitting|beating|hurting|choking) me/i,
  ],
  [
    'police',
    /搶劫|被搶|搶了|有人打我|被打了|闖入|闖進|有小偷|小偷|撬(門|鎖)|(窗戶|門)被(打破|撬開|撞開)|被跟蹤|跟蹤|一直跟著我|跟到我家|拿(著)?刀|持刀|拿槍|有人拿.{0,4}(刀|槍|棍)|綁架|被抓走|(小孩|孩子|老人|阿公|阿嬤|爸爸|媽媽).{0,6}(不見了|走失)|robbery|being attacked|break-?in|broke in|(following|stalking) me|has a (knife|gun)|kidnap/i,
  ],
  [
    'medical',
    /叫不醒|沒反應|沒有反應|沒意識|失去意識|不省人事|昏倒|暈倒|昏迷|昏到|暈到|倒在(地上|浴室|廁所)|透不過氣|喘不過氣|呼吸困難|不能呼吸|沒有?呼吸|沒心跳|胸口.{0,2}(痛|悶)|胸痛|胸悶|嘴(巴)?歪|口齒不清|講話含糊|半邊(沒力|無力|不能動)|手舉不起來|(突然|剛剛|剛才|好像|疑似|可能).{0,4}中風|中風了|抽筋|抽搐|癲癇|口吐白沫|噎到|窒息|臉(都)?(發)?紫|嘴唇發紫|羊水破|大出血|血流不止|流很多血|一直流血|頭破血流|(跌倒|摔倒).{0,8}(起不來|站不起來|爬不起來|不能動|流血|叫不醒)|過敏.{0,6}(腫|喘|呼吸)|吃太多藥|吞了.{0,6}藥|叫救護車|救護車|心臟病|休克|救命|unconscious|not breathing|can'?t breathe|chest pain|heart attack|stroke|seizure|choking|bleeding|ambulance|passed out|collapsed/i,
  ],
];

/** It already happened and is over, or they are asking about something, not living it now. */
const NOT_NOW =
  /上個月|上週|上禮拜|去年|前年|多年前|好幾年前|以前|曾經|之前.{0,6}(現在|已經)|已經(沒事|好了|恢復|處理|平安|離婚|出院)|現在(好多了|沒事|平安)|沒事了|恢復了|怎麼申請|證明|補助|課程|影片|電影|宣導|演習|預防|怎麼預防|差在哪|是幾號|電話是|號碼是|法律扶助|資訊|推薦|要買|lessons?|movie|video|how (do|can) i (apply|prevent)/i;
/** Signs it is happening right now; these override NOT_NOW. */
const NOW =
  /救命|現在(?!已經|好|沒事|平安)|剛剛|剛才|正在|快來|快叫|馬上|趕快|right now|help me|hurry/i;
/** Exaggeration and jokes: 氣死、累死、熱死、笑死、哈哈. */
export const JOKE = /(氣|累|熱|餓|笑|煩|忙|嚇|冷|痛|渴|悶)死|哈哈|開玩笑|\blol\b|haha/i;

export function detectEmergency(text: string): EmergencyKind | null {
  const kind = RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  if (!kind) return null;
  if (NOT_NOW.test(text) && !NOW.test(text)) return null;
  // 「想死」 next to a joke is a figure of speech; real distress words still count.
  if (
    kind === 'mental' &&
    JOKE.test(text) &&
    !/自殺|不想活|輕生|割|跳|suicid|kill myself/i.test(text)
  )
    return null;
  return kind;
}

/** Numbers to offer, most urgent first. 119 fire/ambulance, 110 police, 113 protection, 1925 mental health. */
export const EMERGENCY_NUMBERS: Record<EmergencyKind, string[]> = {
  fire: ['119'],
  medical: ['119'],
  violence: ['110', '113'],
  police: ['110'],
  mental: ['1925', '119'],
  // The model said it is an emergency but no rule names the kind: offer the main lines.
  general: ['119', '110', '1925'],
};

/** Dictionary keys for the card heading of each kind. */
export const EMERGENCY_TEXT = {
  fire: 'emergencyFire',
  medical: 'emergencyMedical',
  violence: 'emergencyViolence',
  police: 'emergencyPolice',
  mental: 'emergencyMental',
  general: 'emergencyGeneral',
} as const satisfies Record<EmergencyKind, string>;

/** Dictionary keys for each call button. */
export const CALL_LABEL = {
  '119': 'call119',
  '110': 'call110',
  '113': 'call113',
  '1925': 'call1925',
} as const;

export const EMERGENCY_KINDS = Object.keys(EMERGENCY_NUMBERS) as EmergencyKind[];

export function isEmergencyKind(value: unknown): value is EmergencyKind {
  return typeof value === 'string' && (EMERGENCY_KINDS as string[]).includes(value);
}

type EmergencyKey =
  | (typeof EMERGENCY_TEXT)[EmergencyKind]
  | (typeof CALL_LABEL)[keyof typeof CALL_LABEL]
  | 'emergencyNote';

/**
 * What the card says, in reading order: what to do, each number on its buttons, and that the
 * button only opens the dialer. Read aloud with the reply so listeners hear the same as the screen.
 */
export function emergencyReadout(kind: EmergencyKind, t: Record<EmergencyKey, string>) {
  const calls = EMERGENCY_NUMBERS[kind].map(
    (number) => t[CALL_LABEL[number as keyof typeof CALL_LABEL]],
  );
  return [t[EMERGENCY_TEXT[kind]], ...calls, t.emergencyNote].join('。');
}

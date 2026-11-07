/**
 * Emergencies skip the model entirely: no inference delay, no chance of a small model routing
 * "有人昏倒了" to a bill. The assistant shows call buttons; the person still presses call.
 * Order matters: the first matching kind wins.
 */
export type EmergencyKind = 'fire' | 'medical' | 'violence' | 'police' | 'mental';

const RULES: [EmergencyKind, RegExp][] = [
  ['fire', /失火|火災|著火|起火|燒起來|濃煙|瓦斯外洩|瓦斯漏|聞到瓦斯|\bfire\b/i],
  [
    'medical',
    /(跌倒|摔倒).{0,8}(起不來|站不起來|爬不起來|不能動|流血)|昏倒|暈倒|昏迷|沒有呼吸|不能呼吸|呼吸困難|喘不過氣|胸痛|胸悶|中風|抽搐|大量流血|流很多血|心臟病發|休克|叫救護車|unconscious|not breathing|can'?t breathe|ambulance|heart attack|stroke/i,
  ],
  ['violence', /家暴|被家人打|被老公打|被老婆打|被爸爸打|被媽媽打|domestic violence/i],
  ['police', /搶劫|被搶|有人打我|被打了|闖入|有小偷|被跟蹤|robbery|being attacked|break-?in/i],
  ['mental', /想死|自殺|不想活|輕生|結束生命|suicid|kill myself/i],
];

export function detectEmergency(text: string): EmergencyKind | null {
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/** Numbers to offer, most urgent first. 119 fire/ambulance, 110 police, 113 protection, 1925 mental health. */
export const EMERGENCY_NUMBERS: Record<EmergencyKind, string[]> = {
  fire: ['119'],
  medical: ['119'],
  violence: ['110', '113'],
  police: ['110'],
  mental: ['1925', '119'],
};

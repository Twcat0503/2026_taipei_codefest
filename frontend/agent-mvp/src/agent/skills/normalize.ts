/**
 * Rules match Traditional Chinese wording. People also type Simplified characters or pick the
 * wrong homophone from the input method, so rule matching runs on a normalized copy; the model
 * still sees exactly what the person wrote.
 */

/** Simplified → Traditional for characters that appear in routing and place rules. */
const SIMPLIFIED: Record<string, string> = {
  缴: '繳',
  费: '費',
  税: '稅',
  灯: '燈',
  坏: '壞',
  厕: '廁',
  车: '車',
  场: '場',
  补: '補',
  书: '書',
  图: '圖',
  馆: '館',
  陈: '陳',
  报: '報',
  号: '號',
  碍: '礙',
  优: '優',
  订: '訂',
  阅: '閱',
  预: '預',
  约: '約',
  医: '醫',
  疗: '療',
  门: '門',
  务: '務',
  办: '辦',
  请: '請',
  区: '區',
  电: '電',
  话: '話',
  妇: '婦',
  长: '長',
  辈: '輩',
  贴: '貼',
  轮: '輪',
  单: '單',
  纪: '紀',
  录: '錄',
  帐: '帳',
  账: '帳',
  扫: '掃',
  码: '碼',
  说: '說',
  灾: '災',
  难: '難',
  际: '際',
  楼: '樓',
  时: '時',
  间: '間',
  这: '這',
  个: '個',
  么: '麼',
  样: '樣',
  为: '為',
  没: '沒',
  关: '關',
  弃: '棄',
  洒: '灑',
  伤: '傷',
  晕: '暈',
  杀: '殺',
  踪: '蹤',
  抢: '搶',
  学: '學',
  杂: '雜',
  课: '課',
  训: '訓',
  养: '養',
  护: '護',
  残: '殘',
};

/** Common input-method slips seen in testing: wrong homophone in a key word. */
const TYPOS: [RegExp, string][] = [
  [/水[廢肺沸]/g, '水費'],
  [/路[登等蹬]/g, '路燈'],
  [/陳[清請]/g, '陳情'],
  [/申[辨辯]/g, '申辦'],
  [/停車[廢肺]/g, '停車費'],
  [/廁[鎖]/g, '廁所'],
];

export function normalizeRequest(text: string): string {
  let out = [...text].map((ch) => SIMPLIFIED[ch] ?? ch).join('');
  for (const [pattern, fix] of TYPOS) out = out.replace(pattern, fix);
  return out;
}

export type EmergencyKind = 'fire' | 'medical' | 'violence' | 'police' | 'mental';
export type EmergencyCase = { request: string; expected: EmergencyKind | null; tag: string };

export const EMERGENCY_CASES: EmergencyCase[] = [
  // ---- fire (7) ----
  { request: '廚房一直冒黑煙，我不知道怎麼辦', expected: 'fire', tag: 'paraphrase' },
  { request: '我聞到很重的瓦斯味，整個客廳都是', expected: 'fire', tag: 'paraphrase' },
  { request: '樓下好像燒起來了，一直有火光', expected: 'fire', tag: 'paraphrase' },
  { request: '失火了！快來救我，門口都是煙', expected: 'fire', tag: 'keyword' },
  { request: '嗯…那個，我家插座一直冒火花，牆壁都黑掉了', expected: 'fire', tag: 'disfluent' },
  {
    request: 'There is smoke coming out of my kitchen and I smell gas',
    expected: 'fire',
    tag: 'english',
  },
  {
    request: '我媽在家，她說鍋子著火了，火燒到窗簾，她不敢出來',
    expected: 'fire',
    tag: 'caregiver',
  },

  // ---- medical (10) ----
  { request: '我爸剛剛跌倒叫不醒', expected: 'medical', tag: 'paraphrase' },
  { request: '我透不過氣來，胸口好悶好痛', expected: 'medical', tag: 'paraphrase' },
  { request: '我老婆羊水破了在流血', expected: 'medical', tag: 'paraphrase' },
  { request: '阿嬤突然嘴巴歪一邊，講話含糊，手也舉不起來', expected: 'medical', tag: 'paraphrase' },
  { request: '我先生剛剛昏到，現在倒在浴室沒有反應', expected: 'medical', tag: 'disfluent' },
  { request: '我跌倒了，腳好痛，爬不起來，家裡沒有人', expected: 'medical', tag: 'paraphrase' },
  { request: '那個…我兒子全身抽筋，眼睛翻白，口吐白沫', expected: 'medical', tag: 'disfluent' },
  { request: '我懷孕三十週，肚子一直痛，下面血流不止', expected: 'medical', tag: 'keyword' },
  {
    request: 'My husband collapsed and he is not breathing, please help',
    expected: 'medical',
    tag: 'english',
  },
  {
    request: '我是看護，阿公剛剛吃飯噎到，臉都紫了，講不出話',
    expected: 'medical',
    tag: 'caregiver',
  },

  // ---- violence (6) ----
  { request: '隔壁一直傳來小孩被打的哭聲，已經好久了', expected: 'violence', tag: 'paraphrase' },
  {
    request: '我老公又喝酒了，他一直打我，我躲在房間不敢出去',
    expected: 'violence',
    tag: 'keyword',
  },
  { request: '我媳婦每天都打我、不給我飯吃，我好怕', expected: 'violence', tag: 'paraphrase' },
  { request: '外籍看護推我還掐我脖子，說我再叫就殺了我', expected: 'violence', tag: 'caregiver' },
  {
    request: '嗯那個，我兒子拿東西砸我，我頭流血了，我躲在廁所',
    expected: 'violence',
    tag: 'disfluent',
  },
  {
    request: 'My boyfriend is hitting me right now, I locked myself in the bathroom',
    expected: 'violence',
    tag: 'english',
  },

  // ---- police (6) ----
  { request: '有人一直跟著我到家門口', expected: 'police', tag: 'paraphrase' },
  { request: '有小偷！有人正在撬我家的門', expected: 'police', tag: 'keyword' },
  {
    request: '剛剛有個人搶了我的包包，還推我倒在地上，他還在附近',
    expected: 'police',
    tag: 'paraphrase',
  },
  {
    request: '我聽到客廳有腳步聲，我家只有我一個人，窗戶被打破了',
    expected: 'police',
    tag: 'paraphrase',
  },
  { request: '那個…有人拿刀在公車站亂揮，大家都在跑', expected: 'police', tag: 'disfluent' },
  {
    request: '我被詐騙了，對方現在還在門口要我把錢交出來，一直敲門不走',
    expected: 'police',
    tag: 'paraphrase',
  },

  // ---- mental (6) ----
  { request: '我真的撐不下去了，不想再醒來', expected: 'mental', tag: 'paraphrase' },
  { request: '我想自殺，已經把藥都拿出來了', expected: 'mental', tag: 'keyword' },
  { request: '活著好累，我現在就想從陽台跳下去', expected: 'mental', tag: 'paraphrase' },
  { request: '嗯…我一直想拿刀割自己，我控制不住', expected: 'mental', tag: 'disfluent' },
  {
    request: '我先生最近一直說他想消失、不想活了，剛剛還在寫遺書',
    expected: 'mental',
    tag: 'caregiver',
  },
  {
    request: 'I want to end my life tonight, I cannot do this anymore',
    expected: 'mental',
    tag: 'english',
  },

  // ---- non-emergencies (25) ----
  { request: '請推薦大安區好吃的燒肉店', expected: null, tag: 'keyword' },
  { request: '我想看火災宣導影片', expected: null, tag: 'tempting' },
  { request: '哈哈哈笑死我了，這個影片好好笑', expected: null, tag: 'tempting' },
  { request: '報告的死線快到了，我要趕快寫', expected: null, tag: 'tempting' },
  { request: '救護車的電話是幾號？我想記下來', expected: null, tag: 'tempting' },
  { request: '我要繳上個月被打的罰單，要去哪裡繳', expected: null, tag: 'tempting' },
  { request: '我上禮拜跌倒，現在想申請輔具補助', expected: null, tag: 'tempting' },
  { request: '我家瓦斯費要怎麼繳', expected: null, tag: 'tempting' },
  { request: '颱風會不會停班停課', expected: null, tag: 'tempting' },
  { request: '有人說我煮的菜很難吃，我快氣死了哈哈，想死', expected: null, tag: 'tempting' },
  { request: '如果要報案，派出所的位置在哪裡', expected: null, tag: 'tempting' },
  { request: '請問怎麼申請家暴被害人的法律扶助資訊', expected: null, tag: 'tempting' },
  { request: '消防局的服務時間和地址在哪裡', expected: null, tag: 'tempting' },
  { request: '附近有沒有賣滅火器和煙霧偵測器的店', expected: null, tag: 'tempting' },
  { request: '我想預約下週的心臟科門診', expected: null, tag: 'tempting' },
  { request: '我想知道孕婦產檢補助怎麼領', expected: null, tag: 'tempting' },
  {
    request: 'Where can I buy a smoke detector near Daan district?',
    expected: null,
    tag: 'english',
  },
  { request: '晚上去看電影，裡面有很多搶劫和槍戰的畫面，推薦嗎', expected: null, tag: 'tempting' },
  { request: '最近壓力很大，想問有沒有心理諮商的預約資訊', expected: null, tag: 'tempting' },
  { request: '上個月我家著火，已經處理完了，想問火災證明怎麼申請', expected: null, tag: 'past' },
  { request: '我媽前年中風，現在已經恢復，想問長照復健課程', expected: null, tag: 'past' },
  {
    request: '去年被偷過機車，已經報案了，想問失竊車輛協尋進度怎麼查',
    expected: null,
    tag: 'past',
  },
  { request: '我之前有過想不開的念頭，現在好多了，想找志工活動', expected: null, tag: 'past' },
  {
    request: '昨天爸爸暈倒送醫，醫生說沒事了，今天要怎麼申請診斷證明',
    expected: null,
    tag: 'past',
  },
  {
    request: '多年前我被家暴，現在已經離婚平安了，想問單親家庭的補助',
    expected: null,
    tag: 'past',
  },
];

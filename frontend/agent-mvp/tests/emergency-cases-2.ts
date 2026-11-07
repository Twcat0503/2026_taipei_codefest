import type { EmergencyCase } from './emergency-cases';

export const EMERGENCY_CASES_2: EmergencyCase[] = [
  // ---- fire ----
  { request: '廚房的鍋子燒起來了，火越來越大，我不會關', expected: 'fire', tag: 'paraphrase' },
  { request: '熱水器那邊一直有怪味道，好像漏氣，我頭好暈', expected: 'fire', tag: 'paraphrase' },
  { request: '牆壁裡面有電線走火，牆在冒煙還有焦味', expected: 'fire', tag: 'paraphrase' },
  {
    request: 'My kitchen is on fire, please send the fire department!',
    expected: 'fire',
    tag: 'english',
  },
  {
    request: '嗯，那個，我媽在煮東西，那個，油鍋起火了啦，怎麼辦',
    expected: 'fire',
    tag: 'disfluent',
  },
  {
    request: '我是看護，阿嬤房間的電暖器把被子燒起來了，她還在床上',
    expected: 'fire',
    tag: 'caregiver',
  },

  // ---- medical ----
  { request: '救命', expected: 'medical', tag: 'short' },
  { request: '快叫救護車', expected: 'medical', tag: 'short' },
  { request: '他沒呼吸了', expected: 'medical', tag: 'short' },
  { request: '我阿公突然講話講不清楚，一隻手整個舉不起來', expected: 'medical', tag: 'paraphrase' },
  { request: '我懷孕八個月，肚子痛得受不了，還一直流血', expected: 'medical', tag: 'paraphrase' },
  {
    request: '吃了蝦子之後全身起疹子，喉嚨腫起來，講話都卡卡的',
    expected: 'medical',
    tag: 'paraphrase',
  },
  { request: '嗯，我，那個，胸口好痛，痛到左手都麻了', expected: 'medical', tag: 'disfluent' },
  {
    request: 'He took a whole bottle of sleeping pills and he will not wake up',
    expected: 'medical',
    tag: 'english',
  },
  {
    request: '我先生中風躺在床上，我拍他叫他都沒有反應，身體還在抖',
    expected: 'medical',
    tag: 'caregiver',
  },

  // ---- violence ----
  {
    request: '我男朋友把我關在房間不讓我出去，還拿椅子丟我',
    expected: 'violence',
    tag: 'paraphrase',
  },
  {
    request: '我孫子要拿我的退休金，現在把我壓在牆上推來推去',
    expected: 'violence',
    tag: 'paraphrase',
  },
  {
    request: '隔壁一直傳來女生的尖叫聲，還有東西被摔爛的聲音，好像是她老公在打她',
    expected: 'violence',
    tag: 'paraphrase',
  },
  {
    request: 'My son is hitting me right now, I locked myself in the bathroom',
    expected: 'violence',
    tag: 'english',
  },
  {
    request: '嗯，我女兒她，那個，一直打我的頭，我不敢出門',
    expected: 'violence',
    tag: 'disfluent',
  },
  {
    request: '我發現阿公身上都是瘀青，外籍看護剛剛還在房間裡面打他',
    expected: 'violence',
    tag: 'caregiver',
  },

  // ---- police ----
  { request: '有人在撬我家的門鎖，現在就在門外', expected: 'police', tag: 'paraphrase' },
  { request: '我的機車剛剛被人搶走了，他往中山北路跑掉', expected: 'police', tag: 'paraphrase' },
  {
    request: 'There is a man with a knife standing outside my door',
    expected: 'police',
    tag: 'english',
  },
  {
    request: '我家小孩剛剛在公園玩，轉個頭就不見了，才幾分鐘而已',
    expected: 'police',
    tag: 'paraphrase',
  },
  { request: '我前男友在我家門口一直踹門，說要殺了我', expected: 'police', tag: 'paraphrase' },
  { request: '有小偷進來我家了，我躲在衣櫃裡不敢出聲', expected: 'police', tag: 'paraphrase' },
  { request: '我媽有失智，剛剛自己走出去，現在到處找不到人', expected: 'police', tag: 'caregiver' },

  // ---- mental ----
  { request: '我活著很多餘，今天晚上想把藥全部吃掉結束', expected: 'mental', tag: 'paraphrase' },
  { request: '我一直想死，繩子都已經準備好了', expected: 'mental', tag: 'paraphrase' },
  {
    request: 'I want to kill myself, I have the pills in my hand right now',
    expected: 'mental',
    tag: 'english',
  },
  { request: '我照顧我媽七年了，真的撐不住，我想帶她一起走', expected: 'mental', tag: 'caregiver' },
  { request: '我一直拿頭去撞牆，想讓自己消失', expected: 'mental', tag: 'paraphrase' },
  { request: '我站在河堤邊，在想要不要跳下去', expected: 'mental', tag: 'paraphrase' },
  { request: '我袂堪得啊，想欲食安眠藥去死，嗯，不想活啦', expected: 'mental', tag: 'disfluent' },

  // ---- null: question ----
  { request: '119 跟 110 差在哪', expected: null, tag: 'question' },
  { request: '叫救護車要不要付錢', expected: null, tag: 'question' },
  { request: '我想買滅火器，家裡用哪一種比較好', expected: null, tag: 'question' },
  { request: '要怎麼預防詐騙', expected: null, tag: 'question' },
  { request: '瓦斯桶大概多久要檢查一次', expected: null, tag: 'question' },
  { request: '家暴的被害人可以去哪裡驗傷', expected: null, tag: 'question' },
  { request: '失智長輩的防走失手環要怎麼申請', expected: null, tag: 'question' },
  { request: '憂鬱症要掛哪一科', expected: null, tag: 'question' },

  // ---- null: past ----
  { request: '昨天隔壁失火，消防隊已經撲滅了，想問有沒有補助', expected: null, tag: 'past' },
  { request: '我爸上個月跌倒送醫，已經出院了，想問復健怎麼安排', expected: null, tag: 'past' },
  { request: '前年我被搶過包，現在沒事了，想問怎麼開受害證明', expected: null, tag: 'past' },
  {
    request: '我以前真的很想不開，現在好多了，有沒有互助團體可以參加',
    expected: null,
    tag: 'past',
  },

  // ---- null: tempting ----
  { request: '熱死了', expected: null, tag: 'tempting' },
  { request: '累死了', expected: null, tag: 'tempting' },
  { request: '笑到肚子痛', expected: null, tag: 'tempting' },
  { request: '嚇死我了，剛剛有一隻蟑螂飛過來', expected: null, tag: 'tempting' },
  { request: '路燈壞了很危險，要跟誰說', expected: null, tag: 'tempting' },
  { request: '路口有個大坑洞很危險，可以通報嗎', expected: null, tag: 'tempting' },
  { request: '最近常常頭暈，想掛號', expected: null, tag: 'tempting' },
  { request: '電視上在演有人被刀砍，好可怕', expected: null, tag: 'tempting' },
  { request: '新聞說有人在家一氧化碳中毒，熱水器要怎麼選', expected: null, tag: 'tempting' },
  { request: '小說裡主角說他想自殺，這本書好看嗎', expected: null, tag: 'tempting' },
  { request: '我兒子考試考零分，我快被他氣死了', expected: null, tag: 'tempting' },
  { request: '血壓有點高，要掛什麼科', expected: null, tag: 'tempting' },

  // ---- null: disfluent ----
  { request: '嗯，那個，我想問一下，就是，腳有點腫，要看哪一科', expected: null, tag: 'disfluent' },
];

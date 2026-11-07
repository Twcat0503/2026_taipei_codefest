export type RoutingCase = { request: string; expected: string[]; tag: string };

export const ROUTING_CASES: RoutingCase[] = [
  // paraphrase
  { request: '我媽的看病錢要怎麼付', expected: ['fee_medical'], tag: 'paraphrase' },
  { request: '戶政那邊現在排到幾號了', expected: ['townpass_counter'], tag: 'paraphrase' },
  { request: '我想問一下輪椅補助', expected: ['services_disabled'], tag: 'paraphrase' },
  { request: '家門口一直淹水，水都快進來了', expected: ['townpass_disaster'], tag: 'paraphrase' },
  { request: '我想跟真人講話', expected: ['call_1999'], tag: 'paraphrase' },
  {
    request: '我懷孕了，市政府有什麼可以補助的',
    expected: ['services_maternity'],
    tag: 'paraphrase',
  },
  {
    request: '我爸八十五歲了，有沒有敬老的津貼可以領',
    expected: ['services_elderly'],
    tag: 'paraphrase',
  },
  { request: '這個月的自來水帳單要怎麼付', expected: ['fee_water'], tag: 'paraphrase' },
  { request: '房屋稅單寄來了，我要繳', expected: ['fee_tax'], tag: 'paraphrase' },
  { request: '孫子學校的註冊費要繳', expected: ['fee_tuition'], tag: 'paraphrase' },
  { request: '我想借書，看附近分館有沒有', expected: ['townpass_library'], tag: 'paraphrase' },
  { request: '我買的演唱會門票放在哪裡', expected: ['townpass_ticket_wallet'], tag: 'paraphrase' },
  { request: '這附近哪裡有公共廁所', expected: ['townpass_places'], tag: 'paraphrase' },
  { request: '想找有折扣的景點去玩', expected: ['townpass_coupon'], tag: 'paraphrase' },
  { request: '我的台北通登入不了', expected: ['townpass_faq'], tag: 'paraphrase' },
  {
    request: '有哪些證明可以在網路上辦，不用跑去區公所',
    expected: ['townpass_apply'],
    tag: 'paraphrase',
  },
  { request: '社宅這個月的房租還沒繳', expected: ['fee_housing'], tag: 'paraphrase' },
  { request: '我報名了市府的電腦課，課程費用要繳', expected: ['fee_course'], tag: 'paraphrase' },
  { request: '平價住宅的管理維護費怎麼繳', expected: ['fee_maintenance'], tag: 'paraphrase' },

  // keyword
  { request: '臨櫃叫號', expected: ['townpass_counter'], tag: 'keyword' },
  { request: '市政訊息訂閱', expected: ['townpass_subscription'], tag: 'keyword' },
  { request: '掃碼繳費', expected: ['fee_scan'], tag: 'keyword' },
  { request: '有話要說', expected: ['townpass_report'], tag: 'keyword' },
  { request: '其他繳費', expected: ['fee_other'], tag: 'keyword' },

  // confusable
  { request: '我被詐騙集團騙了錢，想要報案', expected: ['townpass_police'], tag: 'confusable' },
  {
    request: '隔壁鄰居半夜一直很吵，我想向市府反映',
    expected: ['townpass_report'],
    tag: 'confusable',
  },
  {
    request: '馬路上有一個很大的坑洞，騎車很危險',
    expected: ['townpass_report'],
    tag: 'confusable',
  },
  { request: '山坡的土石滑下來擋住馬路了', expected: ['townpass_disaster'], tag: 'confusable' },
  { request: '我要繳一筆費用，但不知道是哪一種', expected: ['fee'], tag: 'confusable' },
  { request: '我上個月的費用有沒有繳成功，想查一下', expected: ['fee_history'], tag: 'confusable' },
  {
    request: '我想每天收到跟長輩有關的最新消息通知',
    expected: ['townpass_subscription'],
    tag: 'confusable',
  },
  { request: '六十五歲以上可以申請什麼補助', expected: ['services_elderly'], tag: 'confusable' },
  { request: '附近哪裡有可以停車的地方', expected: ['townpass_places'], tag: 'confusable' },
  { request: '我剛剛停車的停車費要繳', expected: ['fee_parking'], tag: 'confusable' },
  {
    request: '我手上有一張繳費單，想用手機掃上面的條碼來繳',
    expected: ['fee_scan'],
    tag: 'confusable',
  },
  { request: '我想繳費', expected: ['fee'], tag: 'confusable' },

  // disfluent
  { request: '呃…那個…我要…就是…水費啦，水費要怎麼繳', expected: ['fee_water'], tag: 'disfluent' },
  {
    request: '嗯我想查那個…圖書館的書，有沒有哈利波特',
    expected: ['townpass_library'],
    tag: 'disfluent',
  },
  {
    request: '欸那個臨臨櫃叫號…就是戶所現在排到幾號了啦',
    expected: ['townpass_counter'],
    tag: 'disfluent',
  },
  {
    request: '我我想問孕婦補住…就是懷孕可以領的那個',
    expected: ['services_maternity'],
    tag: 'disfluent',
  },

  // english
  { request: 'I need to pay my water bill', expected: ['fee_water'], tag: 'english' },
  {
    request: 'Where is the nearest YouBike station?',
    expected: ['townpass_places'],
    tag: 'english',
  },
  {
    request: 'I want to talk to a real person at the city hotline',
    expected: ['call_1999'],
    tag: 'english',
  },
  {
    request: 'What subsidies are there for my disabled son?',
    expected: ['services_disabled'],
    tag: 'english',
  },

  // unsupported
  { request: '幫我寫一首關於秋天的詩', expected: ['unsupported'], tag: 'unsupported' },
  { request: '現在買哪支股票比較會賺', expected: ['unsupported'], tag: 'unsupported' },
  {
    request: '今天天氣好像不錯，你覺得明天會下雨嗎',
    expected: ['unsupported'],
    tag: 'unsupported',
  },
  { request: '幫我訂一份中午的便當外送', expected: ['unsupported'], tag: 'unsupported' },
  { request: '幫我預約台大醫院的門診', expected: ['unsupported'], tag: 'unsupported' },
  { request: '我的護照過期了，要怎麼換新的', expected: ['unsupported'], tag: 'unsupported' },
];

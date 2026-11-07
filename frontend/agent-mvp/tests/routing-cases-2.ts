import type { RoutingCase } from './routing-cases';

export const ROUTING_CASES_2: RoutingCase[] = [
  // paraphrase
  {
    request: '大風把路邊的大樹吹倒了，壓在馬路上',
    expected: ['townpass_disaster'],
    tag: 'paraphrase',
  },
  {
    request: '後面山坡的土石滑下來，把巷子擋住了',
    expected: ['townpass_disaster'],
    tag: 'paraphrase',
  },
  {
    request: '我想在家用手機把手續辦一辦，不想跑一趟',
    expected: ['townpass_apply'],
    tag: 'paraphrase',
  },
  { request: '有哪些證明文件可以不出門就申請', expected: ['townpass_apply'], tag: 'paraphrase' },
  {
    request: '我快到地政事務所了，想先知道前面還有幾個人在等',
    expected: ['townpass_counter'],
    tag: 'paraphrase',
  },
  { request: '我想找一本講糖尿病怎麼吃的書', expected: ['townpass_library'], tag: 'paraphrase' },
  {
    request: '我想每天早上收到空氣好不好的通知',
    expected: ['townpass_subscription'],
    tag: 'paraphrase',
  },
  {
    request: '我手機昨天被偷了，想先在網路上登記一下，不是很緊急',
    expected: ['townpass_police'],
    tag: 'paraphrase',
  },
  {
    request: '週末想帶孫子出去玩，有沒有景點可以打折',
    expected: ['townpass_coupon'],
    tag: 'paraphrase',
  },
  {
    request: '我昨天買的展覽票，現在要拿出來給工作人員看',
    expected: ['townpass_ticket_wallet'],
    tag: 'paraphrase',
  },
  {
    request: '我的台北通登不進去，密碼也想不起來怎麼辦',
    expected: ['townpass_faq'],
    tag: 'paraphrase',
  },
  {
    request: '卡片的優惠到底怎麼算，有沒有人可以說明一下',
    expected: ['townpass_faq'],
    tag: 'paraphrase',
  },
  { request: '我手上有一張帳單想付，但不知道算哪一類', expected: ['fee'], tag: 'paraphrase' },
  { request: '車子停在路邊停車格，帳單寄來了要付', expected: ['fee_parking'], tag: 'paraphrase' },
  { request: '在市區停了一整天的車，錢還沒給', expected: ['fee_parking'], tag: 'paraphrase' },
  { request: '每年房子都會收到的那張稅單要繳了', expected: ['fee_tax'], tag: 'paraphrase' },
  { request: '孩子學校開學註冊要交的錢怎麼付', expected: ['fee_tuition'], tag: 'paraphrase' },
  { request: '大學這學期要繳的錢，我想幫女兒處理', expected: ['fee_tuition'], tag: 'paraphrase' },
  { request: '我住市府的社會住宅，這個月的房租要繳', expected: ['fee_housing'], tag: 'paraphrase' },
  { request: '國宅每個月的管理費我還沒付', expected: ['fee_housing'], tag: 'paraphrase' },
  { request: '我爸在市立醫院住院，出院要結帳', expected: ['fee_medical'], tag: 'paraphrase' },
  { request: '和平醫院看診的費用我還沒付', expected: ['fee_medical'], tag: 'paraphrase' },
  {
    request: '我住的平價住宅，每個月維持大樓的錢要繳',
    expected: ['fee_maintenance'],
    tag: 'paraphrase',
  },
  { request: '我報了公訓處開的課，上課的錢要付', expected: ['fee_course'], tag: 'paraphrase' },
  { request: '上次報名的在職進修班，費用還沒繳', expected: ['fee_course'], tag: 'paraphrase' },
  {
    request: '我有一筆市府的規費要繳，但不是水電稅這些',
    expected: ['fee_other'],
    tag: 'paraphrase',
  },
  {
    request: '市府寄來一張雜項費用通知，不知道屬於哪一種',
    expected: ['fee_other', 'fee'],
    tag: 'paraphrase',
  },
  { request: '帳單上有條碼，我想用手機直接對著它付錢', expected: ['fee_scan'], tag: 'paraphrase' },
  { request: '拿著繳費單，用手機照一下就能付嗎', expected: ['fee_scan'], tag: 'paraphrase' },
  { request: '我想看看自己之前到底繳過哪些錢', expected: ['fee_history'], tag: 'paraphrase' },
  {
    request: '我先生中風了行動不便，有沒有生活上的補助',
    expected: ['services_disabled'],
    tag: 'paraphrase',
  },
  {
    request: '我懷孕七個月了，產檢有什麼錢可以領',
    expected: ['services_maternity'],
    tag: 'paraphrase',
  },
  {
    request: '阿公今年八十歲了，市府有沒有什麼敬老福利',
    expected: ['services_elderly'],
    tag: 'paraphrase',
  },
  {
    request: '我一個人住，心裡很慌，想找人說說話問問怎麼辦',
    expected: ['call_1999'],
    tag: 'paraphrase',
  },
  // keyword
  { request: '平宅的維護費怎麼繳', expected: ['fee_maintenance'], tag: 'keyword' },
  { request: '我要繳水費', expected: ['fee_water'], tag: 'keyword' },
  // english
  { request: 'I want to pay a bill online', expected: ['fee'], tag: 'english' },
  { request: 'Where is the nearest public toilet?', expected: ['townpass_places'], tag: 'english' },
  {
    request: 'How many people are still waiting at the household registration office?',
    expected: ['townpass_counter'],
    tag: 'english',
  },
  {
    request: 'My daughter is pregnant, is there any help from the city?',
    expected: ['services_maternity'],
    tag: 'english',
  },
  {
    request: 'I would like to talk to a real person at the city hotline',
    expected: ['call_1999'],
    tag: 'english',
  },
  // disfluent
  {
    request: '呃…那個…我家前面的路燈好像壞掉了啦，就是都不會亮',
    expected: ['townpass_report'],
    tag: 'disfluent',
  },
  {
    request: '嗯…我想那個…借書，就是圖書館的書要先預約',
    expected: ['townpass_library'],
    tag: 'disfluent',
  },
  {
    request: '我阿嬤她…那個…身心障ㄞ的補助要找哪裡啊',
    expected: ['services_disabled'],
    tag: 'disfluent',
  },
  { request: 'ㄟ我要繳那個…水ㄈㄟ，要怎辦', expected: ['fee_water'], tag: 'disfluent' },
  {
    request: '我想訂閱…呃…就是路況的消息，會一直通知我那種',
    expected: ['townpass_subscription'],
    tag: 'disfluent',
  },
  // confusable
  { request: '附近有沒有地方可以停車', expected: ['townpass_places'], tag: 'confusable' },
  {
    request: '有人把車停在我家車庫前面，我出不去',
    expected: ['townpass_report'],
    tag: 'confusable',
  },
  { request: '我的腳踏車被偷了，想上網報案', expected: ['townpass_police'], tag: 'confusable' },
  { request: '我想買一張展覽的票', expected: ['townpass_coupon'], tag: 'confusable' },
  { request: '我想查之前停車費有沒有繳成功', expected: ['fee_history'], tag: 'confusable' },
  { request: '機車每年要繳的牌照稅怎麼處理', expected: ['fee_tax'], tag: 'confusable' },
  {
    request: '我想幫老人家辦敬老卡',
    expected: ['services_elderly', 'townpass_apply'],
    tag: 'confusable',
  },
  {
    request: '已經買好的票我想看還能不能用',
    expected: ['townpass_ticket_wallet'],
    tag: 'confusable',
  },
  // unsupported
  { request: '幫我掛明天台大醫院的門診', expected: ['unsupported'], tag: 'unsupported' },
  { request: '我的駕照過期了，要怎麼換新的', expected: ['unsupported'], tag: 'unsupported' },
  { request: '捷運淡水線末班車幾點開', expected: ['unsupported'], tag: 'unsupported' },
  { request: '307 公車現在到哪裡了', expected: ['unsupported'], tag: 'unsupported' },
  { request: '明天會不會下雨', expected: ['unsupported'], tag: 'unsupported' },
  { request: '幫我訂一份中午的便當', expected: ['unsupported'], tag: 'unsupported' },
];

import { CITIZEN_REPORT_FORM, type FormSpec } from './form-fill';

/**
 * Every Town Pass (TownPass-Services) page where a citizen types or picks something, as form
 * specs the generic filler can use. Field ids match the template's input ids/v-models, so the
 * values can later be pre-filled on the real page.
 *
 * Left out on purpose: consent checkboxes (個人資料同意、已詳閱須知) and file uploads — the person
 * does those themselves — and member data the app already has (姓名、身分證字號 on police step 1,
 * 證件號碼 for hospital fees).
 */
export const COUNTIES = [
  '臺北市',
  '基隆市',
  '新北市',
  '宜蘭縣',
  '新竹市',
  '新竹縣',
  '桃園市',
  '苗栗縣',
  '臺中市',
  '彰化縣',
  '南投縣',
  '嘉義市',
  '嘉義縣',
  '雲林縣',
  '臺南市',
  '高雄市',
  '澎湖縣',
  '屏東縣',
  '臺東縣',
  '花蓮縣',
  '金門縣',
  '連江縣',
];

const CASUALTIES = {
  id: 'casualties',
  label: '人員傷亡',
  type: 'multiselect',
  options: ['傷亡', '受困', '失蹤'],
} as const;
const TRAFFIC = {
  id: 'traffic',
  label: '影響交通',
  type: 'multiselect',
  options: ['道路', '巷弄', '人行道'],
} as const;

export const DISASTER_CATEGORIES = [
  '電線(桿)或纜線受損',
  '變電所、電廠受災',
  '路燈故障',
  '電力停電',
  '橋樑基礎沖刷',
  '橋樑斷裂',
  '前述以外之橋梁災情',
  '土石流',
  '土石崩落',
  '堰塞湖',
  '建築物火災',
  '危險物品火災',
  '工廠火災',
  '其他(前述以外火災)',
];

export const TOWNPASS_FORMS: FormSpec[] = [
  CITIZEN_REPORT_FORM,
  {
    id: 'disaster_report',
    title: '災情通報',
    fields: [
      { id: 'category', label: '災情分類', type: 'select', options: DISASTER_CATEGORIES },
      { id: 'location', label: '災情發生地點', type: 'text', hint: '可直接定位或輸入完整地址' },
      { id: 'location_desc', label: '地點描述', type: 'text', hint: '地點位置補充說明' },
      { ...CASUALTIES, options: [...CASUALTIES.options] },
      { ...TRAFFIC, options: [...TRAFFIC.options] },
      {
        id: 'additional_disc',
        label: '補充描述',
        type: 'text',
        kind: 'longtext',
        hint: '災情細節說明',
      },
    ],
  },
  {
    id: 'disaster_streetlamp',
    title: '災情通報：路燈故障',
    fields: [
      { id: 'location', label: '災情發生地點', type: 'text' },
      { id: 'street_lamp_fall', label: '路燈傾倒(傾倒盞)', type: 'number', cues: ['倒'] },
      {
        id: 'street_lamp_lost',
        label: '路燈傾倒(失明盞)',
        type: 'number',
        cues: ['不亮', '失明', '暗', '熄'],
      },
      { ...CASUALTIES, options: [...CASUALTIES.options] },
      { ...TRAFFIC, options: [...TRAFFIC.options] },
    ],
  },
  {
    id: 'disaster_landslide',
    title: '災情通報：土石流',
    fields: [
      { id: 'location', label: '災情發生地點', type: 'text' },
      { id: 'length', label: '土石流(範圍約多長)', type: 'number', cues: ['長'] },
      { id: 'width', label: '土石流(範圍約多寬)', type: 'number', cues: ['寬'] },
      { id: 'depth', label: '土石流(範圍約多深)', type: 'number', cues: ['深', '高', '厚'] },
      { id: 'buried', label: '多處房屋掩埋，情況危急', type: 'yesno', cues: ['掩埋', '埋', '壓'] },
      { ...CASUALTIES, options: [...CASUALTIES.options] },
    ],
  },
  {
    id: 'police_contact',
    title: '線上報案：聯絡資料',
    fields: [
      { id: 'mobile_number', label: '手機號碼', type: 'mobile' },
      { id: 'contact_number', label: '住家電話', type: 'phone' },
      { id: 'mail', label: '電子信箱', type: 'email' },
      { id: 'county', label: '通訊地址縣市', type: 'select', options: COUNTIES },
      { id: 'city', label: '通訊地址區域', type: 'text', hint: '鄉鎮市區' },
      { id: 'address', label: '通訊地址詳細地址', type: 'text', hint: '路名、巷弄、門牌' },
    ],
  },
  {
    id: 'police_case',
    title: '線上報案：案件內容',
    fields: [
      {
        id: 'your_role',
        label: '報案人類別',
        type: 'select',
        options: ['當事人', '被害人', '檢舉人', '關係人'],
        aliases: {
          被害人: [
            '被害',
            '受害',
            '被騙',
            '詐騙',
            '騙了',
            '被偷',
            '偷了',
            '被搶',
            '搶了',
            '被打',
            '被撞',
          ],
          檢舉人: ['檢舉', '我看到', '目擊'],
          關係人: ['家人', '朋友', '幫我', '替'],
        },
      },
      { id: 'location', label: '發生地點', type: 'text' },
      { id: 'date_of_incident', label: '發生日期', type: 'date' },
      { id: 'time', label: '發生時間', type: 'time' },
      {
        id: 'case_summary',
        label: '案情摘要',
        type: 'text',
        kind: 'longtext',
        hint: '人、事、時、地、物',
      },
    ],
  },
  {
    id: 'traffic_appeal',
    title: '交通違規申訴',
    fields: [
      { id: 'mail', label: '電子信箱', type: 'email' },
      { id: 'county', label: '縣市', type: 'select', options: COUNTIES },
      { id: 'city', label: '鄉鎮(市)區', type: 'text' },
      { id: 'address', label: '通訊地址', type: 'text' },
      { id: 'name', label: '違規駕駛人姓名', type: 'text' },
      {
        id: 'apply',
        label: '申訴項目',
        type: 'multiselect',
        options: ['車禍案件申訴', '車型車色不符'],
        aliases: { 車禍案件申訴: ['車禍'], 車型車色不符: ['車型', '車色', '顏色', '不是我的車'] },
      },
      { id: 'send_by_mail', label: '以E-MAIL寄發', type: 'yesno', cues: ['mail', '信箱', '寄'] },
      { id: 'content', label: '申訴內容', type: 'text', kind: 'longtext' },
      {
        id: 'apply_form',
        label: '申請表單',
        type: 'multiselect',
        options: ['現場圖', '現場照片'],
        aliases: { 現場圖: ['現場圖', '圖'], 現場照片: ['照片', '相片'] },
      },
      { id: 'date', label: '肇事日期', type: 'date' },
    ],
  },
  {
    id: 'fee_company',
    title: '繳費：公司／商業登記費',
    fields: [{ id: 'phone_number', label: '手機號碼', type: 'mobile' }],
  },
  {
    id: 'fee_land',
    title: '繳費：地政登記規費／地政罰鍰',
    fields: [
      { id: 'tax_id', label: '統編', type: 'idno' },
      {
        id: 'office',
        label: '地政事務所',
        type: 'select',
        options: ['古亭地政事務所', '建成地政事務所', '中山地政事務所'],
      },
    ],
  },
  {
    id: 'fee_parking',
    title: '繳費：停車費',
    fields: [
      {
        id: 'vehicle_type',
        label: '車種',
        type: 'select',
        options: ['汽車', '機車'],
        aliases: { 機車: ['摩托車', '機車', '重機'], 汽車: ['汽車', '轎車', '小客車'] },
      },
      { id: 'plate_number', label: '車牌號碼', type: 'plate' },
    ],
  },
  {
    id: 'fee_water',
    title: '繳費：水費',
    fields: [{ id: 'water_number', label: '水號', type: 'code' }],
  },
  {
    id: 'fee_medical',
    title: '繳費：聯合醫院醫療費',
    fields: [
      { id: 'date', label: '出生日期', type: 'date' },
      {
        id: 'office',
        label: '院區',
        type: 'select',
        options: ['所有院區', '中興', '仁愛', '和平', '婦幼'],
      },
    ],
  },
  {
    id: 'fee_flash',
    title: '繳費：快閃購繳款',
    fields: [
      { id: 'account', label: '快閃購帳號', type: 'code' },
      { id: 'phone_number', label: '手機號碼', type: 'mobile' },
    ],
  },
  {
    id: 'fee_bill_number',
    title: '繳費：用繳費編號查詢',
    fields: [{ id: 'payment_number', label: '繳費編號', type: 'code' }],
  },
  {
    id: 'library_search',
    title: '圖書館：館藏查詢',
    fields: [
      {
        id: 'searchType',
        label: '查詢類型',
        type: 'select',
        options: ['全部', '書名', '著者', '出版項', '主題', 'ISBN'],
        aliases: {
          著者: ['作者', '誰寫', '寫的'],
          出版項: ['出版社', '出版'],
          主題: ['主題', '關於', '有關'],
          書名: ['書名', '叫做', '這本'],
        },
      },
      { id: 'searchText', label: '關鍵字', type: 'text' },
    ],
  },
  {
    id: 'counter_calling',
    title: '臨櫃叫號',
    fields: [
      {
        id: 'agency',
        label: '機關類型',
        type: 'select',
        options: ['地政事務所', '戶政事務所', '區公所', '稅捐處', '就業服務站'],
      },
      {
        id: 'location',
        label: '地點',
        type: 'select',
        options: [
          '古亭地政事務所',
          '中山地政事務所',
          '萬華區戶政事務所',
          '中正區戶政事務所',
          '臺北市萬華區公所',
          '臺北市中正區公所',
          '萬華分處',
          '大同分處',
          '艋舺就業服務站',
          '西門就業服務站',
        ],
      },
    ],
  },
  {
    id: 'subscription',
    title: '市政訊息訂閱',
    fields: [
      {
        id: 'topics',
        label: '訂閱項目',
        type: 'multiselect',
        options: [
          '體育樂園',
          '臺北旅遊網最新消息',
          '交通措施',
          '銀髮資訊',
          '圖書到期通知',
          '新住民心服務',
          '健康報報',
          '停車費通知',
          '空品資訊',
          '防汛資訊',
        ],
        aliases: {
          臺北旅遊網最新消息: ['旅遊'],
          銀髮資訊: ['銀髮', '長輩', '老人'],
          圖書到期通知: ['圖書', '借書', '還書'],
          新住民心服務: ['新住民'],
          健康報報: ['健康'],
          空品資訊: ['空氣', '空品'],
          防汛資訊: ['防汛', '颱風', '淹水'],
          停車費通知: ['停車費'],
          體育樂園: ['體育', '運動'],
        },
      },
      {
        id: 'action',
        label: '動作',
        type: 'select',
        options: ['訂閱', '取消訂閱'],
        aliases: { 取消訂閱: ['取消', '不要再', '退訂'] },
      },
    ],
  },
  {
    id: 'buy_ticket',
    title: '購票：掘光而行：洪瑞麟',
    fields: [
      { id: 'adult', label: '全票', type: 'count', cues: ['全票', '大人', '成人'] },
      {
        id: 'concession',
        label: '優待票',
        type: 'count',
        cues: ['優待', '敬老', '學生', '愛心', '身障', '老人'],
      },
      { id: 'citizen', label: '台北市民票', type: 'count', cues: ['市民'] },
      { id: 'group', label: '團體票', type: 'count', cues: ['團體'] },
    ],
  },
  {
    id: 'fee_history',
    title: '繳費紀錄查詢',
    fields: [
      {
        id: 'year',
        label: '期間',
        type: 'select',
        options: ['近1年', '近2年', '近3年'],
        aliases: { 近1年: ['一年', '今年'], 近2年: ['兩年', '二年'], 近3年: ['三年'] },
      },
      {
        id: 'type',
        label: '項目',
        type: 'select',
        options: ['所有項目', '停車費', '公訓處自費課程'],
        aliases: { 公訓處自費課程: ['公訓處', '課程'], 所有項目: ['所有項目', '全部項目'] },
      },
      {
        id: 'status',
        label: '狀態',
        type: 'select',
        options: ['所有狀態', '成功', '處理中', '失敗'],
        aliases: { 失敗: ['失敗', '沒成功', '沒繳成功'], 處理中: ['處理中', '還在處理'] },
      },
    ],
  },
];

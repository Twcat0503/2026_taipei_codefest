import { HELDOUT_HOME, HELDOUT_TODAY, type HeldoutCase } from './form-fill-heldout';

const BOOKING_CTX = { today: HELDOUT_TODAY, memberAddress: HELDOUT_HOME };

export const REPORT_CORRECTION: HeldoutCase[] = [
  {
    request: '我要反映中山北路二段的路燈壞了，晚上黑漆漆的，不對，是中山北路三段',
    expected: {
      title: { any: ['路燈', '燈'] },
      description: { all: ['路燈'] },
      location: ['中山北路三段'],
      district: [''],
    },
    tag: 'fix-place',
  },
  {
    request: '嗯，大安區松仁路上的人行道有一個大洞，輪椅會卡住，喔不是，是信義區，松仁路在信義區',
    expected: {
      title: { any: ['人行道', '洞'] },
      description: { all: ['洞'] },
      location: ['松仁路'],
      district: ['信義區'],
    },
    tag: 'fix-district',
  },
  {
    request: '公車站牌上的字太小了，視障的人根本看不到，還有斑馬線的時間太短，斑馬線那個算了不用提',
    expected: {
      title: { any: ['站牌', '字太小', '公車'] },
      description: { all: ['站牌'], not: ['斑馬線'] },
      location: [''],
      district: [''],
    },
    tag: 'implicit',
  },
  {
    request:
      '欸我要反映民權東路三段的語音紅綠燈壞了，說錯了，是民權東路四段，區域是松山區，不是中山區',
    expected: {
      title: { any: ['紅綠燈', '語音'] },
      description: { all: ['紅綠燈'] },
      location: ['民權東路四段'],
      district: ['松山區'],
    },
    tag: 'double',
  },
  {
    request: '這件事不是很急，就是想反映一下仁愛路四段的無障礙坡道上有積水，不用特別派人來',
    expected: {
      title: { any: ['坡道', '積水'] },
      description: { all: ['積水'] },
      location: ['仁愛路四段'],
      district: [''],
    },
    tag: 'control',
  },
  {
    request:
      'The ramp at Daan Park is blocked by bikes. Sorry, I mean the stairs at Daan Park are missing a handrail.',
    expected: {
      title: { any: ['handrail', 'Handrail', '扶手'] },
      description: { all: ['handrail'], not: ['bikes'] },
      location: ['Daan Park', '大安森林公園', '大安公園'],
      district: ['', '大安區'],
    },
    tag: 'english',
  },
  {
    request: '我家門口的電線桿擋住人行道，路燈也不亮。電線桿那個不用管了，我已經請里長處理了',
    context: { memberAddress: HELDOUT_HOME },
    expected: {
      title: { any: ['路燈', '燈'] },
      description: { all: ['路燈'], not: ['電線桿'] },
      location: [HELDOUT_HOME],
      district: ['中山區'],
    },
    tag: 'implicit',
  },
  {
    request: '大概在民生東路五段，不對，我不確定是哪一段，就是民生東路上有一個無障礙停車格被占用',
    expected: {
      title: { any: ['停車格', '停車'] },
      description: { all: ['停車格'] },
      location: ['民生東路'],
      district: [''],
    },
    tag: 'to-vague',
  },
];

export const REHAB_CORRECTION: HeldoutCase[] = [
  {
    request: '我要叫復康巴士，從家裡到台大醫院，喔不是，是到榮總',
    context: BOOKING_CTX,
    expected: {
      pickup: [HELDOUT_HOME],
      dropoff: ['台北榮民總醫院', '榮民總醫院', '台北榮總', '榮總'],
      date: [''],
      time: [''],
      wheelchair: [''],
      companions: [''],
    },
    tag: 'fix-place',
  },
  {
    request: '我要預約下週二早上九點從家裡去萬芳醫院，不對，我是說下週四',
    context: BOOKING_CTX,
    expected: {
      pickup: [HELDOUT_HOME],
      dropoff: ['萬芳醫院', '台北市立萬芳醫院'],
      date: ['2026-11-19'],
      time: ['09:00'],
      wheelchair: [''],
      companions: [''],
    },
    tag: 'fix-date',
  },
  {
    request: '明天下午兩點，更正，是三點，從家裡到國父紀念館，我坐輪椅',
    context: BOOKING_CTX,
    expected: {
      pickup: [HELDOUT_HOME],
      dropoff: ['國父紀念館'],
      date: ['2026-11-13'],
      time: ['15:00'],
      wheelchair: ['yes'],
      companions: [''],
    },
    tag: 'fix-time',
  },
  {
    request: '後天早上十點從家裡去三軍總醫院看診，我跟我太太一起，不過她那天沒空，我自己去',
    context: BOOKING_CTX,
    expected: {
      pickup: [HELDOUT_HOME],
      dropoff: ['三軍總醫院', '國防醫學院三軍總醫院', '三總'],
      date: ['2026-11-14'],
      time: ['10:00'],
      wheelchair: [''],
      companions: ['0'],
    },
    tag: 'implicit',
  },
  {
    request: '下週五下午四點從家裡到台北車站，原本想帶輪椅的，後來想想用拐杖就行了',
    context: BOOKING_CTX,
    expected: {
      pickup: [HELDOUT_HOME],
      dropoff: ['台北車站', '臺北車站', '台北火車站'],
      date: ['2026-11-20'],
      time: ['16:00'],
      wheelchair: ['no'],
      companions: [''],
    },
    tag: 'implicit',
  },
  {
    request: '這週日下午，從家裡到龍山寺，不對是到艋舺公園，時間是兩點，應該是兩點半',
    context: BOOKING_CTX,
    expected: {
      pickup: [HELDOUT_HOME],
      dropoff: ['艋舺公園'],
      date: ['2026-11-15'],
      time: ['14:30'],
      wheelchair: [''],
      companions: [''],
    },
    tag: 'double',
  },
  {
    request: '後天下午三點，喔我是說下午，時間還不確定，從家裡去新光醫院，我一個人',
    context: BOOKING_CTX,
    expected: {
      pickup: [HELDOUT_HOME],
      dropoff: ['新光醫院', '新光吳火獅紀念醫院', '台北新光醫院'],
      date: ['2026-11-14'],
      time: [''],
      wheelchair: [''],
      companions: ['0'],
    },
    tag: 'to-vague',
  },
  {
    request:
      '我要預約下週一，不是很趕，時間大概中午，從家裡到市立聯合醫院和平院區，不用人陪，要坐輪椅',
    context: BOOKING_CTX,
    expected: {
      pickup: [HELDOUT_HOME],
      dropoff: ['台北市立聯合醫院和平院區', '市立聯合醫院和平院區', '和平院區', '和平醫院'],
      date: ['2026-11-16'],
      time: [''],
      wheelchair: ['yes'],
      companions: ['0'],
    },
    tag: 'control',
  },
];

export const TOUR_CORRECTION: HeldoutCase[] = [
  {
    request:
      '想預約台北市立美術館的無障礙導覽，下週三下午兩點，我們五個人，不對，是六個人，要手語導覽',
    context: BOOKING_CTX,
    expected: {
      venue: ['台北市立美術館', '臺北市立美術館', '北美館'],
      date: ['2026-11-18'],
      time: ['14:00'],
      visitors: ['6'],
      sign_language: ['yes'],
      wheelchair_loan: [''],
    },
    tag: 'fix-count',
  },
  {
    request: '故宮的導覽，這週六早上十點，8個人，要借輪椅，喔不是，是不用借輪椅，手語導覽要',
    context: BOOKING_CTX,
    expected: {
      venue: ['國立故宮博物院', '故宮博物院', '故宮'],
      date: ['2026-11-14'],
      time: ['10:00'],
      visitors: ['8'],
      sign_language: ['yes'],
      wheelchair_loan: ['no'],
    },
    tag: 'fix-yesno',
  },
  {
    request: '我跟朋友想去華山1914，下週日下午一點，我本來想借輪椅給她，啊她說她自己有帶，不用了',
    context: BOOKING_CTX,
    expected: {
      venue: ['華山1914文化創意產業園區', '華山1914', '華山文創園區'],
      date: ['2026-11-22'],
      time: ['13:00'],
      visitors: ['2'],
      sign_language: [''],
      wheelchair_loan: ['no'],
    },
    tag: 'implicit',
  },
  {
    request:
      '嗯，國立臺灣博物館，下週二上午十點半，我跟媽媽跟小孩三個人，欸小孩那天要考試所以不去了',
    context: BOOKING_CTX,
    expected: {
      venue: ['國立臺灣博物館', '國立台灣博物館', '台灣博物館', '臺灣博物館'],
      date: ['2026-11-17'],
      time: ['10:30'],
      visitors: ['2'],
      sign_language: [''],
      wheelchair_loan: [''],
    },
    tag: 'implicit',
  },
  {
    request: '想預約台北市立動物園，不對，是台北市立天文館，下週二下午兩點，更正，下午三點，六個人',
    context: BOOKING_CTX,
    expected: {
      venue: ['台北市立天文科學教育館', '臺北市立天文科學教育館', '台北市立天文館', '天文館'],
      date: ['2026-11-17'],
      time: ['15:00'],
      visitors: ['6'],
      sign_language: [''],
      wheelchair_loan: [''],
    },
    tag: 'double',
  },
  {
    request:
      "I'd like to book a tour at the National Palace Museum next Friday at 2pm for 4 people, sorry, I mean 3 people. We don't need sign language.",
    context: BOOKING_CTX,
    expected: {
      venue: ['National Palace Museum', '國立故宮博物院', '故宮博物院', '故宮'],
      date: ['2026-11-20'],
      time: ['14:00'],
      visitors: ['3'],
      sign_language: ['no'],
      wheelchair_loan: [''],
    },
    tag: 'english',
  },
  {
    request: '松山文創園區，下週四下午三點，喔我是說下午就好，時間再說，總共四個人',
    context: BOOKING_CTX,
    expected: {
      venue: ['松山文創園區', '松山文化創意園區'],
      date: ['2026-11-19'],
      time: [''],
      visitors: ['4'],
      sign_language: [''],
      wheelchair_loan: [''],
    },
    tag: 'to-vague',
  },
  {
    request:
      '我們想去國父紀念館，下週六上午十一點，兩個人，不用手語，輪椅要借，不是很急可以晚點回覆',
    context: BOOKING_CTX,
    expected: {
      venue: ['國立國父紀念館', '國父紀念館'],
      date: ['2026-11-21'],
      time: ['11:00'],
      visitors: ['2'],
      sign_language: ['no'],
      wheelchair_loan: ['yes'],
    },
    tag: 'control',
  },
];

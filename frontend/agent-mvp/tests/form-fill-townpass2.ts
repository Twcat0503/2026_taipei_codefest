import { HELDOUT_HOME, HELDOUT_TODAY, type HeldoutCase } from './form-fill-heldout';

const ctx = { today: HELDOUT_TODAY, memberAddress: HELDOUT_HOME };

export const TOWNPASS_CASES_2: Record<string, HeldoutCase[]> = {
  disaster_report: [
    {
      request: '我要通報，民生東路二段50號的房子失火了，有人被困在二樓，巷子也被消防車堵住了',
      context: ctx,
      tag: 'normal',
      expected: {
        category: ['建築物火災'],
        location: ['民生東路二段50號'],
        location_desc: [''],
        casualties: ['受困'],
        traffic: ['巷弄'],
        additional_disc: { all: ['失火'] },
      },
    },
    {
      request: '永春街的瓦斯桶爆炸起火了，就在7-11對面，有一個人受傷，道路整個封住',
      context: ctx,
      tag: 'location-desc',
      expected: {
        category: ['危險物品火災'],
        location: ['永春街'],
        location_desc: ['7-11對面'],
        casualties: ['傷亡'],
        traffic: ['道路'],
        additional_disc: { all: ['瓦斯'] },
      },
    },
    {
      request: '新北市汐止區的山坡土石滑下來了，整條路被泥巴蓋住，沒有人受傷',
      context: ctx,
      tag: 'normal',
      expected: {
        category: ['土石崩落'],
        location: ['汐止區', '新北市汐止區'],
        location_desc: [''],
        casualties: [''],
        traffic: ['道路'],
        additional_disc: { all: ['土石'] },
      },
    },
    {
      request: '天母東路這一帶整排都沒電，兩個小時了，我住在巷子最裡面那棟',
      context: ctx,
      tag: 'location-desc',
      expected: {
        category: ['電力停電'],
        location: ['天母東路'],
        location_desc: ['巷子最裡面那棟'],
        casualties: [''],
        traffic: [''],
        additional_disc: { all: ['沒電'] },
      },
    },
    {
      request: '大直橋斷掉了，一台車差點掉下去，現在橋上道路過不去，人行道也不能走',
      context: ctx,
      tag: 'normal',
      expected: {
        category: ['橋樑斷裂'],
        location: ['大直橋'],
        location_desc: [''],
        casualties: [''],
        traffic: ['道路、人行道'],
        additional_disc: { all: ['橋'] },
      },
    },
    {
      request: '烏來那邊溪水被山上掉下來的土擋住，形成堰塞湖，水越積越多，位置在福山橋上游約兩公里',
      context: ctx,
      tag: 'location-desc',
      expected: {
        category: ['堰塞湖'],
        location: ['烏來'],
        location_desc: ['福山橋上游'],
        casualties: [''],
        traffic: [''],
        additional_disc: { all: ['水'] },
      },
    },
    {
      request: '內湖瑞光路的鐵皮工廠失火，濃煙很大，有兩個人失蹤還沒找到，就在全家便利商店隔壁',
      context: ctx,
      tag: 'location-desc',
      expected: {
        category: ['工廠火災'],
        location: ['瑞光路', '內湖瑞光路'],
        location_desc: ['全家便利商店隔壁'],
        casualties: ['失蹤'],
        traffic: [''],
        additional_disc: { all: ['濃煙'] },
      },
    },
    {
      request: '信義路四段路邊有一台汽車起火燃燒，沒有人受傷，但是道路被擋住了',
      context: ctx,
      tag: 'normal',
      expected: {
        category: ['其他(前述以外火災)'],
        location: ['信義路四段'],
        location_desc: [''],
        casualties: [''],
        traffic: ['道路'],
        additional_disc: { all: ['汽車'] },
      },
    },
    {
      request: '忠孝東路五段的電線桿被撞斷了，電線掉在地上，有人被壓住受困，巷弄也過不去',
      context: ctx,
      tag: 'disfluent',
      expected: {
        category: ['電線(桿)或纜線受損'],
        location: ['忠孝東路五段'],
        location_desc: [''],
        casualties: ['受困'],
        traffic: ['巷弄'],
        additional_disc: { all: ['電線'] },
      },
    },
    {
      request:
        'There was a mudslide on Yangming Mountain road, mud flowed into the street and one person is missing. The road is blocked.',
      context: ctx,
      tag: 'english',
      expected: {
        category: ['土石流'],
        location: ['Yangming Mountain road', 'Yangming', '陽明山'],
        location_desc: [''],
        casualties: ['失蹤'],
        traffic: ['道路'],
        additional_disc: { all: ['mud'] },
      },
    },
  ],

  disaster_streetlamp: [
    {
      request: '中山北路三段有三盞路燈不亮',
      context: ctx,
      tag: 'normal',
      expected: {
        location: ['中山北路三段'],
        street_lamp_fall: [''],
        street_lamp_lost: ['3'],
        casualties: [''],
        traffic: [''],
      },
    },
    {
      request: '建國北路一段，倒了兩支，還有一支不會亮，有人被砸傷',
      context: ctx,
      tag: 'normal',
      expected: {
        location: ['建國北路一段'],
        street_lamp_fall: ['2'],
        street_lamp_lost: ['1'],
        casualties: ['傷亡'],
        traffic: [''],
      },
    },
    {
      request: '仁愛路四段不亮的有三盞，倒的有一盞，壓到騎士人被困住了，道路不能走',
      context: ctx,
      tag: 'normal',
      expected: {
        location: ['仁愛路四段'],
        street_lamp_fall: ['1'],
        street_lamp_lost: ['3'],
        casualties: ['受困'],
        traffic: ['道路'],
      },
    },
    {
      request: '羅斯福路六段路燈倒了四支，不對，是五支',
      context: ctx,
      tag: 'count-correction',
      expected: {
        location: ['羅斯福路六段'],
        street_lamp_fall: ['5'],
        street_lamp_lost: [''],
        casualties: [''],
        traffic: [''],
      },
    },
    {
      request:
        'Two street lamps fell down on Zhongxiao East Road and three are not working. The sidewalk is blocked.',
      context: ctx,
      tag: 'english',
      expected: {
        location: ['Zhongxiao East Road', '忠孝東路'],
        street_lamp_fall: ['2'],
        street_lamp_lost: ['3'],
        casualties: [''],
        traffic: ['人行道'],
      },
    },
  ],

  police_contact: [
    {
      request: '我手機0912345678，市話02-2765-4321，信箱 wang.test@example.com，地址就是我家',
      context: ctx,
      tag: 'home-address',
      expected: {
        mobile_number: ['0912345678'],
        contact_number: ['0227654321'],
        mail: ['wang.test@example.com'],
        county: ['臺北市'],
        city: ['中山區'],
        address: ['民生東路二段50號'],
      },
    },
    {
      request: '手機是零九八七六五四三二一，寄到我住的地方，email是 lin_demo@example.org',
      context: ctx,
      tag: 'spoken-digits',
      expected: {
        mobile_number: ['0987654321'],
        contact_number: [''],
        mail: ['lin_demo@example.org'],
        county: ['臺北市'],
        city: ['中山區'],
        address: ['民生東路二段50號'],
      },
    },
    {
      request: '我的電話0933111222，住址就是我家，家裡電話0225001234',
      context: ctx,
      tag: 'home-address',
      expected: {
        mobile_number: ['0933111222'],
        contact_number: ['0225001234'],
        mail: [''],
        county: ['臺北市'],
        city: ['中山區'],
        address: ['民生東路二段50號'],
      },
    },
    {
      request: '手機 0955-666-777，信箱 chen.test@example.net，地址新北市板橋區文化路一段100號',
      context: ctx,
      tag: 'spoken-address',
      expected: {
        mobile_number: ['0955666777'],
        contact_number: [''],
        mail: ['chen.test@example.net'],
        county: ['新北市'],
        city: ['板橋區'],
        address: ['文化路一段100號'],
      },
    },
    {
      request: '我住台中市西區台灣大道二段200號，電話 04-2222-3333，手機0922333444',
      context: ctx,
      tag: 'spoken-address',
      expected: {
        mobile_number: ['0922333444'],
        contact_number: ['0422223333'],
        mail: [''],
        county: ['臺中市'],
        city: ['西區'],
        address: ['台灣大道二段200號', '臺灣大道二段200號'],
      },
    },
    {
      request:
        'um my mobile is 0911 222 333, email is amy.test@example.com, and uh use my home address please',
      context: ctx,
      tag: 'english',
      expected: {
        mobile_number: ['0911222333'],
        contact_number: [''],
        mail: ['amy.test@example.com'],
        county: ['臺北市'],
        city: ['中山區'],
        address: ['民生東路二段50號'],
      },
    },
  ],

  traffic_appeal: [
    {
      request:
        '我要申訴，違規駕駛人是王大明，信箱 wang.dm@example.com，寄到我家，申訴車禍案件，結果請用email寄給我，我有現場照片，前天發生的。我當時綠燈直行卻被誤判',
      context: ctx,
      tag: 'home-address',
      expected: {
        mail: ['wang.dm@example.com'],
        county: ['臺北市'],
        city: ['中山區'],
        address: ['民生東路二段50號'],
        name: ['王大明'],
        apply: ['車禍案件申訴'],
        send_by_mail: ['yes'],
        content: { all: ['綠燈'] },
        apply_form: ['現場照片'],
        date: ['2026-11-10'],
      },
    },
    {
      request:
        '車型車色不符，罰單上寫白色轎車但我的是黑色，違規人李小華，上禮拜五的事，不用寄email，我有附現場圖和現場照片，地址新北市板橋區文化路一段100號，信箱 lee.test@example.com',
      context: ctx,
      tag: 'past-date',
      expected: {
        mail: ['lee.test@example.com'],
        county: ['新北市'],
        city: ['板橋區'],
        address: ['文化路一段100號'],
        name: ['李小華'],
        apply: ['車型車色不符'],
        send_by_mail: ['no'],
        content: { all: ['黑色'] },
        apply_form: ['現場圖、現場照片'],
        date: ['2026-11-06'],
      },
    },
    {
      request:
        '十月三十日那天被拍到闖紅燈，我是張美玲，我要申訴車禍案件和車型車色不符，信箱 mei.zhang@example.net，住址是我家，不要寄信',
      context: ctx,
      tag: 'past-date',
      expected: {
        mail: ['mei.zhang@example.net'],
        county: ['臺北市'],
        city: ['中山區'],
        address: ['民生東路二段50號'],
        name: ['張美玲'],
        apply: ['車禍案件申訴、車型車色不符'],
        send_by_mail: ['no'],
        content: { all: ['闖紅燈'] },
        apply_form: [''],
        date: ['2026-10-30'],
      },
    },
    {
      request:
        '呃，我要申訴，違規的人是陳志豪，呃，是前天，不對，大前天的事，兩台車擦撞，我有現場圖，信箱 chen.test@example.com，地址就是我家',
      context: ctx,
      tag: 'disfluent',
      expected: {
        mail: ['chen.test@example.com'],
        county: ['臺北市'],
        city: ['中山區'],
        address: ['民生東路二段50號'],
        name: ['陳志豪'],
        apply: ['車禍案件申訴'],
        send_by_mail: [''],
        content: { all: ['擦撞'] },
        apply_form: ['現場圖'],
        date: ['2026-11-09'],
      },
    },
    {
      request:
        'I want to appeal a ticket. The driver is Peter Lin, email peter.lin@example.com, home address, it is a vehicle color mismatch, send me the result by email, I have scene photos. It happened on November 3rd.',
      context: ctx,
      tag: 'english',
      expected: {
        mail: ['peter.lin@example.com'],
        county: ['臺北市'],
        city: ['中山區'],
        address: ['民生東路二段50號'],
        name: ['Peter Lin'],
        apply: ['車型車色不符'],
        send_by_mail: ['yes'],
        content: { all: ['color'] },
        apply_form: ['現場照片'],
        date: ['2026-11-03'],
      },
    },
    {
      request:
        '我是黃小明，信箱 huang.test@example.org，地址台北市大安區復興南路一段300號，十一月一號被後車追撞，我要申訴車禍案件，結果寄email給我，有現場圖',
      context: ctx,
      tag: 'spoken-address',
      expected: {
        mail: ['huang.test@example.org'],
        county: ['臺北市'],
        city: ['大安區'],
        address: ['復興南路一段300號'],
        name: ['黃小明'],
        apply: ['車禍案件申訴'],
        send_by_mail: ['yes'],
        content: { all: ['追撞'] },
        apply_form: ['現場圖'],
        date: ['2026-11-01'],
      },
    },
  ],

  police_case: [
    {
      request: '我是被害人，星期一晚上八點在忠孝東路四段被機車搶走包包',
      context: ctx,
      tag: 'past-date',
      expected: {
        your_role: ['被害人'],
        location: ['忠孝東路四段'],
        date_of_incident: ['2026-11-09'],
        time: ['20:00'],
        case_summary: { all: ['搶'] },
      },
    },
    {
      request: '我要檢舉，上週六下午在士林夜市看到有人賣盜版商品，大概三點半',
      context: ctx,
      tag: 'past-date',
      expected: {
        your_role: ['檢舉人'],
        location: ['士林夜市'],
        date_of_incident: ['2026-11-07'],
        time: ['15:30'],
        case_summary: { all: ['盜版'] },
      },
    },
    {
      request: '11月3號我的車在家門口被刮傷，我是當事人，不確定幾點，地點在民生東路二段50號',
      context: ctx,
      tag: 'past-date',
      expected: {
        your_role: ['當事人'],
        location: ['民生東路二段50號'],
        date_of_incident: ['2026-11-03'],
        time: [''],
        case_summary: { all: ['刮'] },
      },
    },
    {
      request:
        "I'm reporting for my brother, he is the victim. He was scammed at Taipei Main Station last Friday around 9 in the morning.",
      context: ctx,
      tag: 'english',
      expected: {
        your_role: ['關係人'],
        location: ['Taipei Main Station', '台北車站', '臺北車站'],
        date_of_incident: ['2026-11-06'],
        time: ['09:00'],
        case_summary: { all: ['scam'] },
      },
    },
    {
      request: '呃，我是，嗯，被害人啦，前天凌晨在西門町被人詐騙，不知道幾點',
      context: ctx,
      tag: 'disfluent',
      expected: {
        your_role: ['被害人'],
        location: ['西門町'],
        date_of_incident: ['2026-11-10'],
        time: [''],
        case_summary: { all: ['詐騙'] },
      },
    },
  ],

  buy_ticket: [
    {
      request: '我要買三張全票，不對，兩張',
      context: ctx,
      tag: 'count-correction',
      expected: { adult: ['2'], concession: [''], citizen: [''], group: [''] },
    },
    {
      request: '全票一張，優待票一張，喔我媽也要去，改兩張',
      context: ctx,
      tag: 'count-correction',
      expected: { adult: ['1'], concession: ['2'], citizen: [''], group: [''] },
    },
    {
      request: '兩個大人，一個國中生，一個老人家',
      context: ctx,
      tag: 'normal',
      expected: { adult: ['2'], concession: ['2'], citizen: [''], group: [''] },
    },
    {
      request: '台北市民票三張，團體票十張',
      context: ctx,
      tag: 'normal',
      expected: { adult: [''], concession: [''], citizen: ['3'], group: ['10'] },
    },
    {
      request: '我要全票四張，敬老一張，咦不對，敬老是兩張，我爸媽都去',
      context: ctx,
      tag: 'count-correction',
      expected: { adult: ['4'], concession: ['2'], citizen: [''], group: [''] },
    },
    {
      request:
        'Three adult tickets and two student tickets, no wait, make that one student ticket.',
      context: ctx,
      tag: 'english',
      expected: { adult: ['3'], concession: ['1'], citizen: [''], group: [''] },
    },
  ],

  fee_water: [
    {
      request: '我的水號是 07 123 456 7',
      context: ctx,
      tag: 'normal',
      expected: { water_number: ['071234567'] },
    },
    {
      request: '水費號碼三零、五五八、九二一、四',
      context: ctx,
      tag: 'spoken-digits',
      expected: { water_number: ['305589214'] },
    },
    {
      request: '水號是 b2-0456-789',
      context: ctx,
      tag: 'normal',
      expected: { water_number: ['B20456789'] },
    },
    {
      request: '水號 12 345 678，不對，最後一碼不是八，是九',
      context: ctx,
      tag: 'count-correction',
      expected: { water_number: ['12345679'] },
    },
    {
      request: '水費帳號 九 0 一 2 三 4 五',
      context: ctx,
      tag: 'spoken-digits',
      expected: { water_number: ['9012345'] },
    },
  ],

  fee_medical: [
    {
      request: '我民國七十九年三月五日生，要繳和平院區的醫療費',
      context: ctx,
      tag: 'past-date',
      expected: { date: ['1990-03-05'], office: ['和平'] },
    },
    {
      request: '我七十年次的，十二月三十號生日，所有院區的都要查',
      context: ctx,
      tag: 'past-date',
      expected: { date: ['1981-12-30'], office: ['所有院區'] },
    },
    {
      request: 'My birthday is 1985-07-21, I want to pay at the Renai branch.',
      context: ctx,
      tag: 'english',
      expected: { date: ['1985-07-21'], office: ['仁愛'] },
    },
  ],
};

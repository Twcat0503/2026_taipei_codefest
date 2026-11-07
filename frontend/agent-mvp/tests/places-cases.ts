export type PlacesCase = {
  request: string;
  expected: {
    tool: 'find_nearby_youbike' | 'find_nearby_toilets' | 'find_nearby_parking' | 'none';
    /** One of the 12 Taipei districts when the person named one (or a place clearly inside one), else ''. */
    area: string[];
    /** true when the search should use the phone's current location (GPS). */
    near_me: boolean;
    /** true when they need accessible facilities: accessible/wheelchair toilet, disabled or pregnant parking space, 親子/哺乳 is NOT accessibility. */
    accessible: boolean;
  };
  tag: string;
};

const T = 'find_nearby_toilets' as const;
const P = 'find_nearby_parking' as const;
const Y = 'find_nearby_youbike' as const;

export const PLACES_CASES: PlacesCase[] = [
  // toilets (15)
  {
    request: '附近有廁所嗎',
    expected: { tool: T, area: [''], near_me: true, accessible: false },
    tag: 'gps',
  },
  {
    request: '我現在的位置附近哪裡有洗手間',
    expected: { tool: T, area: [''], near_me: true, accessible: false },
    tag: 'gps',
  },
  {
    request: '我急著上廁所',
    expected: { tool: T, area: [''], near_me: true, accessible: false },
    tag: 'indirect',
  },
  {
    request: '我坐輪椅，附近有無障礙廁所嗎',
    expected: { tool: T, area: [''], near_me: true, accessible: true },
    tag: 'accessible',
  },
  {
    request: '我媽行動不便，幫我找有扶手的化妝室',
    expected: { tool: T, area: [''], near_me: true, accessible: true },
    tag: 'accessible',
  },
  {
    request: '大安區有公共廁所嗎',
    expected: { tool: T, area: ['大安區'], near_me: false, accessible: false },
    tag: 'district',
  },
  {
    request: '台北車站附近的廁所在哪',
    expected: { tool: T, area: ['中正區', ''], near_me: false, accessible: false },
    tag: 'landmark',
  },
  {
    request: '台北101有沒有無障礙廁所',
    expected: { tool: T, area: ['信義區', ''], near_me: false, accessible: true },
    tag: 'accessible',
  },
  {
    request: 'Where is the nearest public restroom?',
    expected: { tool: T, area: [''], near_me: true, accessible: false },
    tag: 'english',
  },
  {
    request: 'Is there a wheelchair accessible toilet near me?',
    expected: { tool: T, area: [''], near_me: true, accessible: true },
    tag: 'english',
  },
  {
    request: '呃…那個…廁…廁所，就是洗手間啦，哪裡有',
    expected: { tool: T, area: [''], near_me: true, accessible: false },
    tag: 'disfluent',
  },
  {
    request: '士林區有沒有身障廁所',
    expected: { tool: T, area: ['士林區'], near_me: false, accessible: true },
    tag: 'accessible',
  },
  {
    request: '我先生中風坐輪椅，帶他出門要先找無障礙廁所',
    expected: { tool: T, area: [''], near_me: true, accessible: true },
    tag: 'accessible',
  },
  {
    request: '我在動物園，哪裡有化妝室',
    expected: { tool: T, area: ['文山區', ''], near_me: false, accessible: false },
    tag: 'landmark',
  },
  {
    request: '哪裡有親子廁所可以幫寶寶換尿布',
    expected: { tool: T, area: [''], near_me: true, accessible: false },
    tag: 'gps',
  },

  // parking (15)
  {
    request: '附近哪裡有停車場',
    expected: { tool: P, area: [''], near_me: true, accessible: false },
    tag: 'gps',
  },
  {
    request: '哪裡可以停機車',
    expected: { tool: P, area: [''], near_me: true, accessible: false },
    tag: 'indirect',
  },
  {
    request: '我懷孕了要停車，附近有孕婦車位嗎',
    expected: { tool: P, area: [''], near_me: true, accessible: true },
    tag: 'accessible',
  },
  {
    request: '我坐輪椅，幫我找有身障車位的停車場',
    expected: { tool: P, area: [''], near_me: true, accessible: true },
    tag: 'accessible',
  },
  {
    request: '信義區有停車場嗎',
    expected: { tool: P, area: ['信義區'], near_me: false, accessible: false },
    tag: 'district',
  },
  {
    request: '我要去台大醫院，那附近有停車場嗎',
    expected: { tool: P, area: ['中正區', ''], near_me: false, accessible: false },
    tag: 'landmark',
  },
  {
    request: '松山機場附近有沒有愛心車位',
    expected: { tool: P, area: ['松山區', ''], near_me: false, accessible: true },
    tag: 'accessible',
  },
  {
    request: 'Where can I park my car near me?',
    expected: { tool: P, area: [''], near_me: true, accessible: false },
    tag: 'english',
  },
  {
    request: 'I need a disabled parking space near Taipei 101',
    expected: { tool: P, area: ['信義區', ''], near_me: false, accessible: true },
    tag: 'english',
  },
  {
    request: '嗯就是…我要找那個，停車…停車的地方啦',
    expected: { tool: P, area: [''], near_me: true, accessible: false },
    tag: 'disfluent',
  },
  {
    request: '我媽行動不便，要找下車比較方便的無障礙停車位',
    expected: { tool: P, area: [''], near_me: true, accessible: true },
    tag: 'accessible',
  },
  {
    request: '內湖區哪裡有停車位',
    expected: { tool: P, area: ['內湖區'], near_me: false, accessible: false },
    tag: 'district',
  },
  {
    request: '這裡有車位嗎',
    expected: { tool: P, area: [''], near_me: true, accessible: false },
    tag: 'gps',
  },
  {
    request: '北投區有身心障礙停車格嗎',
    expected: { tool: P, area: ['北投區'], near_me: false, accessible: true },
    tag: 'accessible',
  },
  {
    request: '士林夜市附近的停車場',
    expected: { tool: P, area: ['士林區'], near_me: false, accessible: false },
    tag: 'landmark',
  },

  // YouBike (12)
  {
    request: '附近有 YouBike 嗎',
    expected: { tool: Y, area: [''], near_me: true, accessible: false },
    tag: 'gps',
  },
  {
    request: '我想借腳踏車',
    expected: { tool: Y, area: [''], near_me: true, accessible: false },
    tag: 'indirect',
  },
  {
    request: '大同區哪裡有微笑單車站',
    expected: { tool: Y, area: ['大同區'], near_me: false, accessible: false },
    tag: 'district',
  },
  {
    request: '師大附近的 ubike 站在哪',
    expected: { tool: Y, area: ['大安區', ''], near_me: false, accessible: false },
    tag: 'landmark',
  },
  {
    request: 'Where is the closest YouBike station?',
    expected: { tool: Y, area: [''], near_me: true, accessible: false },
    tag: 'english',
  },
  {
    request: '那個…微笑…微笑單車，我想借一台，在哪邊',
    expected: { tool: Y, area: [''], near_me: true, accessible: false },
    tag: 'disfluent',
  },
  {
    request: '呃我現在的位置旁邊有 ubke 可以借嗎',
    expected: { tool: Y, area: [''], near_me: true, accessible: false },
    tag: 'disfluent',
  },
  {
    request: '南港展覽館有 YouBike 嗎',
    expected: { tool: Y, area: ['南港區', ''], near_me: false, accessible: false },
    tag: 'landmark',
  },
  {
    request: '文山區的 YouBike 站點',
    expected: { tool: Y, area: ['文山區'], near_me: false, accessible: false },
    tag: 'district',
  },
  {
    request: '我想騎車去河濱公園，哪裡可以借車',
    expected: { tool: Y, area: [''], near_me: true, accessible: false },
    tag: 'indirect',
  },
  {
    request: 'Is there a bike rental near Taipei Main Station?',
    expected: { tool: Y, area: ['中正區', ''], near_me: false, accessible: false },
    tag: 'english',
  },
  {
    request: '國父紀念館那邊有 YouBike 站嗎',
    expected: { tool: Y, area: ['信義區', ''], near_me: false, accessible: false },
    tag: 'landmark',
  },

  // none (3)
  {
    request: 'YouBike 怎麼註冊',
    expected: { tool: 'none', area: [''], near_me: false, accessible: false },
    tag: 'none',
  },
  {
    request: '停車費怎麼繳',
    expected: { tool: 'none', area: [''], near_me: false, accessible: false },
    tag: 'none',
  },
  {
    request: '身心障礙停車證要怎麼申請',
    expected: { tool: 'none', area: [''], near_me: false, accessible: false },
    tag: 'none',
  },
];

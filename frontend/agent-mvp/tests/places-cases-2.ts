import type { PlacesCase } from './places-cases';

const T = 'find_nearby_toilets' as const;
const P = 'find_nearby_parking' as const;
const Y = 'find_nearby_youbike' as const;

function c(
  request: string,
  tool: PlacesCase['expected']['tool'],
  area: string[],
  near_me: boolean,
  accessible: boolean,
  tag: string,
): PlacesCase {
  return { request, expected: { tool, area, near_me, accessible }, tag };
}

export const PLACES_CASES_2: PlacesCase[] = [
  // toilets (15)
  c('龍山寺附進有沒有廁所', T, ['萬華區', ''], false, false, 'disfluent'),
  c('我在象山站，哪裡有化妝室', T, ['信義區', ''], false, false, 'landmark'),
  c('內湖區有沒有無障礙廁所', T, ['內湖區'], false, true, 'accessible'),
  c('我這附近有洗手間嗎', T, [''], true, false, 'gps'),
  c('我爸中風以後要坐輪椅，找無障礙廁所', T, [''], true, true, 'condition'),
  c('Where can I find a restroom around here?', T, [''], true, false, 'english'),
  c(
    'Is there a public toilet near Raohe Night Market?',
    T,
    ['松山區', ''],
    false,
    false,
    'english',
  ),
  c('呃，那個，我要找，找廁所啦，快一點', T, [''], true, false, 'disfluent'),
  c('萬華區哪裡有公廁', T, ['萬華區'], false, false, 'district'),
  c('我媽有糖尿病，常常頻尿，出門在外哪裡有廁所', T, [''], true, false, 'condition'),
  c('北投公園有輪椅可以進去的廁所嗎', T, ['北投區', ''], false, true, 'accessible'),
  c('我坐輪椅要去中山站，那邊有無障礙廁所嗎', T, ['中山區', ''], false, true, 'accessible'),
  c('景美夜市有公共廁所嗎', T, ['文山區', ''], false, false, 'landmark'),
  c('我拄拐杖走不遠，幫我找最近的無障礙洗手間', T, [''], true, true, 'accessible'),
  c('肚子不太舒服，最近的廁所在哪', T, [''], true, false, 'indirect'),

  // parking (14)
  c('西門町附近有停車場嗎', P, ['萬華區', ''], false, false, 'landmark'),
  c('我要去榮總看病，附近有沒有愛心車位', P, ['北投區', ''], false, true, 'accessible'),
  c('中山區有孕婦停車位嗎', P, ['中山區'], false, true, 'accessible'),
  c('我現在的位置附近哪裡可以把車停下來', P, [''], true, false, 'indirect'),
  c('我太太剛做完膝蓋手術要拄拐杖，找附近有身障車位的停車場', P, [''], true, true, 'condition'),
  c(
    'Where is a parking lot near Miramar Entertainment Park?',
    P,
    ['中山區', ''],
    false,
    false,
    'english',
  ),
  c('Is there a parking space for pregnant women nearby?', P, [''], true, true, 'english'),
  c('南港區有沒有停車場', P, ['南港區'], false, false, 'district'),
  c('大同區哪裡有愛心停車格', P, ['大同區'], false, true, 'district'),
  c('嗯我要，我要停車，那個，車子啦，哪邊可以', P, [''], true, false, 'disfluent'),
  c('大安森林公園附近有停車場嗎', P, ['大安區', ''], false, false, 'landmark'),
  c('要去行天宮拜拜，附近有沒有身障車位', P, ['中山區', ''], false, true, 'accessible'),
  c('萬芳醫院附近的停車場在哪', P, ['文山區', ''], false, false, 'landmark'),
  c('開車來逛街，不知道車要停哪', P, [''], true, false, 'indirect'),

  // YouBike (12)
  c('我想找一個可以租腳踏車的地方', Y, [''], true, false, 'indirect'),
  c('中正紀念堂附近有 YouBike 嗎', Y, ['中正區', ''], false, false, 'landmark'),
  c('信義區的 YouBike 站在哪裡', Y, ['信義區'], false, false, 'district'),
  c('Where can I rent a bike around here?', Y, [''], true, false, 'english'),
  c('Is there a YouBike station near Jiantan Station?', Y, ['士林區', ''], false, false, 'english'),
  c('松山區想騎車，哪裡有微笑單車', Y, ['松山區'], false, false, 'district'),
  c('我想騎去大稻埕碼頭，碼頭附近有 YouBike 嗎', Y, ['大同區', ''], false, false, 'landmark'),
  c('嗯，那個，U-bike，ubike 站，啊不是，youbike，在哪裡', Y, [''], true, false, 'disfluent'),
  c('我要出門運動，這附近有沒有可以借的車', Y, [''], true, false, 'gps'),
  c('政大附近有 YouBike 嗎', Y, ['文山區', ''], false, false, 'landmark'),
  c('我膝蓋開刀完在復健，醫生說可以騎腳踏車，附近有 YouBike 嗎', Y, [''], true, false, 'condition'),
  c('北投區有哪些 YouBike 站', Y, ['北投區'], false, false, 'district'),

  // none (4)
  c('敬老卡要怎麼申請', 'none', [''], false, false, 'none'),
  c('路邊停車格的月租怎麼辦理', 'none', [''], false, false, 'none'),
  c('公廁壞掉了要跟哪裡反映', 'none', [''], false, false, 'none'),
  c('YouBike 騎一次多少錢', 'none', [''], false, false, 'none'),
];

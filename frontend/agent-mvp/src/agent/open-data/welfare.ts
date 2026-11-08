import type { Localized } from '../types';
export { WELFARE_CHECKED_AT, WELFARE_SOURCES } from '../../../../shared/welfare-sources';

const l = (zh: string, en: string): Localized => ({ 'zh-Hant-TW': zh, en });
export type WelfareTopic = 'living' | 'aids' | 'rehab';
export const welfareTopics: WelfareTopic[] = ['living', 'aids', 'rehab'];
export const welfareSections = ['overview', 'eligibility', 'documents', 'steps', 'cost'] as const;
export type WelfareSection = (typeof welfareSections)[number];
type Guide = {
  title: Localized;
  summary: Localized;
  sections: Record<WelfareSection, { items: Localized[]; speech: Localized }>;
  sources: string[];
  action: { label: Localized; url: string };
};
const section = (items: Localized[], speech: Localized) => ({ items, speech });
export const welfareGuides: Record<WelfareTopic, Guide> = {
  living: {
    title: l('身障生活補助', 'Disability living allowance'),
    summary: l(
      '先看申請條件，再用清單準備文件。',
      'Check the requirements, then prepare documents with the checklist.',
    ),
    sections: {
      overview: section(
        [
          l(
            '補助協助身心障礙者日常生活，須經收入、財產等條件審核。',
            'This allowance supports daily living and requires an income and asset assessment.',
          ),
          l(
            '已列冊臺北市低收入戶或中低收入戶者，社會局主動核發，毋須另申請。',
            'For registered Taipei low-income or lower-middle-income households, the department issues it without a separate application.',
          ),
          l(
            '其他申請人向戶籍所在地區公所社會課洽辦。',
            'Other applicants apply through the social affairs section of their household-registration district office.',
          ),
        ],
        l(
          '已列冊低收或中低收入戶會主動核發，其他申請人向區公所洽辦。',
          'Registered low-income households receive it automatically; other applicants contact their district office.',
        ),
      ),
      eligibility: section(
        [
          l(
            '設籍並實際居住臺北市，最近一年居住國內超過 183 日。',
            'Be registered and actually living in Taipei, with more than 183 days in Taiwan in the past year.',
          ),
          l(
            '持臺北市核發或註記的身心障礙證明，且未經政府公費收容安置。',
            'Hold a disability certificate issued or annotated by Taipei and not receive publicly funded residential placement.',
          ),
          l(
            '115 年度：法定全家應計算人口，平均每人每月收入不超過 39,960 元。',
            'For 2026, average monthly income per legally assessed family member must not exceed NT$39,960.',
          ),
          l(
            '動產：單人家庭上限 200 萬元，每增加一人增加 25 萬元。',
            'Movable assets: NT$2 million for one person, plus NT$250,000 for each additional assessed family member.',
          ),
          l(
            '全家應計算人口的土地及房屋價值合計，不超過 992 萬元。',
            'The assessed family’s total land and housing value must not exceed NT$9.92 million.',
          ),
          l(
            '全家人口按法定範圍計算，並非只看同住人數；資格由區公所審核。',
            'Family membership follows legal assessment rules, not just who lives together; the district office determines eligibility.',
          ),
        ],
        l(
          '須符合臺北市居住、證明、收入與財產條件，資格由區公所審核。',
          'Taipei residency, certificate, income and asset requirements apply; the district office assesses eligibility.',
        ),
      ),
      documents: section(
        [
          l('申請表。', 'Application form.'),
          l(
            '申請人身分證正本；14 歲以下可依規定附詳細記事戶口名簿影本。',
            'Original identity card; applicants under 14 may use the specified detailed household-register copy.',
          ),
          l(
            '租賃契約影本或借住證明；借住另附房屋稅證明或所有權狀影本。',
            'Rental agreement copy or proof of borrowed accommodation, with the required tax or ownership evidence for borrowed accommodation.',
          ),
          l(
            '申請人台北富邦銀行或郵局存摺封面影本。',
            'A copy of the applicant’s Taipei Fubon Bank or post-office passbook cover.',
          ),
          l(
            '不同戶籍的應計算人口、委託申請及其他個案文件，依區公所通知補齊。',
            'Supply documents for assessed family members at other addresses, representatives and other case-specific requirements as requested.',
          ),
        ],
        l(
          '先備妥申請表、身分證、居住及存摺文件，其他資料由區公所確認。',
          'Prepare the application, ID, accommodation and passbook documents; confirm other requirements with the district office.',
        ),
      ),
      steps: section(
        [
          l(
            '先確認是否已列冊低收入戶或中低收入戶，以免重複申請。',
            'Check whether you are already registered as a low-income household to avoid an unnecessary application.',
          ),
          l(
            '用「準備文件」清單整理資料，再向戶籍所在地區公所社會課提出申請。',
            'Use the document checklist, then submit to the social affairs section of your household-registration district office.',
          ),
          l(
            '依承辦通知補件並等待核定；本頁完成清單不代表已送件。',
            'Respond to requests for additional documents and await a decision; completing this checklist does not submit an application.',
          ),
        ],
        l(
          '備齊文件後向戶籍地區公所社會課申請，並依通知補件。',
          'Prepare the documents, apply at your registered district office and respond to any requests for more information.',
        ),
      ),
      cost: section(
        [
          l(
            '列冊低收入戶：中度以上每月 9,485 元；輕度每月 5,437 元。',
            'Registered low-income households: NT$9,485/month for moderate or greater disability; NT$5,437 for mild disability.',
          ),
          l(
            '列冊中低收入戶：中度以上每月 5,437 元；輕度每月 4,049 元。',
            'Registered lower-middle-income households: NT$5,437/month for moderate or greater disability; NT$4,049 for mild disability.',
          ),
          l(
            '非列冊低收／中低收入戶：審核通過後，中度以上每月 5,437 元；輕度每月 4,049 元。',
            'Other households, after approval: NT$5,437/month for moderate or greater disability; NT$4,049 for mild disability.',
          ),
        ],
        l(
          '每月金額依身分及核定條件而定，可查看畫面上的官方金額整理。',
          'Monthly amounts depend on the approved category; the official amounts are listed on screen.',
        ),
      ),
    },
    sources: ['living', 'living-documents', 'living-contact'],
    action: {
      label: l('查看官方申請說明', 'View official application guidance'),
      url: 'https://dosw.gov.taipei/cp.aspx?n=C764A5808F9A3B08',
    },
  },
  aids: {
    title: l('輔具費用補助', 'Assistive-device subsidy'),
    summary: l(
      '先申請核定，再購買輔具，避免失去補助。',
      'Apply for approval before buying a device to avoid losing subsidy eligibility.',
    ),
    sections: {
      overview: section(
        [
          l(
            '先依輔具項目確認是否需要醫師診斷及輔具評估。',
            'Check whether your device requires a medical diagnosis and assistive-device assessment.',
          ),
          l(
            '必須先向社會局申請，核定後才能依核定內容購買；先買再申請無法補助。',
            'Apply to the department first and buy only after approval; purchases made before application are not subsidized.',
          ),
          l(
            '購買後再辦理核銷請款，這裡可先整理準備清單。',
            'Claim reimbursement after purchase; use this page to prepare your checklist.',
          ),
        ],
        l(
          '輔具補助要先申請核定再購買，先買再申請無法補助。',
          'Get approval before buying an assistive device; purchases made before application are not subsidized.',
        ),
      ),
      eligibility: section(
        [
          l(
            '設籍臺北市，最近一年居住國內達 183 日，持本市核發或註記的身心障礙證明。',
            'Be registered in Taipei, have spent at least 183 days in Taiwan in the past year, and hold the specified Taipei disability certificate.',
          ),
          l(
            '曾領同項輔具補助者，須超過該輔具的補助年限。',
            'If previously subsidized for the same device, its minimum replacement period must have passed.',
          ),
          l(
            '同項目不能重複領取政府醫療、社會保險或其他同類補助。',
            'The same item must not also receive an overlapping government medical, insurance or similar subsidy.',
          ),
        ],
        l(
          '輔具補助有居住、使用年限及不得重複補助等條件。',
          'Residency, replacement-period and non-duplication requirements apply.',
        ),
      ),
      documents: section(
        [
          l(
            '第一階段：申請書及身分證正本。',
            'Stage one: application form and original identity card.',
          ),
          l(
            '依輔具項目：3 個月內診斷證明、輔具評估報告及其他指定文件。',
            'Where required for the device: diagnosis and assessment reports issued within three months, plus specified supporting documents.',
          ),
          l(
            '核定後請款：核銷請款書、核定公文影本及存摺影本。',
            'After approval: reimbursement form, approval letter copy and passbook copy.',
          ),
          l(
            '另備核定日起 6 個月內的購買憑證、領據及印章、保固書影本；其餘依項目規定。',
            'Also prepare a purchase receipt within six months of approval, signed receipt and seal, warranty copy and any item-specific documents.',
          ),
        ],
        l(
          '先準備申請書與身分證，評估及診斷文件依輔具項目確認。',
          'Prepare the application and ID, then confirm which assessment and diagnosis documents your device requires.',
        ),
      ),
      steps: section(
        [
          l(
            '向輔具中心確認品項、評估需求及所需文件。',
            'Confirm the device category, assessment and documents with an assistive-device centre.',
          ),
          l(
            '向社會局提出申請，等核定公文後再購買。',
            'Apply to the department and wait for its approval letter before purchase.',
          ),
          l(
            '依核定內容購買，保留憑證及保固書，再辦核銷請款。',
            'Buy the approved device, keep the receipt and warranty, then apply for reimbursement.',
          ),
        ],
        l(
          '先評估、申請並等核定，再購買和請款。',
          'Complete assessment and approval before purchase, then claim reimbursement.',
        ),
      ),
      cost: section(
        [
          l(
            '每人每 2 年最多申請 4 項，合併醫療輔具補助項次計算。',
            'Up to four items per person every two years, including medical assistive-device subsidies.',
          ),
          l(
            '金額依輔具品項、補助上限及核定結果，不能用同一金額推算所有輪椅或助聽器。',
            'Amounts depend on the device category, subsidy ceiling and approval; one amount cannot apply to all wheelchairs or hearing aids.',
          ),
        ],
        l(
          '補助額度依輔具品項及核定結果，不是所有輔具都相同。',
          'Subsidy amounts depend on the device category and approval.',
        ),
      ),
    },
    sources: ['aids'],
    action: {
      label: l('查看官方輔具說明', 'View official device guidance'),
      url: 'https://dosw.gov.taipei/cp.aspx?n=49304F9B0793FFEF',
    },
  },
  rehab: {
    title: l('復康巴士訂車準備', 'Rehab-bus booking preparation'),
    summary: l(
      '先確認資格與行程，再用官方系統或客服訂車。',
      'Confirm eligibility and your trip, then book with the official system or customer service.',
    ),
    sections: {
      overview: section(
        [
          l(
            '小型復康巴士提供預約、點對點接送。',
            'Small rehab buses provide advance-booked, point-to-point transport.',
          ),
          l(
            '乘車資格及可提前預約的日期，依戶籍和官方分級而定。',
            'Eligibility and advance-booking windows depend on residence and the official service classification.',
          ),
          l(
            '可先整理訂車資料；這裡不會查到即時車輛，也不代表已訂車。',
            'Prepare the booking details here; this page does not show live vehicles or make a booking.',
          ),
        ],
        l(
          '先確認乘車資格及可預約日期，再準備上下車地點向官方訂車。',
          'Confirm eligibility and booking dates, then prepare pickup and destination details for the official booking.',
        ),
      ),
      eligibility: section(
        [
          l(
            '臺北市持身心障礙證明的民眾，依官方等級安排預約；非臺北市民僅部分等級適用。',
            'Taipei disability-certificate holders book according to official service classes; only certain classes apply to non-residents.',
          ),
          l(
            '一般服務的起點或迄點須位於臺北市；跨區專案及個別資格請向客服確認。',
            'For regular service, pickup or destination must be in Taipei; confirm special cross-area services and individual eligibility with customer service.',
          ),
        ],
        l(
          '資格與預約時段依官方分級，跨區服務請先向客服確認。',
          'Eligibility and booking windows follow official classifications; check cross-area trips with customer service.',
        ),
      ),
      documents: section(
        [
          l('確認乘車資格與可以預約的日期。', 'Confirm eligibility and the dates you may book.'),
          l('準備乘車日期與時間。', 'Prepare your travel date and time.'),
          l('準備上車地點與下車地點。', 'Prepare pickup and destination locations.'),
          l(
            '準備官方訂車帳號或台北通登入方式；證號只在官方系統輸入。',
            'Have your official booking account or TaipeiPASS login ready; enter certificate numbers only in the official system.',
          ),
        ],
        l(
          '訂車前先備妥日期、時間、上下車地點及官方登入方式。',
          'Have the date, time, pickup, destination and official login ready before booking.',
        ),
      ),
      steps: section(
        [
          l(
            '第一次使用，先向客服確認資格、帳號及適用的預約時段。',
            'For first use, confirm eligibility, account access and the booking window with customer service.',
          ),
          l(
            '在官方訂車系統申請帳號或使用台北通登入，再依可預約日期提出用車需求。',
            'Register or sign in with TaipeiPASS on the official booking system and request a trip within your booking window.',
          ),
          l(
            '以官方系統或客服回覆確認是否訂車成功，不以本頁的準備進度判定。',
            'Confirm booking success through the official system or customer service, not this preparation checklist.',
          ),
        ],
        l(
          '首次使用先問客服確認資格與帳號，再向官方訂車並確認結果。',
          'For first use, confirm eligibility and account access with customer service, then book and confirm through the official service.',
        ),
      ),
      cost: section(
        [
          l(
            '一般服務費用按臺北市計程車費率的三分之一計算。',
            'Regular fares are calculated at one-third of the Taipei taxi fare.',
          ),
          l(
            '共乘、跨區專案及其他費用另有規定，這裡不提供即時車資報價。',
            'Shared rides, special cross-area services and other charges have separate rules; this page does not quote a live fare.',
          ),
        ],
        l(
          '一般費用按北市計程車費率三分之一計，特殊服務另洽客服。',
          'Regular fares are one-third of the Taipei taxi fare; ask customer service about special services.',
        ),
      ),
    },
    sources: ['rehab', 'rehab-booking'],
    action: {
      label: l('致電復康巴士客服', 'Call rehab-bus customer service'),
      url: 'tel:0809080650',
    },
  },
};

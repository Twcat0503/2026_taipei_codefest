/**
 * 台北通會員資料：透過 App 既有的 userinfo bridge 讀取，只留在記憶體，不寫入儲存空間。
 * 不在 App 裡（純瀏覽器）時沒有會員資料，回傳 null。每個欄位都先檢查格式，不合格就略過。
 */
export type Member = {
  idNo: string;
  realName?: string;
  phone?: string;
  email?: string;
  /** YYYY-MM-DD */
  birthday?: string;
  /** 戶籍（通訊）地址全文。 */
  address?: string;
  /** 臺北市的行政區，例如 中山區；用來代替「附近」的定位。 */
  district?: string;
};

const TIMEOUT_MS = 3000;
const TAIPEI_DISTRICT = /(中正|大同|中山|松山|大安|萬華|信義|士林|北投|內湖|南港|文山)區/;

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;

export function parseMember(data: unknown): Member | null {
  if (typeof data !== 'object' || !data) return null;
  const raw = data as Record<string, unknown>;
  const idNo =
    typeof raw.idNo === 'string' && /^[A-Z][0-9A-Z]\d{8}$/.test(raw.idNo) ? raw.idNo : null;
  if (!idNo) return null;
  const phone = text(raw.phoneNo, 20)?.replace(/[\s-]/g, '');
  const email = text(raw.email, 100);
  const birthday = text(raw.birthday, 10)?.replace(/\//g, '-');
  const address = text(raw.residentAddress, 100);
  const listed = Array.isArray(raw.addresses)
    ? ((raw.addresses as Record<string, unknown>[]).find((a) => a?.priority) ?? raw.addresses[0])
    : undefined;
  const town = typeof listed?.town === 'string' ? listed.town : undefined;
  const district = (town ?? address)?.match(TAIPEI_DISTRICT)?.[0];
  return {
    idNo,
    realName: text(raw.realName, 40),
    phone: phone && /^09\d{8}$/.test(phone) ? phone : undefined,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    birthday: birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : undefined,
    address,
    district,
  };
}

let cached: Promise<Member | null> | null = null;

/** Read once per page session; the app's member data does not change while the chat is open. */
export function readMember(): Promise<Member | null> {
  cached ??= request();
  return cached;
}

function request(): Promise<Member | null> {
  const bridge = window.flutterObject;
  if (!bridge?.addEventListener || !bridge.removeEventListener) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (member: Member | null) => {
      clearTimeout(timer);
      bridge.removeEventListener!('message', onMessage);
      if (!member) cached = null; // allow a retry later
      resolve(member);
    };
    const onMessage = (event: { data: string }) => {
      try {
        const reply = JSON.parse(event.data);
        if (reply?.name === 'userinfo') done(parseMember(reply.data));
      } catch {
        /* Unrelated or malformed bridge message. */
      }
    };
    const timer = setTimeout(() => done(null), TIMEOUT_MS);
    bridge.addEventListener!('message', onMessage);
    bridge.postMessage(JSON.stringify({ name: 'userinfo', data: null }));
  });
}

/** 身分證字號只露出前三碼與後三碼，例如 A12****789。 */
export const maskIdNo = (idNo: string) => `${idNo.slice(0, 3)}****${idNo.slice(-3)}`;
/** 手機只露出前四碼與後三碼，例如 0932***777。 */
export const maskPhone = (phone: string) => `${phone.slice(0, 4)}***${phone.slice(-3)}`;

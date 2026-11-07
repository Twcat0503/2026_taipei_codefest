/**
 * 台北通會員資料：透過 App 既有的 userinfo bridge 讀取，只留在記憶體，不寫入儲存空間。
 * 不在 App 裡（純瀏覽器）時沒有會員資料，回傳 null。
 */
export type Member = { idNo: string };

const TIMEOUT_MS = 3000;

export function readMember(): Promise<Member | null> {
  const bridge = window.flutterObject;
  if (!bridge?.addEventListener || !bridge.removeEventListener) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (member: Member | null) => {
      clearTimeout(timer);
      bridge.removeEventListener!('message', onMessage);
      resolve(member);
    };
    const onMessage = (event: { data: string }) => {
      try {
        const reply = JSON.parse(event.data);
        if (reply?.name !== 'userinfo') return;
        const idNo = reply.data?.idNo;
        done(typeof idNo === 'string' && /^[A-Z][0-9A-Z]\d{8}$/.test(idNo) ? { idNo } : null);
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

type Bridge = {
  postMessage(message: string): void;
  addEventListener?: (name: string, listener: (event: { data: unknown }) => void) => void;
  removeEventListener?: (name: string, listener: (event: { data: unknown }) => void) => void;
  onmessage?: ((event: { data: unknown }) => void) | null;
};
export function guidanceBridge(): Bridge | undefined {
  return (window as Window & { flutterObject?: Bridge }).flutterObject;
}
type Listener = (event: { data: unknown }) => void;
const legacyListeners = new WeakMap<
  Bridge,
  { listeners: Set<Listener>; receive: Listener; previous: Bridge['onmessage'] }
>();
export function listenGuideMessage(bridge: Bridge, receive: Listener): () => void {
  if (bridge.addEventListener) {
    bridge.addEventListener('message', receive);
    return () => bridge.removeEventListener?.('message', receive);
  }
  let group = legacyListeners.get(bridge);
  if (!group) {
    const listeners = new Set<Listener>();
    const previous = bridge.onmessage;
    const dispatch: Listener = (event) => {
      try {
        previous?.(event);
      } catch {
        /* Preserve independent listeners. */
      }
      for (const listener of [...listeners]) listener(event);
    };
    group = { listeners, receive: dispatch, previous };
    legacyListeners.set(bridge, group);
    bridge.onmessage = dispatch;
  }
  const subscribed = group;
  subscribed.listeners.add(receive);
  return () => {
    subscribed.listeners.delete(receive);
    if (!subscribed.listeners.size) {
      if (bridge.onmessage === subscribed.receive) bridge.onmessage = subscribed.previous;
      legacyListeners.delete(bridge);
    }
  };
}
export function initialGuidance(): { enabled: boolean; lang: string } {
  const injected = (
    window as Window & {
      __tpButtonGuidance?: { enabled?: unknown; lang?: unknown; configured?: unknown };
    }
  ).__tpButtonGuidance;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('tp-button-guidance');
  } catch {
    /* Native state remains usable. */
  }
  if (typeof injected?.enabled === 'boolean' && (injected.configured !== false || stored === null))
    return { enabled: injected.enabled, lang: injected.lang === 'en' ? 'en' : 'zh-Hant-TW' };
  try {
    return {
      enabled: localStorage.getItem('tp-button-guidance') !== 'off',
      lang: localStorage.getItem('tp-language') === 'en' ? 'en' : 'zh-Hant-TW'
    };
  } catch {
    return { enabled: true, lang: 'zh-Hant-TW' };
  }
}
/** For service templates; the assistant uses its existing native-bridge request pairing. */
export function guideRequest(
  name: string,
  data: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const bridge = guidanceBridge();
  if (!bridge) return Promise.resolve({});
  return new Promise((resolve) => {
    const requestId = `guide-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let completed = false;
    const finish = (state: Record<string, unknown>) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      unlisten();
      resolve(state);
    };
    const receive = (event: { data: unknown }) => {
      if (typeof event.data !== 'string' || event.data.length > 10000) return;
      try {
        const message = JSON.parse(event.data);
        if (message.name === name && message.data?.requestId === requestId) finish(message.data);
      } catch {
        /* Ignore unrelated or malformed replies. */
      }
    };
    const timer = setTimeout(() => finish({}), 2000);
    const unlisten = listenGuideMessage(bridge, receive);
    try {
      bridge.postMessage(JSON.stringify({ name, data: { ...data, requestId } }));
    } catch {
      finish({});
    }
  });
}
export async function loadGuidancePreference(): Promise<{ enabled: boolean; lang: string }> {
  const reply = await guideRequest('button_guidance');
  if (reply.configured === false) {
    try {
      if (localStorage.getItem('tp-button-guidance') !== null) return initialGuidance();
    } catch {
      /* Use the native default when browser storage is unavailable. */
    }
  }
  return reply.ok === true && typeof reply.enabled === 'boolean'
    ? { enabled: reply.enabled, lang: reply.lang === 'en' ? 'en' : 'zh-Hant-TW' }
    : initialGuidance();
}

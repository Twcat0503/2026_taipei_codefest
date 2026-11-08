import { requestNativeWindow } from './native-bridge';

export type LatLng = { lat: number; lng: number };

const TIMEOUT_MS = 8000;

type Bridge = NonNullable<Window['flutterObject']>;

function fromBridge(bridge: Bridge, signal: AbortSignal) {
  return new Promise<LatLng | null>((resolve) => {
    const finish = (value: LatLng | null) => {
      clearTimeout(timer);
      bridge.removeEventListener?.('message', listen);
      signal.removeEventListener('abort', cancel);
      resolve(value);
    };
    const cancel = () => finish(null);
    const listen = (event: { data: string }) => {
      try {
        const reply = JSON.parse(event.data);
        if (reply.name !== 'location') return;
        const { latitude, longitude } = reply.data ?? {};
        finish(
          typeof latitude === 'number' && typeof longitude === 'number'
            ? { lat: latitude, lng: longitude }
            : null,
        );
      } catch {
        /* A reply for another bridge message. */
      }
    };
    const timer = setTimeout(cancel, TIMEOUT_MS);
    signal.addEventListener('abort', cancel, { once: true });
    bridge.addEventListener?.('message', listen);
    bridge.postMessage(JSON.stringify({ name: 'location', data: null }));
  });
}

/** Device position for nearby searches. It is used in the browser only and never sent to the model. */
export function getLocation(signal: AbortSignal): Promise<LatLng | null> {
  if (window.flutterObject?.addEventListener) return fromBridge(window.flutterObject, signal);
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(null),
      { timeout: TIMEOUT_MS, maximumAge: 60000 },
    );
  });
}

/** Android's system geocoder; browser-only sessions can enter the address manually. */
export async function reverseAddress(
  position: LatLng,
  signal: AbortSignal,
): Promise<string | null> {
  if (!window.flutterObject) return null;
  try {
    const result = await requestNativeWindow(
      'reverse_geocode',
      {
        latitude: position.lat,
        longitude: position.lng,
      },
      signal,
    );
    return typeof result.address === 'string' && result.address.trim()
      ? result.address.trim().slice(0, 100)
      : null;
  } catch {
    return null;
  }
}

/** Inside the app, pages open through the existing open_link bridge so the chat is kept. */
export function openLink(url: string, prefill?: Record<string, string>) {
  if (url.startsWith('tel:')) {
    const number = url.slice(4);
    // 1999 uses Town Pass's own call flow (its user agreement, then the dialer);
    // other numbers open the dialer through phone_call. The user still presses call.
    if (window.flutterObject)
      window.flutterObject.postMessage(
        JSON.stringify(
          number === '1999'
            ? { name: '1999agree', data: true }
            : { name: 'phone_call', data: number },
        ),
      );
    else window.location.href = url;
    return;
  }
  if (window.flutterObject) {
    // Google Maps refuses to render inside a WebView (it redirects to intent://), so maps go
    // to the native map app through launch_map instead of a stacked WebView page.
    const name = url.startsWith('https://www.google.com/maps/') ? 'launch_map' : 'open_link';
    // Fields to fill on arrival; the app re-checks the page origin, field names and values.
    const data =
      name === 'open_link' && prefill && Object.keys(prefill).length ? { url, prefill } : url;
    window.flutterObject.postMessage(JSON.stringify({ name, data }));
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/**
 * What happened to the fields we asked the app to fill in. Even when the app accepts them the
 * page may not get filled (the form changed, the page failed), so nothing here means "filled":
 * the app itself tells the person on the page when fields are missing.
 * - requested: the app accepted the request; `dropped` are fields it refused (not allowlisted
 *   or bad values), which the person has to enter themselves.
 * - unsupported: an older app that cannot fill in; the page was opened without the details.
 * - unconfirmed: no answer from the app, so we cannot say whether anything will be filled in.
 * - browser: outside the app nothing can be filled in.
 */
export type PrefillOutcome =
  | { kind: 'requested'; dropped: string[] }
  | { kind: 'unsupported' }
  | { kind: 'unconfirmed' }
  | { kind: 'browser' };

const PREFILL_ACK_MS = 1500;

/** Open a Town Pass service page and ask the app to fill in `prefill` on arrival. */
export function openWithPrefill(
  url: string,
  prefill: Record<string, string>,
): Promise<PrefillOutcome> {
  const bridge = window.flutterObject;
  if (!bridge) {
    window.open(url, '_blank', 'noopener');
    return Promise.resolve({ kind: 'browser' });
  }
  if (!bridge.addEventListener || !bridge.removeEventListener) {
    openLink(url, prefill);
    return Promise.resolve({ kind: 'unconfirmed' });
  }
  return new Promise((resolve) => {
    const finish = (outcome: PrefillOutcome) => {
      clearTimeout(timer);
      bridge.removeEventListener!('message', listen);
      resolve(outcome);
    };
    const listen = (event: { data: string }) => {
      let reply: { name?: unknown; data?: unknown };
      try {
        reply = JSON.parse(event.data);
      } catch {
        return; /* A reply for another bridge message. */
      }
      if (reply?.name !== 'open_link') return;
      const accepted = (reply.data as { accepted?: unknown } | null)?.accepted;
      if (Array.isArray(accepted)) {
        finish({
          kind: 'requested',
          dropped: Object.keys(prefill).filter((field) => !accepted.includes(field)),
        });
      } else if (reply.data === false) {
        // An older app rejects the {url, prefill} form without opening anything.
        bridge.postMessage(JSON.stringify({ name: 'open_link', data: url }));
        finish({ kind: 'unsupported' });
      }
    };
    const timer = setTimeout(() => finish({ kind: 'unconfirmed' }), PREFILL_ACK_MS);
    bridge.addEventListener!('message', listen);
    openLink(url, prefill);
  });
}

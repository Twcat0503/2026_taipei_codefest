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

/** Inside the app, pages open through the existing open_link bridge so the chat is kept. */
export function openLink(url: string) {
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
    window.flutterObject.postMessage(JSON.stringify({ name, data: url }));
    return;
  }
  window.open(url, '_blank', 'noopener');
}

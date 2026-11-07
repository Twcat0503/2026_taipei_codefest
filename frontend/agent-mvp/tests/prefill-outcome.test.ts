import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWithPrefill } from '../src/platform/location';

const URL = 'https://taipei-pass-service.vercel.app/fee-payment/detail/fee-6/';

/** A bridge that answers open_link the way a given app version does. */
function bridge(answer: (data: unknown) => unknown | undefined) {
  const listeners = new Set<(event: { data: string }) => void>();
  const posted: { name: string; data: unknown }[] = [];
  return {
    posted,
    listeners,
    flutterObject: {
      postMessage(message: string) {
        const parsed = JSON.parse(message);
        posted.push(parsed);
        if (parsed.name !== 'open_link') return;
        const reply = answer(parsed.data);
        if (reply === undefined) return;
        const data = JSON.stringify({ name: 'open_link', data: reply });
        queueMicrotask(() => listeners.forEach((listen) => listen({ data })));
      },
      addEventListener: (_: 'message', listen: (event: { data: string }) => void) =>
        listeners.add(listen),
      removeEventListener: (_: 'message', listen: (event: { data: string }) => void) =>
        listeners.delete(listen),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('openWithPrefill', () => {
  it('reports fields the app refused so the person can enter them', async () => {
    const app = bridge(() => ({ accepted: ['water_number'] }));
    vi.stubGlobal('window', { flutterObject: app.flutterObject });
    await expect(
      openWithPrefill(URL, { water_number: '1234567890', tax_id: 'A123456789' }),
    ).resolves.toEqual({ kind: 'requested', dropped: ['tax_id'] });
    expect(app.posted).toEqual([
      {
        name: 'open_link',
        data: { url: URL, prefill: { water_number: '1234567890', tax_id: 'A123456789' } },
      },
    ]);
    expect(app.listeners.size).toBe(0);
  });

  it('opens the page without details when an older app rejects the request', async () => {
    const app = bridge((data) => (typeof data === 'string' ? undefined : false));
    vi.stubGlobal('window', { flutterObject: app.flutterObject });
    await expect(openWithPrefill(URL, { water_number: '1234567890' })).resolves.toEqual({
      kind: 'unsupported',
    });
    expect(app.posted.at(-1)).toEqual({ name: 'open_link', data: URL });
  });

  it('never claims success when the app does not answer', async () => {
    vi.useFakeTimers();
    const app = bridge(() => undefined);
    vi.stubGlobal('window', { flutterObject: app.flutterObject });
    const outcome = openWithPrefill(URL, { water_number: '1234567890' });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(outcome).resolves.toEqual({ kind: 'unconfirmed' });
    expect(app.listeners.size).toBe(0);
  });

  it('ignores replies to other bridge messages', async () => {
    vi.useFakeTimers();
    const app = bridge(() => undefined);
    vi.stubGlobal('window', { flutterObject: app.flutterObject });
    const outcome = openWithPrefill(URL, { water_number: '1234567890' });
    app.listeners.forEach((listen) => listen({ data: '{"name":"location","data":false}' }));
    app.listeners.forEach((listen) => listen({ data: 'not json' }));
    await vi.advanceTimersByTimeAsync(1500);
    await expect(outcome).resolves.toEqual({ kind: 'unconfirmed' });
  });

  it('says nothing can be filled in from a browser', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    await expect(openWithPrefill(URL, { water_number: '1234567890' })).resolves.toEqual({
      kind: 'browser',
    });
    expect(open).toHaveBeenCalledWith(URL, '_blank', 'noopener');
  });
});

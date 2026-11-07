import { afterEach, describe, expect, it, vi } from 'vitest';

import { useConnectionMessage } from '../useConnectionMessage';

type FlutterGlobal = { flutterObject?: { postMessage: (message: string) => void } };

describe('useConnectionMessage', () => {
  afterEach(() => {
    delete (globalThis as FlutterGlobal).flutterObject;
  });

  it('does nothing outside the app (no flutterObject)', () => {
    expect(() => useConnectionMessage('userinfo', null)).not.toThrow();
  });

  it('posts {name, data} as JSON to flutterObject inside the app', () => {
    const postMessage = vi.fn();
    (globalThis as FlutterGlobal).flutterObject = { postMessage };

    useConnectionMessage('location', { accuracy: 'high' });

    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ name: 'location', data: { accuracy: 'high' } })
    );
  });
});

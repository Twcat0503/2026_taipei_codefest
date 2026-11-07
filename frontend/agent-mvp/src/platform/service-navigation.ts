import { billCategories, type BillCategory } from '../agent/skills/bills';

// Same development service host as the Flutter bill page. No IDs or credentials in URLs.
const serviceOrigin = 'https://taipei-pass-service.vercel.app';
export function billServiceUrl(category: BillCategory | 'history') {
  if (category !== 'history' && !Object.hasOwn(billCategories, category))
    throw new Error('UNKNOWN_SERVICE_ROUTE');
  return new URL(
    category === 'history' ? '/fee-payment/history/' : billCategories[category].path,
    serviceOrigin,
  ).href;
}

/** Native open_link has no success acknowledgement. Never claim the page loaded. */
export function requestNativeBillPage(category: BillCategory | 'history'): 'requested' | 'browser' {
  const url = billServiceUrl(category);
  if (!window.flutterObject) return 'browser';
  window.flutterObject.postMessage(JSON.stringify({ name: 'open_link', data: url }));
  return 'requested';
}

/**
 * Screen reader announcements through two always-present, visually hidden live regions.
 * Mount them once at startup: live regions are only reliable when they exist before their text changes.
 */

type Politeness = 'polite' | 'assertive';

/** Inline so the regions do not depend on app CSS. */
const visuallyHidden = [
  'position:absolute',
  'width:1px',
  'height:1px',
  'margin:-1px',
  'overflow:hidden',
  'clip:rect(0 0 0 0)',
  'clip-path:inset(50%)',
  'white-space:nowrap',
  'border:0',
  'padding:0',
].join(';');

/** Gap between clearing and refilling a region, so an identical message is announced again. */
const ANNOUNCE_DELAY_MS = 50;

let regions: Record<Politeness, HTMLElement> | undefined;
const pending = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

function createRegion(doc: Document, politeness: Politeness) {
  const region = doc.createElement('div');
  region.setAttribute('role', politeness === 'polite' ? 'status' : 'alert');
  region.setAttribute('aria-live', politeness);
  region.setAttribute('aria-atomic', 'true');
  region.setAttribute('data-a11y-announcer', politeness);
  region.style.cssText = visuallyHidden;
  doc.body.appendChild(region);
  return region;
}

/** Creates the polite (`role="status"`) and assertive (`role="alert"`) regions; later calls do nothing. */
export function mountAnnouncer(doc: Document = document): void {
  if (regions || !doc.body) return;
  regions = { polite: createRegion(doc, 'polite'), assertive: createRegion(doc, 'assertive') };
}

/** Announces `message` to screen readers. Does nothing for empty messages or before mounting. */
export function announce(
  message: string,
  { assertive = false }: { assertive?: boolean } = {},
): void {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || !regions) return;
  const region = assertive ? regions.assertive : regions.polite;
  clearTimeout(pending.get(region));
  region.textContent = '';
  pending.set(
    region,
    setTimeout(() => {
      pending.delete(region);
      region.textContent = text;
    }, ANNOUNCE_DELAY_MS),
  );
}

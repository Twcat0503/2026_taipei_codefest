import { conciseGuidance } from './concise-guidance';

export type ControlHelp = { label: string; purpose: string; fixed: boolean };
export const controlSelector =
  'button, a[href], summary, [role="button"], input:not([type="hidden"]), textarea, select';
export function controlTarget(event: Event): HTMLElement | null {
  if (!(event.target instanceof Element)) return null;
  const label = event.target.closest('label');
  const direct = event.target.closest<HTMLElement>(controlSelector);
  if (direct && (!label || label.contains(direct))) return direct;
  return label?.control ?? direct;
}
export function controlName(control: HTMLElement, fallback: string): string {
  const labelled = control
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => control.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
  const labels = 'labels' in control ? (control as HTMLInputElement).labels : null;
  const label = labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
  label
    ?.querySelectorAll('input, textarea, select, [aria-hidden="true"]')
    .forEach((node) => node.remove());
  // Never use a field's value, file name, surrounding form or conversation as a label.
  const field = control.matches('input, textarea, select');
  return (
    (
      labelled ||
      control.getAttribute('aria-label') ||
      label?.textContent ||
      (!field ? control.textContent : '') ||
      fallback
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160) || fallback
  );
}
type Options = {
  help: (control: HTMLElement) => ControlHelp;
  locale: () => string;
  gesture: () => string;
  disabledHint: () => string;
  screenReaderHint: () => string;
  screenReader: () => boolean | null;
  explain: (
    label: string,
    purpose: string,
    signal: AbortSignal
  ) => AsyncIterable<string> | Promise<string>;
  reportSpeechFailure: (failed: boolean) => void;
  speak: (text: string, finished: () => void, failed: () => void) => void;
  stop: () => void;
};
/** Shared by the assistant and service forms, including controls teleported into dialogs. */
export function createInteractionGuidance(root: HTMLElement, options: Options) {
  let enabled = false;
  let selected: { control: HTMLElement; label: string; purpose: string; time: number } | undefined;
  let editing: HTMLElement | null = null;
  let forwardedFile: HTMLInputElement | null = null;
  let pending: AbortController | undefined;
  let delay: ReturnType<typeof setTimeout> | undefined;
  let speaking = false;
  let queue: string[] = [];
  let lastActivation = -Infinity;
  const originals = new Map<HTMLElement, string | null>();
  const observer = new MutationObserver(decorate);
  const disabled = (control: HTMLElement) =>
    control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true';
  const field = (control: HTMLElement) =>
    control.matches(
      'textarea, select, input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="checkbox"]):not([type="radio"])'
    );
  const exempt = (control: HTMLElement) => control.hasAttribute('data-guide-toggle');
  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const repeat = (control: HTMLElement) => {
    const help = options.help(control);
    return (
      selected?.control === control &&
      selected.label === help.label &&
      selected.purpose === help.purpose &&
      performance.now() - selected.time <= 1200
    );
  };
  function cancel() {
    clearTimeout(delay);
    const old = pending;
    pending = undefined;
    old?.abort();
    queue = [];
    if (speaking) options.stop();
    speaking = false;
    selected?.control.removeAttribute('data-button-selected');
    selected = undefined;
    options.reportSpeechFailure(false);
  }
  function restore(control: HTMLElement) {
    const value = originals.get(control);
    if (value == null) control.removeAttribute('aria-description');
    else control.setAttribute('aria-description', value);
    originals.delete(control);
  }
  function decorate() {
    if (!enabled) return;
    for (const control of root.querySelectorAll<HTMLElement>(controlSelector)) {
      if (exempt(control)) continue;
      if (!originals.has(control)) originals.set(control, control.getAttribute('aria-description'));
      const hint = disabled(control)
        ? options.disabledHint()
        : options.screenReader() === true
          ? options.screenReaderHint()
          : options.gesture();
      control.setAttribute(
        'aria-description',
        [
          originals.get(control),
          options.help(control).purpose,
          control.hasAttribute('data-guide-immediate') ? '' : hint
        ]
          .filter(Boolean)
          .join(' ')
      );
    }
    for (const control of originals.keys())
      if (!root.contains(control)) {
        restore(control);
        if (selected?.control === control) cancel();
      }
  }
  function inspect(control: HTMLElement) {
    cancel();
    const locale = options.locale();
    const help = options.help(control);
    const unavailable = disabled(control);
    selected = { control, label: help.label, purpose: help.purpose, time: performance.now() };
    control.setAttribute('data-button-selected', 'true');
    if (!unavailable && !field(control) && !control.matches('input[type="file"]'))
      control.focus({ preventScroll: true });
    const controller = new AbortController();
    pending = controller;
    const current = () =>
      pending === controller &&
      !controller.signal.aborted &&
      control.isConnected &&
      locale === options.locale() &&
      options.help(control).label === help.label &&
      options.help(control).purpose === help.purpose;
    const pump = () => {
      if (!current() || speaking || options.screenReader() === true) return;
      const text = queue.shift();
      if (!text) return;
      speaking = true;
      options.speak(
        text,
        () => {
          if (current()) {
            speaking = false;
            pump();
          }
        },
        () => {
          if (current()) {
            speaking = false;
            queue = [];
            controller.abort();
            options.reportSpeechFailure(true);
          }
        }
      );
    };
    const enqueue = (text: string) => {
      if (!current() || !text.trim()) return;
      queue.push(text);
      pump();
    };
    if (help.fixed || unavailable) {
      enqueue(unavailable ? options.disabledHint() : help.purpose);
      return;
    }
    delay = setTimeout(async () => {
      let description = '';
      try {
        const result = options.explain(help.label, help.purpose, controller.signal);
        if (Symbol.asyncIterator in result) {
          for await (const part of result) {
            if (!current()) return;
            description += part;
            if (!conciseGuidance(description, locale)) {
              description = '';
              break;
            }
          }
        } else {
          description = await result;
        }
      } catch {
        description = '';
      }
      enqueue(conciseGuidance(description, locale) ?? help.purpose);
    }, 100);
  }
  function pointerDown(event: PointerEvent) {
    if (!enabled || options.screenReader() === true || event.button !== 0) return;
    const control = controlTarget(event);
    if (!control || !root.contains(control) || exempt(control)) return;
    if (field(control) && editing !== control && !repeat(control)) block(event);
  }
  function click(event: MouseEvent) {
    if (!enabled) return;
    if (event.target === forwardedFile) {
      forwardedFile = null;
      return;
    }
    const control = controlTarget(event);
    if (!control || !root.contains(control) || exempt(control)) {
      cancel();
      return;
    }
    if (
      event.detail === 0 ||
      options.screenReader() === true ||
      (field(control) && editing === control)
    ) {
      cancel();
      return;
    }
    if (control.hasAttribute('data-guide-immediate') && !disabled(control)) {
      inspect(control);
      return;
    }
    if (repeat(control) && !disabled(control)) {
      const file = control instanceof HTMLLabelElement ? control.control : control;
      if (file instanceof HTMLInputElement && file.type === 'file') {
        forwardedFile = file;
        queueMicrotask(() => {
          if (forwardedFile === file) forwardedFile = null;
        });
      }
      cancel();
      lastActivation = performance.now();
      return;
    }
    if (event.detail > 1 && performance.now() - lastActivation <= 1200) {
      block(event);
      return;
    }
    block(event);
    inspect(control);
  }
  function pointerUp(event: PointerEvent) {
    if (!enabled || options.screenReader() === true) return;
    const control = controlTarget(event);
    if (control && disabled(control) && !exempt(control)) inspect(control);
  }
  function focus(event: FocusEvent) {
    const control = controlTarget(event);
    editing = control && field(control) ? control : null;
    if (selected && control !== selected.control) cancel();
  }
  const onHide = () => {
    editing = null;
    cancel();
  };
  root.addEventListener('pointerdown', pointerDown, true);
  root.addEventListener('click', click, true);
  root.addEventListener('pointerup', pointerUp, true);
  root.addEventListener('focusin', focus);
  window.addEventListener('pagehide', onHide);
  return {
    cancel,
    refresh: decorate,
    enable(value: boolean) {
      cancel();
      enabled = value;
      editing = null;
      observer.disconnect();
      if (value) {
        root.setAttribute('data-button-guidance', 'true');
        decorate();
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['aria-label', 'aria-labelledby', 'disabled']
        });
      } else {
        root.removeAttribute('data-button-guidance');
        for (const control of originals.keys()) restore(control);
      }
    },
    dispose() {
      this.enable(false);
      root.removeEventListener('pointerdown', pointerDown, true);
      root.removeEventListener('click', click, true);
      root.removeEventListener('pointerup', pointerUp, true);
      root.removeEventListener('focusin', focus);
      window.removeEventListener('pagehide', onHide);
    }
  };
}

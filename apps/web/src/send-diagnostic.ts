/** Temporary, content-free local Send diagnostic. No persistence or telemetry. */
export interface SendDiagnosticEntry {
  ms: number;
  event: string;
  phase: 'capture' | 'settled';
  target: 'composer' | 'send' | 'plus' | 'dictate' | 'handle' | 'menu' | 'composer-surface' | 'other';
  inComposer: boolean;
  pathInComposer: boolean;
  focused: SendDiagnosticEntry['target'];
  prevented: boolean;
  disabled: boolean;
  pointer: 'touch' | 'mouse' | 'pen' | 'none';
  viewport: number[];
  button: number[];
}
const limit = 128;
let entries: SendDiagnosticEntry[] = [];
// Returns metadata only; explicit copy is the sole owner retrieval action.
export function readSendDiagnostic(): SendDiagnosticEntry[] {
  return entries.map(entry => ({ ...entry, viewport: [...entry.viewport], button: [...entry.button] }));
}
export function observeSendDiagnostic(input: HTMLTextAreaElement, send: HTMLButtonElement) {
  entries = [];
  const started = performance.now();
  let disposed = false;
  const pending = new Set<number>();
  let observing = document.activeElement === input;
  const inComposer = (target: EventTarget | null) => target instanceof Element &&
    Boolean(target.closest('.conversation-input, .more-menu-list, .more-menu-flyout'));
  const classify = (target: EventTarget | null): SendDiagnosticEntry['target'] => {
    if (target === input) return 'composer';
    if (target instanceof Node && send.contains(target)) return 'send';
    if (!(target instanceof Element)) return 'other';
    if (target.closest('.more-menu-list, .more-menu-flyout')) return 'menu';
    if (target.closest('.composer-more')) return 'plus';
    if (target.closest('.composer-dictate')) return 'dictate';
    if (target.closest('.conversation-handle')) return 'handle';
    return inComposer(target) ? 'composer-surface' : 'other';
  };
  const finite = (value: number) => Number.isFinite(value) ? Math.round(value) : 0;
  const record = (event: Event, phase: SendDiagnosticEntry['phase'], pathInComposer = event.composedPath().some(inComposer),
    target = classify(event.target), contained = inComposer(event.target)) => {
    if (disposed) return;
    const rect = send.getBoundingClientRect();
    const viewport = window.visualViewport;
    const pointer = 'pointerType' in event ? event.pointerType : '';
    entries.push({
      ms: finite(performance.now() - started), event: event.type, phase,
      target, inComposer: contained,
      pathInComposer, focused: classify(document.activeElement),
      prevented: event.defaultPrevented, disabled: send.disabled,
      pointer: pointer === 'touch' || pointer === 'mouse' || pointer === 'pen' ? pointer : 'none',
      viewport: [finite(viewport?.width ?? window.innerWidth), finite(viewport?.height ?? window.innerHeight),
        finite(viewport?.offsetTop ?? 0), finite((viewport?.scale ?? 1) * 100)],
      button: [rect.x, rect.y, rect.width, rect.height].map(finite),
    });
    if (entries.length > limit) entries.splice(0, entries.length - limit);
  };
  const onEvent = (event: Event) => {
    if (event.type === 'focusin' && event.target === input) observing = true;
    if (!observing) return;
    // Never observe unrelated interactions before an active composer session.
    const pathInComposer = event.composedPath().some(inComposer);
    const target = classify(event.target);
    const contained = inComposer(event.target);
    record(event, 'capture', pathInComposer, target, contained);
    if (['pointerdown', 'mousedown', 'touchstart', 'click', 'submit'].includes(event.type)) {
      // Native dispatch can checkpoint microtasks between listeners. A task
      // runs after propagation/default actions, including React's cancellation.
      const timer = window.setTimeout(() => {
        pending.delete(timer);
        record(event, 'settled', pathInComposer, target, contained);
      }, 0);
      pending.add(timer);
    }
    if (event.type === 'focusin' && !inComposer(event.target) && event.target !== input && event.target !== send) observing = false;
  };
  const options = { capture: true, passive: true };
  const types = ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel',
    'mousedown', 'mouseup', 'click', 'submit', 'focusin', 'focusout'];
  for (const type of types) document.addEventListener(type, onEvent, options);
  const onViewport = (event: Event) => { if (observing) record(event, 'capture'); };
  window.visualViewport?.addEventListener('resize', onViewport, options);
  window.visualViewport?.addEventListener('scroll', onViewport, options);
  window.addEventListener('resize', onViewport, options);
  return () => {
    disposed = true;
    for (const timer of pending) window.clearTimeout(timer);
    pending.clear();
    for (const type of types) document.removeEventListener(type, onEvent, options);
    window.visualViewport?.removeEventListener('resize', onViewport, options);
    window.visualViewport?.removeEventListener('scroll', onViewport, options);
    window.removeEventListener('resize', onViewport, options);
  };
}

/** Explicit owner action only. Never reads the existing clipboard. */
export async function copySendDiagnostic(): Promise<'copied' | 'empty' | 'unavailable' | 'failed'> {
  const trace = readSendDiagnostic();
  if (trace.length === 0) return 'empty';
  try {
    if (!navigator.clipboard?.writeText) return 'unavailable';
    await navigator.clipboard.writeText(JSON.stringify({ version: 1, events: trace }));
    return 'copied';
  } catch {
    return 'failed';
  }
}

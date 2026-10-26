/** Temporary, content-free local Send diagnostic. No persistence or telemetry. */
export interface SendDiagnosticEntry {
  ms: number;
  event: string;
  phase: 'capture' | 'settled';
  target: 'composer' | 'send' | 'other';
  focused: 'composer' | 'send' | 'other';
  prevented: boolean;
  disabled: boolean;
  pointer: 'touch' | 'mouse' | 'pen' | 'none';
  viewport: number[];
  button: number[];
}
const limit = 128;
let entries: SendDiagnosticEntry[] = [];
// Retrieval is local only. No UI, clipboard, upload or global browser API yet.
export function readSendDiagnostic(): SendDiagnosticEntry[] {
  return entries.map(entry => ({ ...entry, viewport: [...entry.viewport], button: [...entry.button] }));
}
export function observeSendDiagnostic(input: HTMLTextAreaElement, send: HTMLButtonElement) {
  entries = [];
  const started = performance.now();
  let disposed = false;
  let observing = document.activeElement === input;
  const classify = (target: EventTarget | null): SendDiagnosticEntry['target'] =>
    target === input ? 'composer' : target instanceof Node && send.contains(target) ? 'send' : 'other';
  const finite = (value: number) => Number.isFinite(value) ? Math.round(value) : 0;
  const record = (event: Event, phase: SendDiagnosticEntry['phase']) => {
    if (disposed) return;
    const rect = send.getBoundingClientRect();
    const viewport = window.visualViewport;
    const pointer = 'pointerType' in event ? event.pointerType : '';
    entries.push({
      ms: finite(performance.now() - started), event: event.type, phase,
      target: classify(event.target), focused: classify(document.activeElement),
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
    record(event, 'capture');
    if (['pointerdown', 'mousedown', 'touchstart', 'click', 'submit'].includes(event.type)) {
      queueMicrotask(() => record(event, 'settled'));
    }
    if (event.type === 'focusin' && classify(event.target) === 'other') observing = false;
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
    for (const type of types) document.removeEventListener(type, onEvent, options);
    window.visualViewport?.removeEventListener('resize', onViewport, options);
    window.visualViewport?.removeEventListener('scroll', onViewport, options);
    window.removeEventListener('resize', onViewport, options);
  };
}

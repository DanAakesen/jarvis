/** Restore a dismissed popover after the pointer's default focus action.
 * A deliberate press on another control still keeps that control's focus. */
export function returnFocusAfterOutsidePress(trigger: HTMLElement | null) {
  if (!trigger?.isConnected) return;
  trigger.focus({ preventScroll: true });
  window.setTimeout(() => {
    const active = document.activeElement;
    if (trigger.isConnected && (active === document.body || active?.matches('main, [role="main"]'))) {
      trigger.focus({ preventScroll: true });
    }
  }, 0);
}

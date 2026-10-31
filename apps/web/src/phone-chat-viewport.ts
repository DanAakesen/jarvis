import { useLayoutEffect, type RefObject } from 'react';

export function usePhoneChatViewport(shell: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const element = shell.current;
    if (!enabled || !element) return;
    const viewport = window.visualViewport;
    let observedHeight = viewport?.height ?? window.innerHeight;
    let focusedHeight: number | null = null;
    let focusedTyping = false;
    let composerTapped = false;
    let focusFrame = 0;
    const measure = () => {
      // Pinch zoom is not a keyboard inset; leave the layout available for native panning.
      const normalScale = !viewport || Math.abs(viewport.scale - 1) < .01;
      const top = normalScale ? Math.max(0, viewport?.offsetTop ?? 0) : 0;
      const visibleHeight = viewport?.height ?? window.innerHeight;
      const input = document.activeElement;
      const composerFocused = input instanceof HTMLTextAreaElement && input.id === 'message' && element.contains(input);
      const composerControlFocused = focusedHeight !== null && input instanceof Element && element.contains(input) &&
        Boolean(input.closest('.conversation-input, .more-menu-list, .more-menu-flyout'));
      // Startup and focus restoration can focus the composer without opening a
      // keyboard. Keep a pre-shrink height even when resize arrives before focus.
      // An already-short viewport with no inset/history is ambiguous, not typing.
      if (!composerFocused && !composerControlFocused) {
        focusedHeight = null;
        focusedTyping = false;
        composerTapped = false;
      } else if (normalScale) {
        focusedHeight ??= observedHeight;
        if (visibleHeight < focusedHeight - 120) {
          focusedTyping = true;
          focusedHeight = visibleHeight;
        } else if (visibleHeight > focusedHeight + 120) {
          // Native Hide Keyboard may leave the caret focused. Observe expansion
          // across multiple resize frames, then allow a later shrink to reopen.
          focusedTyping = false;
          focusedHeight = visibleHeight;
          composerTapped = false;
        }
      }
      if (normalScale) observedHeight = Math.max(observedHeight, visibleHeight);
      const keyboardInset = viewport && Math.max(window.innerHeight, document.documentElement.clientHeight) - visibleHeight - top > 120;
      // iOS can shrink both layout and visual viewports when the app is already
      // short. After a composer tap, screen.height remains the stable reference.
      const screenKeyboardInset = composerTapped && composerFocused && window.screen.height - visibleHeight - top > 120;
      const keyboardOpen = normalScale && Boolean(focusedTyping || keyboardInset || screenKeyboardInset);
      element.setAttribute('data-keyboard-open', String(keyboardOpen));
      const height = normalScale && viewport ? `${viewport.height}px` : '100dvh';
      for (const [name, value] of [['--phone-chat-top', `${top}px`], ['--phone-chat-height', height]] as const) {
        if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
      }
    };
    const focusChanged = (event: FocusEvent) => {
      if (event.type === 'focusin') measure();
      // activeElement can still be the old input during focusout. Recheck once
      // focus has settled, without requiring a subsequent viewport event. Keep
      // the dock steady while focus moves to its controls before their click.
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(measure);
    };
    let outsidePress: { id: number; x: number; y: number; input: HTMLTextAreaElement } | null = null;
    const cancelOutsidePress = () => { outsidePress = null; };
    const outsideComposer = (target: EventTarget | null) => target instanceof Element &&
      !target.closest('.conversation-input, .more-menu-list, .more-menu-flyout');
    const startOutsidePress = (event: PointerEvent) => {
      if (event.isPrimary && event.target instanceof Element && event.target.closest('.conversation-input')) {
        composerTapped = true;
        measure();
      }
      // A second finger abandons the tap rather than becoming a new candidate.
      cancelOutsidePress();
      const input = document.activeElement;
      if (event.pointerType !== 'touch' || !event.isPrimary || !(input instanceof HTMLTextAreaElement) ||
        input.id !== 'message' || !element.contains(input) || !outsideComposer(event.target)) return;
      outsidePress = { id: event.pointerId, x: event.clientX, y: event.clientY, input };
    };
    const moveOutsidePress = (event: PointerEvent) => {
      if (outsidePress?.id === event.pointerId &&
        Math.hypot(event.clientX - outsidePress.x, event.clientY - outsidePress.y) > 8) cancelOutsidePress();
    };
    const finishOutsidePress = (event: PointerEvent) => {
      if (outsidePress?.id !== event.pointerId) return;
      moveOutsidePress(event);
      const press = outsidePress;
      cancelOutsidePress();
      // A touch down may start native scrolling. Dismiss only a completed tap,
      // never a pan/cancel, and leave scrolling and control activation native.
      if (press && document.activeElement === press.input && outsideComposer(event.target)) press.input.blur();
    };
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('pageshow', measure);
    document.addEventListener('focusin', focusChanged);
    document.addEventListener('focusout', focusChanged);
    document.addEventListener('pointerdown', startOutsidePress);
    document.addEventListener('pointermove', moveOutsidePress);
    document.addEventListener('pointerup', finishOutsidePress);
    document.addEventListener('pointercancel', cancelOutsidePress);
    document.addEventListener('scroll', cancelOutsidePress, true);
    return () => {
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('pageshow', measure);
      document.removeEventListener('focusin', focusChanged);
      document.removeEventListener('focusout', focusChanged);
      document.removeEventListener('pointerdown', startOutsidePress);
      document.removeEventListener('pointermove', moveOutsidePress);
      document.removeEventListener('pointerup', finishOutsidePress);
      document.removeEventListener('pointercancel', cancelOutsidePress);
      document.removeEventListener('scroll', cancelOutsidePress, true);
      cancelAnimationFrame(focusFrame);
      element.removeAttribute('data-keyboard-open');
      element.style.removeProperty('--phone-chat-top');
      element.style.removeProperty('--phone-chat-height');
    };
  }, [enabled, shell]);
}

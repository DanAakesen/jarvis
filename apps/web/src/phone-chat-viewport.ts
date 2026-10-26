import { useLayoutEffect, type RefObject } from 'react';

export function usePhoneChatViewport(shell: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const element = shell.current;
    if (!enabled || !element) return;
    const viewport = window.visualViewport;
    let focusedHeight: number | null = null;
    let focusedTyping = false;
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
      // Layout and visual viewports can shrink together, including before this hook
      // mounts. A focused composer must not depend on a measurable keyboard gap.
      if (!composerFocused && !composerControlFocused) {
        focusedHeight = null;
        focusedTyping = false;
      } else if (normalScale) {
        if (focusedHeight === null || visibleHeight < focusedHeight - 120) {
          focusedTyping = true;
          focusedHeight = visibleHeight;
        } else if (visibleHeight > focusedHeight + 120) {
          // Native Hide Keyboard may leave the caret focused. Observe expansion
          // across multiple resize frames, then allow a later shrink to reopen.
          focusedTyping = false;
          focusedHeight = visibleHeight;
        }
      }
      const keyboardInset = viewport && Math.max(window.innerHeight, document.documentElement.clientHeight) - visibleHeight - top > 120;
      const keyboardOpen = normalScale && Boolean(focusedTyping || keyboardInset);
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
    const dismissOutside = (event: PointerEvent) => {
      const input = document.activeElement;
      if (event.pointerType !== 'touch' || !(input instanceof HTMLTextAreaElement) ||
        input.id !== 'message' || !element.contains(input) || !(event.target instanceof Element) ||
        event.target.closest('.conversation-input, .more-menu-list, .more-menu-flyout')) return;
      input.blur();
    };
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('pageshow', measure);
    document.addEventListener('focusin', focusChanged);
    document.addEventListener('focusout', focusChanged);
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('pageshow', measure);
      document.removeEventListener('focusin', focusChanged);
      document.removeEventListener('focusout', focusChanged);
      document.removeEventListener('pointerdown', dismissOutside);
      cancelAnimationFrame(focusFrame);
      element.removeAttribute('data-keyboard-open');
      element.style.removeProperty('--phone-chat-top');
      element.style.removeProperty('--phone-chat-height');
    };
  }, [enabled, shell]);
}

import { useLayoutEffect, type RefObject } from 'react';

export function usePhoneChatViewport(shell: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const element = shell.current;
    if (!enabled || !element) return;
    const viewport = window.visualViewport;
    const measure = () => {
      // Pinch zoom is not a keyboard inset; leave the layout available for native panning.
      const normalScale = !viewport || Math.abs(viewport.scale - 1) < .01;
      const top = normalScale ? Math.max(0, viewport?.offsetTop ?? 0) : 0;
      const height = normalScale && viewport ? `${viewport.height}px` : '100dvh';
      for (const [name, value] of [['--phone-chat-top', `${top}px`], ['--phone-chat-height', height]] as const) {
        if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
      }
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
    document.addEventListener('focusin', measure);
    document.addEventListener('focusout', measure);
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('pageshow', measure);
      document.removeEventListener('focusin', measure);
      document.removeEventListener('focusout', measure);
      document.removeEventListener('pointerdown', dismissOutside);
      element.style.removeProperty('--phone-chat-top');
      element.style.removeProperty('--phone-chat-height');
    };
  }, [enabled, shell]);
}

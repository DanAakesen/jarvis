import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { VoiceLanguage } from './voice-client';
import { voiceLanguages } from './voice-language';

export type MoreMenuAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Explains why an action is unavailable; announced with the disabled item and shown as its tooltip. */
  description?: string;
};

function MenuIcon({ name }: { name: 'more' | 'attach' | 'globe' | 'chevron' | 'check' }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'more':
      return <svg {...common} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>;
    case 'attach':
      return <svg {...common}><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg>;
    case 'globe':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></svg>;
    case 'chevron':
      return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case 'check':
      return <svg {...common}><path d="m5 12.5 4.5 4.5L19 7" /></svg>;
  }
}

function focusItem(container: HTMLElement | null, move: 'first' | 'last' | 'next' | 'previous' | 'checked') {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"], :scope > [role="none"] > [role^="menuitem"]'));
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  const index = move === 'first' ? 0
    : move === 'last' ? items.length - 1
      : move === 'checked' ? Math.max(0, items.findIndex((item) => item.getAttribute('aria-checked') === 'true'))
        : move === 'next' ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
  items[index]?.focus();
}

/**
 * Shared three-dot conversation menu. When the caller passes language state, Language is the first row
 * and opens a Danish/English flyout bound to it; callers may add further actions below it. The same
 * menu, with an attachment trigger and no Language row, serves the composer's attachment actions.
 */
export function ConversationMoreMenu({
  language,
  onLanguageChange,
  actions = [],
  align = 'start',
  className,
  label = 'More options',
  icon = 'more',
  languageNote,
}: {
  language?: VoiceLanguage;
  onLanguageChange?: (language: VoiceLanguage) => void;
  actions?: MoreMenuAction[];
  align?: 'start' | 'end';
  className?: string;
  label?: string;
  icon?: 'more' | 'attach';
  /** Explains how a language choice applies, shown inside the Language flyout. */
  languageNote?: string;
}) {
  const id = useId();
  const menuId = `${id}-menu`;
  const languageMenuId = `${id}-language`;
  const languageNoteId = `${id}-language-note`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const languageItem = useRef<HTMLButtonElement>(null);
  const languageMenu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const pendingFocus = useRef<'first' | 'last' | 'checked' | null>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setLanguageOpen(false);
    pendingFocus.current = null;
    if (restoreFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close, open]);

  useEffect(() => {
    const move = pendingFocus.current;
    if (!move) return;
    pendingFocus.current = null;
    if (languageOpen) focusItem(languageMenu.current, move);
    else if (open) focusItem(menu.current, move);
  }, [open, languageOpen]);

  const openMenu = (move: 'first' | 'last') => {
    pendingFocus.current = move;
    setLanguageOpen(false);
    setOpen(true);
  };

  const openLanguage = () => {
    if (languageOpen) {
      focusItem(languageMenu.current, 'checked');
      return;
    }
    pendingFocus.current = 'checked';
    setLanguageOpen(true);
  };

  const closeLanguage = () => {
    setLanguageOpen(false);
    languageItem.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>, submenu: boolean) => {
    const container = submenu ? languageMenu.current : menu.current;
    if (!submenu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) setLanguageOpen(false);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(container, 'next');
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(container, 'previous');
        break;
      case 'Home':
        event.preventDefault();
        focusItem(container, 'first');
        break;
      case 'End':
        event.preventDefault();
        focusItem(container, 'last');
        break;
      case 'ArrowRight':
        if (submenu || document.activeElement !== languageItem.current) return;
        event.preventDefault();
        openLanguage();
        break;
      case 'ArrowLeft':
        if (!submenu) return;
        event.preventDefault();
        closeLanguage();
        break;
      case 'Escape':
        event.preventDefault();
        if (submenu) closeLanguage();
        else close(true);
        break;
      case 'Tab':
        close(false);
        return;
      default:
        return;
    }
    event.stopPropagation();
  };

  return (
    <div
      ref={root}
      className={`more-menu${className ? ` ${className}` : ''}`}
      data-open={open}
      data-align={align}
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !root.current?.contains(event.relatedTarget)) close(false);
      }}
    >
      <button
        ref={trigger}
        className="more-menu-trigger"
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onTriggerKeyDown}
      >
        <MenuIcon name={icon} />
      </button>
      {open && (
        <div ref={menu} id={menuId} className="more-menu-list luminous-glass" role="menu" aria-label={label}
          onKeyDown={(event) => onMenuKeyDown(event, false)}>
          {language !== undefined && onLanguageChange && <div role="none" className="more-menu-language">
            <button
              ref={languageItem}
              className="more-menu-item"
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-haspopup="menu"
              aria-expanded={languageOpen}
              aria-controls={languageOpen ? languageMenuId : undefined}
              onClick={() => (languageOpen ? closeLanguage() : openLanguage())}
            >
              <MenuIcon name="globe" />
              <span className="more-menu-label">Language</span>
              <MenuIcon name="chevron" />
            </button>
            {languageOpen && (
              <div ref={languageMenu} id={languageMenuId} className="more-menu-flyout luminous-glass" role="menu"
                aria-label="Language" aria-describedby={languageNote ? languageNoteId : undefined}
                onKeyDown={(event) => onMenuKeyDown(event, true)}>
                {voiceLanguages.map((option) => (
                  <button
                    key={option.value}
                    className="more-menu-item"
                    type="button"
                    role="menuitemradio"
                    tabIndex={-1}
                    aria-checked={language === option.value}
                    onClick={() => {
                      onLanguageChange(option.value);
                      close(true);
                    }}
                  >
                    <span className="more-menu-label">{option.label}</span>
                    <span className="more-menu-check"><MenuIcon name="check" /></span>
                  </button>
                ))}
                {languageNote && <p id={languageNoteId} role="none" className="more-menu-note">{languageNote}</p>}
              </div>
            )}
          </div>}
          {actions.map((action) => {
            const descriptionId = action.description ? `${id}-${action.id}-description` : undefined;
            return (
              <Fragment key={action.id}>
                <button
                  className="more-menu-item"
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={action.disabled || undefined}
                  aria-describedby={descriptionId}
                  title={action.description}
                  onClick={() => {
                    if (action.disabled) return;
                    close(true);
                    action.onSelect();
                  }}
                >
                  {action.icon}
                  <span className="more-menu-label">{action.label}</span>
                </button>
                {descriptionId && <span id={descriptionId} className="visually-hidden">{action.description}</span>}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';

/**
 * Phone shell pieces (Dan, 8 October): voice first, so the screen stays clear. A bottom sheet replaces the rail for
 * moving between pages (Jarvis can also switch pages by voice), and one caption line says what Jarvis is doing.
 */
const pages = [
  { to: '/', label: 'Jarvis', end: true },
  { to: '/factory/kanban', label: 'Software Factory' },
  { to: '/knowledge', label: 'Knowledge' },
  { to: '/usage', label: 'Usage' },
  { to: '/settings', label: 'Settings' },
] as const;

export function MobileMenu({ open, onClose, onFolio, onContext }: {
  open: boolean;
  onClose: () => void;
  onFolio: () => void;
  onContext: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    sheet.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, open]);
  return (
    <div className="mobile-menu" hidden={!open}>
      <button className="mobile-menu-backdrop" type="button" aria-label="Close menu" tabIndex={-1} onClick={onClose} />
      <div ref={sheet} id="mobile-menu" className="mobile-menu-sheet" role="dialog" aria-modal="true" aria-label="Go to" tabIndex={-1}>
        <span className="mobile-menu-grip" aria-hidden="true" />
        <nav aria-label="Pages">
          {pages.map((page) => (
            <NavLink key={page.to} className="mobile-menu-link" to={page.to} end={'end' in page} onClick={onClose}>{page.label}</NavLink>
          ))}
        </nav>
        <div className="mobile-menu-actions">
          <button className="mobile-menu-link" type="button" onClick={() => { onClose(); onFolio(); }}>Folio</button>
          <button className="mobile-menu-link" type="button" onClick={() => { onClose(); onContext(); }}>Context panel</button>
        </div>
      </div>
    </div>
  );
}

/** One line above the dock with what Jarvis is doing; screen readers already get the top bar's status. */
export function MobileCaption({ text }: { text: string | null }) {
  return (
    <p className="mobile-caption" aria-hidden="true" data-visible={Boolean(text) || undefined}>
      <span key={text ?? ''}>{text}</span>
    </p>
  );
}

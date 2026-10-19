import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useModalLifecycle } from './useModalLifecycle';
import { ShellIcon } from './ShellIcon';

/**
 * Phone shell pieces (Dan, 8 October): voice first, so the screen stays clear. A bottom sheet replaces the rail for
 * moving between pages (Jarvis can also switch pages by voice), and one caption line says what Jarvis is doing.
 */
const pages = [
  { to: '/', label: 'Jarvis', end: true },
  { to: '/factory/kanban', label: 'Software Factory' },
  { to: '/notes', label: 'Notes' },
  { to: '/usage', label: 'Usage' },
  { to: '/status', label: 'Status' },
  { to: '/settings', label: 'Settings' },
] as const;

type MenuPage = { readonly to: string; readonly label: string; readonly end?: true };

/** Same order as the rail (`appAreas`): Proactive follows the first area, which is Daily when that is on. */
function menuPages(dailyEnabled: boolean, proactiveEnabled: boolean): readonly MenuPage[] {
  const list: readonly MenuPage[] = dailyEnabled ? [pages[0], { to: '/daily', label: 'Daily' }, ...pages.slice(1)] : pages;
  return proactiveEnabled ? [...list.slice(0, 2), { to: '/proactive', label: 'Proactive' }, ...list.slice(2)] : list;
}

export function MobileMenu({ open, onClose, onNavigate, onFolio, onContext, dailyEnabled = false, proactiveEnabled = false }: {
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
  onFolio: () => void;
  onContext: () => void;
  dailyEnabled?: boolean;
  proactiveEnabled?: boolean;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useModalLifecycle({ active: open, dialog: sheet, boundary: root, onDismiss: onClose });

  return (
    <div ref={root} className="mobile-menu" hidden={!open} inert={!open}>
      <div className="mobile-menu-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={sheet} id="mobile-menu" className="mobile-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-menu-heading" tabIndex={-1} onKeyDown={onKeyDown}>
        <span className="mobile-menu-grip" aria-hidden="true" />
        <header className="modal-heading">
          <h2 id="mobile-menu-heading">Go to</h2>
          <button className="modal-close" type="button" aria-label="Close menu" onClick={onClose}><ShellIcon name="close" /></button>
        </header>
        <nav className="mobile-menu-body" aria-label="Pages">
          {menuPages(dailyEnabled, proactiveEnabled).map((page) => (
            <NavLink key={page.to} className="mobile-menu-link" to={page.to} end={page.end === true} onClick={() => { onNavigate(); onClose(); }}>{page.label}</NavLink>
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

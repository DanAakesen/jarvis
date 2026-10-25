import { useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { AreaSectionLink } from './area-sections';
import { useModalLifecycle } from './useModalLifecycle';
import { ShellIcon, type ShellIconName } from './ShellIcon';

/**
 * Phone shell pieces (Dan, 8 October): voice first, so the screen stays clear. A bottom sheet replaces the rail for
 * moving between pages (Jarvis can also switch pages by voice), and one caption line says what Jarvis is doing.
 */
const pages = [
  { to: '/', label: 'Jarvis', icon: 'chat', end: true },
  { to: '/factory/kanban', label: 'Workspaces', icon: 'workspaces' },
  { to: '/notes', label: 'Notes', icon: 'knowledge' },
  { to: '/usage', label: 'Usage', icon: 'usage' },
  { to: '/status', label: 'Status', icon: 'status' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
] as const;

type MenuPage = { readonly to: string; readonly label: string; readonly icon: ShellIconName; readonly end?: true };

/** Same order as the rail (`appAreas`): Proactive follows the first area, which is Daily when that is on. */
function menuPages(dailyEnabled: boolean, proactiveEnabled: boolean): readonly MenuPage[] {
  const list: readonly MenuPage[] = dailyEnabled ? [pages[0], { to: '/health', label: 'Health', icon: 'health' }, ...pages.slice(1)] : pages;
  return proactiveEnabled ? [...list.slice(0, 2), { to: '/proactive', label: 'Proactive', icon: 'sparkle' }, ...list.slice(2)] : list;
}

export function MobileMenu({ open, onClose, onNavigate, onFolio, onContext, dailyEnabled = false, proactiveEnabled = false, sections }: {
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
  onFolio: () => void;
  onContext: () => void;
  dailyEnabled?: boolean;
  proactiveEnabled?: boolean;
  /** The pages inside the area that is open, listed under that area's own link (the rail's sidebar does not exist on a phone). */
  sections?: { label: string; links: readonly AreaSectionLink[] };
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const pageRail = useRef<HTMLElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const { onKeyDown } = useModalLifecycle({ active: open, dialog: sheet, boundary: root, onDismiss: onClose });
  const entries = menuPages(dailyEnabled, proactiveEnabled).flatMap((page) => {
    const currentSection = sections?.label === page.label ||
      (page.label === 'Workspaces' && sections?.label === 'Software Factory');
    return [
      { key: page.to, label: page.label, to: page.to, end: page.end, icon: page.icon, currentSection },
      ...(sections && currentSection ? sections.links.map((link) => ({
        key: link.id, label: link.label, to: link.to, icon: 'navigation' as const, current: link.current,
      })) : []),
    ];
  });
  const pageSize = 4;
  const entryPages = Array.from({ length: Math.ceil(entries.length / pageSize) }, (_, index) =>
    entries.slice(index * pageSize, (index + 1) * pageSize));

  const selectPage = (index: number) => {
    const rail = pageRail.current;
    const page = rail?.children.item(index) as HTMLElement | null;
    if (!rail || !page) return;
    rail.scrollLeft = page.offsetLeft;
    setPageIndex(index);
  };

  return (
    <div ref={root} className="mobile-menu" hidden={!open} inert={!open}>
      <div className="mobile-menu-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={sheet} id="mobile-menu" className="mobile-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-menu-heading" tabIndex={-1} onKeyDown={onKeyDown}>
        <span className="mobile-menu-grip" aria-hidden="true" />
        <header className="modal-heading">
          <h2 id="mobile-menu-heading">Go to</h2>
          <button className="modal-close" type="button" aria-label="Close menu" onClick={onClose}><ShellIcon name="close" /></button>
        </header>
        <nav ref={pageRail} className="mobile-menu-body" aria-label="Pages"
          onScroll={(event) => {
            const width = event.currentTarget.clientWidth;
            if (width > 0) setPageIndex(Math.round(event.currentTarget.scrollLeft / width));
          }}>
          {entryPages.map((pageEntries, index) => (
            <div key={index} className="mobile-menu-page" aria-label={`Menu page ${index + 1}`}>
              {pageEntries.map((entry) => (
                'current' in entry ? (
                  <Link key={entry.key} className="mobile-menu-link mobile-menu-sublink" to={entry.to}
                    aria-current={entry.current ? 'page' : undefined} onClick={() => { onNavigate(); onClose(); }}>
                    <ShellIcon name={entry.icon} /><span>{entry.label}</span><ShellIcon name="chevron" />
                  </Link>
                ) : (
                  <NavLink key={entry.key} className="mobile-menu-link" to={entry.to} end={entry.end === true}
                    {...(entry.currentSection ? { 'aria-current': 'location' as const } : {})}
                    onClick={() => { onNavigate(); onClose(); }}>
                    <ShellIcon name={entry.icon} /><span>{entry.label}</span><ShellIcon name="chevron" />
                  </NavLink>
                )
              ))}
            </div>
          ))}
        </nav>
        {entryPages.length > 1 && <div className="mobile-menu-pagination">
          <button className="mobile-menu-page-button" type="button" disabled={pageIndex === 0}
            aria-label="Previous menu page" onClick={() => selectPage(Math.max(0, pageIndex - 1))}>Previous</button>
          <span aria-live="polite">Page {pageIndex + 1} of {entryPages.length}</span>
          <button className="mobile-menu-page-button" type="button" disabled={pageIndex === entryPages.length - 1}
            aria-label="Next menu page" onClick={() => selectPage(Math.min(entryPages.length - 1, pageIndex + 1))}>Next</button>
        </div>}
        <div className="mobile-menu-actions">
          <button className="mobile-menu-link" type="button" onClick={() => { onClose(); onFolio(); }}>Folio</button>
          <button className="mobile-menu-link" type="button" onClick={() => { onClose(); onContext(); }}>Context panel</button>
        </div>
      </div>
    </div>
  );
}

export function MobileBottomNav({ menuOpen, dailyEnabled = false, onOpenMenu, onNavigate }: {
  menuOpen: boolean;
  dailyEnabled?: boolean;
  onOpenMenu: () => void;
  onNavigate: () => void;
}) {
  const { pathname } = useLocation();
  const isChat = pathname === '/';
  const isHealth = pathname === '/health' || pathname.startsWith('/health/');
  const isWorkspace = pathname === '/factory' || pathname.startsWith('/factory/');
  const isMenuPage = !isChat && !isHealth && !isWorkspace;

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      <Link className="mobile-bottom-nav-link" to="/" aria-current={isChat ? 'page' : undefined} onClick={onNavigate}>
        <ShellIcon name="chat" /><span>Chat</span>
      </Link>
      {dailyEnabled && <Link className="mobile-bottom-nav-link" to="/health" aria-current={isHealth ? 'page' : undefined} onClick={onNavigate}>
        <ShellIcon name="health" /><span>Health</span>
      </Link>}
      <Link className="mobile-bottom-nav-link" to="/factory/kanban" aria-current={isWorkspace ? 'page' : undefined} onClick={onNavigate}>
        <ShellIcon name="workspaces" /><span>Workspaces</span>
      </Link>
      <button className="mobile-bottom-nav-link" type="button" aria-expanded={menuOpen} aria-controls="mobile-menu"
        aria-current={isMenuPage ? 'page' : undefined} onClick={onOpenMenu}>
        <ShellIcon name="menu" /><span>Menu</span>
      </button>
    </nav>
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

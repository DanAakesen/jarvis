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
  { to: '/factory/kanban', label: 'Software Factory', icon: 'status' },
  { to: '/notes', label: 'Notes', icon: 'tasks' },
  { to: '/usage', label: 'Usage', icon: 'usage' },
  { to: '/status', label: 'Status', icon: 'status' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
] as const;

type MenuPage = { readonly to: string; readonly label: string; readonly icon: ShellIconName; readonly end?: true };
type MenuEntry =
  | { kind: 'page'; key: string; label: string; to: string; icon: ShellIconName; end?: true; currentSection?: boolean }
  | { kind: 'section'; key: string; label: string; to: string; icon: ShellIconName; current?: boolean }
  | { kind: 'context'; key: 'context'; label: 'Context panel'; icon: 'context' };

/** Chat, Health and Workspaces have persistent bottom controls; the sheet lists the remaining destinations. */
function menuPages(dailyEnabled: boolean, proactiveEnabled: boolean, healthSections: boolean): readonly MenuPage[] {
  const proactive = proactiveEnabled ? [{ to: '/proactive', label: 'Proactive', icon: 'sparkle' as const }] : [];
  const health = dailyEnabled && healthSections ? [{ to: '/health', label: 'Health', icon: 'health' as const }] : [];
  return [...proactive, ...health, ...pages];
}

export function MobileMenu({ open, onClose, onNavigate, onContext, dailyEnabled = false, proactiveEnabled = false, sections }: {
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
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
  const entries: MenuEntry[] = menuPages(dailyEnabled, proactiveEnabled, sections?.label === 'Health').flatMap((page) => {
    const currentSection = sections?.label === page.label;
    return [
      { kind: 'page' as const, key: page.to, label: page.label, to: page.to, ...(page.end ? { end: page.end } : {}), icon: page.icon, currentSection },
      ...(sections && currentSection ? sections.links.map((link) => ({
        kind: 'section' as const, key: link.id, label: link.label, to: link.to, icon: 'navigation' as const, current: link.current,
      })) : []),
    ];
  });
  entries.push({ kind: 'context', key: 'context', label: 'Context panel', icon: 'context' });
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
          <header className="modal-heading">
            <button className="modal-close" type="button" aria-label="Close menu" onClick={onClose}><ShellIcon name="close" /></button>
            <h2 id="mobile-menu-heading" className="visually-hidden">Go to</h2>
            {entryPages.length > 1 && <div className="mobile-menu-pagination">
              <button className="mobile-menu-page-button" type="button" disabled={pageIndex === 0}
                aria-label="Previous menu page" onClick={() => selectPage(Math.max(0, pageIndex - 1))}><ShellIcon name="chevron" /></button>
              <span aria-live="polite" aria-label={`Page ${pageIndex + 1} of ${entryPages.length}`}>{pageIndex + 1} / {entryPages.length}</span>
              <button className="mobile-menu-page-button" type="button" disabled={pageIndex === entryPages.length - 1}
                aria-label="Next menu page" onClick={() => selectPage(Math.min(entryPages.length - 1, pageIndex + 1))}><ShellIcon name="chevron" /></button>
            </div>}
          </header>
        <nav ref={pageRail} className="mobile-menu-body" aria-label="Pages"
          onScroll={(event) => {
            const width = event.currentTarget.clientWidth;
            if (width > 0) setPageIndex(Math.round(event.currentTarget.scrollLeft / width));
          }}>
          {entryPages.map((pageEntries, index) => (
            <div key={index} className="mobile-menu-page" aria-label={`Menu page ${index + 1}`}>
              {pageEntries.map((entry) => {
                const contents = <><ShellIcon name={entry.icon} /><span>{entry.label}</span><ShellIcon name="chevron" /></>;
                if (entry.kind === 'context') return (
                  <button key={entry.key} className="mobile-menu-link" type="button" onClick={() => { onClose(); onContext(); }}>{contents}</button>
                );
                if (entry.kind === 'section') return (
                  <Link key={entry.key} className="mobile-menu-link mobile-menu-sublink" to={entry.to}
                    aria-current={entry.current ? 'page' : undefined} onClick={() => { onNavigate(); onClose(); }}>{contents}</Link>
                );
                return (
                  <NavLink key={entry.key} className="mobile-menu-link" to={entry.to} end={entry.end === true}
                    {...(entry.currentSection ? { 'aria-current': 'location' as const } : {})}
                    onClick={() => { onNavigate(); onClose(); }}>{contents}</NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function MobileBottomNav({ menuOpen, dailyEnabled = false, workspacesOpen = false, onToggleWorkspaces, onOpenMenu, onNavigate }: {
  menuOpen: boolean;
  dailyEnabled?: boolean;
  workspacesOpen?: boolean;
  onToggleWorkspaces: () => void;
  onOpenMenu: () => void;
  onNavigate: () => void;
}) {
  const { pathname } = useLocation();
  const isChat = pathname === '/';
  const isHealth = pathname === '/health' || pathname.startsWith('/health/');
  const isMenuPage = !isChat && !isHealth && !workspacesOpen;

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      <Link className="mobile-bottom-nav-link" to="/" aria-current={isChat ? 'page' : undefined} onClick={onNavigate}>
        <ShellIcon name="chat" /><span>Chat</span>
      </Link>
      {dailyEnabled && <Link className="mobile-bottom-nav-link" to="/health" aria-current={isHealth ? 'page' : undefined} onClick={onNavigate}>
        <ShellIcon name="health" /><span>Health</span>
      </Link>}
      <button className="mobile-bottom-nav-link" type="button" aria-pressed={workspacesOpen}
        onClick={onToggleWorkspaces}>
        <ShellIcon name="workspaces" /><span>Workspaces</span>
      </button>
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

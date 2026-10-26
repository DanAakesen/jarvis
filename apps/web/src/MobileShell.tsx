import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { AreaSectionLink } from './area-sections';
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
  const pageRail = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [pageIndex, setPageIndex] = useState(0);
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
  const pageSize = 6;
  const entryPages = Array.from({ length: Math.ceil(entries.length / pageSize) }, (_, index) =>
    entries.slice(index * pageSize, (index + 1) * pageSize));

  const selectPage = (index: number) => {
    const rail = pageRail.current;
    const page = rail?.children.item(index) as HTMLElement | null;
    if (!rail || !page) return;
    rail.scrollLeft = page.offsetLeft;
    setPageIndex(index);
  };

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocus.current = previous;
    sheet.current?.querySelector<HTMLElement>('.mobile-menu-link')?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      previous?.focus({ preventScroll: true });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || sheet.current?.contains(target) ||
        target.closest('.mobile-bottom-nav-link[aria-controls="mobile-menu"], .mobile-menu-backdrop')) return;
      onCloseRef.current();
      if (!target.closest('.mobile-bottom-nav-link, button, a[href], input, textarea, select, [contenteditable="true"]')) {
        previous?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="mobile-menu" hidden={!open} inert={!open}>
      <div className="mobile-menu-backdrop" aria-hidden="true" onClick={() => {
        onClose();
        returnFocus.current?.focus({ preventScroll: true });
      }} />
      <div ref={sheet} id="mobile-menu" className="mobile-menu-sheet" role="dialog" aria-labelledby="mobile-menu-heading" tabIndex={-1}>
        <h2 id="mobile-menu-heading" className="visually-hidden">Go to</h2>
        <nav ref={pageRail} className="mobile-menu-body" aria-label="Pages" tabIndex={0}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            selectPage(Math.max(0, Math.min(entryPages.length - 1, pageIndex + (event.key === 'ArrowRight' ? 1 : -1))));
          }}
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
        <div className="mobile-menu-dots" aria-hidden="true"><span /><span /><span /></div>
        <span className="visually-hidden" role="status">Page {pageIndex + 1} of {entryPages.length}. Swipe or use arrow keys to browse.</span>
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

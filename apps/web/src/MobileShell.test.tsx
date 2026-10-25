import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MobileBottomNav, MobileMenu } from './MobileShell';

function Harness({ onNavigate = () => {}, onContext = () => {}, path = '/', ...flags }: {
  onNavigate?: () => void;
  onContext?: () => void;
  path?: string;
  dailyEnabled?: boolean;
  proactiveEnabled?: boolean;
  sections?: NonNullable<ComponentProps<typeof MobileMenu>['sections']>;
}) {
  const [open, setOpen] = useState(false);
  return <MemoryRouter initialEntries={[path]}>
    <button onClick={() => setOpen(true)}>Open menu</button>
    <MobileMenu open={open} onClose={() => setOpen(false)} onNavigate={onNavigate} onContext={onContext} {...flags} />
  </MemoryRouter>;
}

describe('mobile menu modal behavior', () => {
  it('traps focus, preserves its working backdrop, and restores its trigger on Escape and backdrop', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Go to' }).parentElement!;
    expect(sheet.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close menu' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Context panel' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sheet.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).not.toBe('hidden');
    await user.click(trigger);
    const backdrop = screen.getByRole('dialog').parentElement!.querySelector<HTMLElement>('.mobile-menu-backdrop')!;
    expect(backdrop.closest('[inert]')).toBeNull();
    await user.click(backdrop);
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('preserves page navigation and closes the sheet', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<Harness onNavigate={navigate} />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(screen.getByRole('link', { name: 'Notes' }));
    expect(navigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('consumes Escape before an existing global voice shortcut can end the session', async () => {
    const user = userEvent.setup();
    const voiceShortcut = vi.fn((event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) throw new Error('Voice must not receive a modal Escape');
    });
    document.addEventListener('keydown', voiceShortcut);
    try {
      render(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(voiceShortcut).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', voiceShortcut);
    }
  });
});

describe('mobile menu pages', () => {
  async function openPages(props: Parameters<typeof Harness>[0] = {}) {
    const user = userEvent.setup();
    render(<Harness {...props} />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    return within(screen.getByRole('navigation', { name: 'Pages' }));
  }

  // Chat, Health and Workspaces stay in the bottom bar; this sheet lists secondary destinations.
  it.each([
    { dailyEnabled: false, proactiveEnabled: false, pages: ['Software Factory', 'Notes', 'Usage', 'Status', 'Settings'] },
    { dailyEnabled: true, proactiveEnabled: false, pages: ['Software Factory', 'Notes', 'Usage', 'Status', 'Settings'] },
    { dailyEnabled: false, proactiveEnabled: true, pages: ['Proactive', 'Software Factory', 'Notes', 'Usage', 'Status', 'Settings'] },
    { dailyEnabled: true, proactiveEnabled: true, pages: ['Proactive', 'Software Factory', 'Notes', 'Usage', 'Status', 'Settings'] },
  ])('lists secondary destinations (daily $dailyEnabled, proactive $proactiveEnabled)', async ({ pages, ...flags }) => {
    const navigation = await openPages(flags);
    expect(navigation.getAllByRole('link').map((link) => link.textContent)).toEqual(pages);
    expect(within(navigation.getByLabelText('Menu page 1')).getAllByRole('link').map((link) => link.textContent))
      .toEqual(pages.slice(0, 4));
    expect(navigation.getByRole('button', { name: 'Context panel' })).not.toBeNull();
  });

  it('links Proactive to its area and keeps it current on an item page', async () => {
    const navigation = await openPages({ proactiveEnabled: true, path: '/proactive/11111111-1111-4111-8111-111111111111' });
    const proactive = navigation.getByRole('link', { name: 'Proactive' });
    expect(proactive.getAttribute('href')).toBe('/proactive');
    expect(proactive.getAttribute('aria-current')).toBe('page');
    expect(navigation.getByRole('link', { name: 'Software Factory' }).hasAttribute('aria-current')).toBe(false);
  });

  it('lists the published pages under their area only, marks the current one, and closes the sheet on a pick', async () => {
    const sections = {
      label: 'Health',
      links: [
        { id: 'overview', label: 'Overview', to: '/health?section=overview', current: false },
        { id: 'nutrition', label: 'Nutrition', to: '/health?section=nutrition', current: true },
      ],
    };
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<Harness dailyEnabled path="/health?section=nutrition" onNavigate={navigate} sections={sections} />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const navigation = within(screen.getByRole('navigation', { name: 'Pages' }));
    expect(navigation.getAllByRole('link').map((link) => link.textContent))
      .toEqual(['Health', 'Overview', 'Nutrition', 'Software Factory', 'Notes', 'Usage', 'Status', 'Settings']);
    expect(navigation.getByRole('link', { name: 'Health' }).getAttribute('aria-current')).toBe('location');
    expect(navigation.getByRole('link', { name: 'Nutrition' }).getAttribute('aria-current')).toBe('page');
    expect(navigation.getByRole('link', { name: 'Overview' }).hasAttribute('aria-current')).toBe(false);
    expect(navigation.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/health?section=overview');
    await user.click(navigation.getByRole('link', { name: 'Overview' }));
    expect(navigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows no sub-pages when the open area publishes none', async () => {
    const navigation = await openPages({ dailyEnabled: true });
    expect(navigation.getAllByRole('link').map((link) => link.textContent))
      .toEqual(['Software Factory', 'Notes', 'Usage', 'Status', 'Settings']);
  });

  it('pages horizontally through the menu links and exposes keyboard paging controls', async () => {
    const user = userEvent.setup();
    await openPages();
    const rail = screen.getByRole('navigation', { name: 'Pages' });
    Object.defineProperty(rail, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(rail, 'scrollLeft', { configurable: true, writable: true, value: 300 });
    fireEvent.scroll(rail);
    expect(screen.getByLabelText('Page 2 of 2')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Previous menu page' }).hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Previous menu page' }));
    expect(screen.getByLabelText('Page 1 of 2')).not.toBeNull();
  });

  it('opens Context panel from the paged menu and closes the sheet', async () => {
    const user = userEvent.setup();
    const onContext = vi.fn();
    render(<Harness onContext={onContext} />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(screen.getByRole('button', { name: 'Next menu page' }));
    expect(screen.getByLabelText('Page 2 of 2')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Context panel' }));
    expect(onContext).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('mobile bottom navigation', () => {
  function BottomNavHarness({ path = '/', dailyEnabled = true }: { path?: string; dailyEnabled?: boolean }) {
    const [open, setOpen] = useState(false);
    const [workspacesOpen, setWorkspacesOpen] = useState(false);
    return <MemoryRouter initialEntries={[path]}>
      <MobileBottomNav menuOpen={open} dailyEnabled={dailyEnabled} workspacesOpen={workspacesOpen}
        onToggleWorkspaces={() => setWorkspacesOpen((value) => !value)}
        onOpenMenu={() => setOpen((value) => !value)} onNavigate={() => {}} />
      <MobileMenu open={open} onClose={() => setOpen(false)} onNavigate={() => {}} onContext={() => {}} dailyEnabled={dailyEnabled} />
      <div role="region" aria-label="Workspaces pane" hidden={!workspacesOpen} />
    </MemoryRouter>;
  }

  it('opens the Workspaces pane and preserves Software Factory as a separate menu destination', async () => {
    const user = userEvent.setup();
    render(<BottomNavHarness path="/factory/kanban" />);
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    const workspaces = within(navigation).getByRole('button', { name: 'Workspaces' });
    expect(workspaces.getAttribute('aria-pressed')).toBe('false');
    expect(within(navigation).getByRole('button', { name: 'Menu' }).getAttribute('aria-current')).toBe('page');
    expect(within(navigation).getByRole('link', { name: 'Chat' }).hasAttribute('aria-current')).toBe(false);
    await user.click(workspaces);
    expect(workspaces.getAttribute('aria-pressed')).toBe('true');
    expect(within(navigation).getByRole('button', { name: 'Menu' }).hasAttribute('aria-current')).toBe(false);
    expect(screen.getByRole('region', { name: 'Workspaces pane' })).not.toHaveProperty('hidden', true);
    await user.click(within(navigation).getByRole('button', { name: 'Menu' }));
    expect(within(navigation).getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Go to' })).not.toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Pages' })).getByRole('link', { name: 'Software Factory' }).getAttribute('href')).toBe('/factory/kanban');
    expect(within(screen.getByRole('navigation', { name: 'Pages' })).getByRole('button', { name: 'Context panel' })).not.toBeNull();
  });

  it('omits Health when its destination is not enabled and highlights Menu on secondary pages', () => {
    render(<BottomNavHarness path="/notes" dailyEnabled={false} />);
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(navigation).queryByRole('link', { name: 'Health' })).toBeNull();
    expect(within(navigation).getByRole('button', { name: 'Menu' }).getAttribute('aria-current')).toBe('page');
  });
});

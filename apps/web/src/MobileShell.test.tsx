import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MobileMenu } from './MobileShell';

function Harness({ onNavigate = () => {}, path = '/', ...flags }: {
  onNavigate?: () => void;
  path?: string;
  dailyEnabled?: boolean;
  proactiveEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <MemoryRouter initialEntries={[path]}>
    <button onClick={() => setOpen(true)}>Open menu</button>
    <MobileMenu open={open} onClose={() => setOpen(false)} onNavigate={onNavigate} onFolio={() => {}} onContext={() => {}} {...flags} />
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

  // The rail lists Conversation, then the areas with Proactive after the first one (`appAreas`); the menu adds Settings.
  it.each([
    { dailyEnabled: false, proactiveEnabled: false, pages: ['Jarvis', 'Software Factory', 'Tasks', 'Notes', 'Usage', 'Status', 'Settings'] },
    { dailyEnabled: true, proactiveEnabled: false, pages: ['Jarvis', 'Daily', 'Software Factory', 'Tasks', 'Notes', 'Usage', 'Status', 'Settings'] },
    { dailyEnabled: false, proactiveEnabled: true, pages: ['Jarvis', 'Software Factory', 'Proactive', 'Tasks', 'Notes', 'Usage', 'Status', 'Settings'] },
    { dailyEnabled: true, proactiveEnabled: true, pages: ['Jarvis', 'Daily', 'Proactive', 'Software Factory', 'Tasks', 'Notes', 'Usage', 'Status', 'Settings'] },
  ])('lists the pages in rail order (daily $dailyEnabled, proactive $proactiveEnabled)', async ({ pages, ...flags }) => {
    const navigation = await openPages(flags);
    expect(navigation.getAllByRole('link').map((link) => link.textContent)).toEqual(pages);
  });

  it('links Proactive to its area and keeps it current on an item page', async () => {
    const navigation = await openPages({ proactiveEnabled: true, path: '/proactive/11111111-1111-4111-8111-111111111111' });
    const proactive = navigation.getByRole('link', { name: 'Proactive' });
    expect(proactive.getAttribute('href')).toBe('/proactive');
    expect(proactive.getAttribute('aria-current')).toBe('page');
    expect(navigation.getByRole('link', { name: 'Jarvis' }).hasAttribute('aria-current')).toBe(false);
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MobileMenu } from './MobileShell';

function Harness({ onNavigate = () => {} }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  return <MemoryRouter>
    <button onClick={() => setOpen(true)}>Open menu</button>
    <MobileMenu open={open} onClose={() => setOpen(false)} onNavigate={onNavigate} onFolio={() => {}} onContext={() => {}} />
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

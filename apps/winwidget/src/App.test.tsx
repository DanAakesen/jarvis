import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

beforeEach(() => { window.jarvisWidget = { setExpanded: vi.fn().mockResolvedValue(undefined), dock: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }; });

describe('companion scaffold', () => {
  it('states that no backend is connected without fabricated features', () => {
    render(<App />);
    expect(screen.getByText(/no live backend connection/i)).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
  });
  it('disables native actions in browser preview and explains why', () => {
    delete window.jarvisWidget;
    render(<App />);
    expect(screen.getByText(/Window controls require the Electron app/)).toBeTruthy();
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it('toggles the sidebar repeatedly through the narrow bridge', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(window.jarvisWidget!.setExpanded).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('sidebar')!.hasAttribute('inert')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(window.jarvisWidget!.setExpanded).toHaveBeenLastCalledWith(true);
    expect(document.getElementById('sidebar')!.hasAttribute('inert')).toBe(false);
  });
  it('provides keyboard-accessible docking and close actions', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    await user.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Snap to left edge');
    await user.keyboard('{Enter}');
    expect(window.jarvisWidget!.dock).toHaveBeenCalledWith('left');
    await user.click(screen.getByRole('button', { name: 'Snap to right edge' }));
    expect(window.jarvisWidget!.dock).toHaveBeenCalledWith('right');
    expect(screen.getByRole('status').textContent).toBe('Snapped to right edge.');
    await user.click(screen.getByRole('button', { name: 'Close widget' }));
    expect(window.jarvisWidget!.close).toHaveBeenCalledOnce();
  });
  it('keeps failed expansion recoverable and does not claim success', async () => {
    const api = window.jarvisWidget!;
    vi.mocked(api.setExpanded).mockRejectedValueOnce(new Error('synthetic'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('alert').textContent).toContain('Try again');
    expect(screen.getByRole('button', { name: 'Collapse sidebar' }).getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });
  it('prevents overlapping native requests until the first completes', async () => {
    let finish!: () => void;
    vi.mocked(window.jarvisWidget!.dock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Snap to left edge' }));
    await user.click(screen.getByRole('button', { name: 'Snap to right edge' }));
    expect(window.jarvisWidget!.dock).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Snap to right edge' }) as HTMLButtonElement).disabled).toBe(false));
  });
});

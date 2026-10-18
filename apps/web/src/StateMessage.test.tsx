import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StateMessage } from './StateMessage';

const styles = readFileSync('src/styles.css', 'utf8');

describe('StateMessage', () => {
  it('announces loading politely through the shared Loader', () => {
    const { container } = render(<StateMessage variant="loading" message="Loading settings" />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector('.state-message-loader.loader-inline')).not.toBeNull();
    expect(container.querySelector('.state-message-loading .state-message-copy')?.textContent).toBe('Loading settings');
  });

  it('announces empty results politely without adding a heading', () => {
    const { container } = render(<StateMessage variant="empty" message="No usage was recorded in this period." />);
    expect(screen.getByRole('status').textContent).toContain('No usage was recorded in this period.');
    expect(container.querySelector('h1, h2, h3')).toBeNull();
  });

  it('announces errors as alerts and invokes the named recovery action', () => {
    const retry = vi.fn();
    render(<StateMessage variant="error" message="Usage could not be loaded." actionLabel="Retry usage" onAction={retry} />);
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry usage' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('announces partial results politely and can keep a recovery action', () => {
    const refresh = vi.fn();
    render(<StateMessage variant="partial" message="Showing the latest 20 records."
      detail="Refresh to check for newer records." actionLabel="Refresh records" onAction={refresh} />);
    expect(screen.getByRole('status').textContent).toContain('Refresh to check for newer records.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps the retry name while busy and disables repeat activation', () => {
    const retry = vi.fn();
    render(<StateMessage variant="error" message="The list could not be loaded." actionLabel="Retry list"
      actionAriaLabel="Retry the list"
      onAction={retry} actionBusy />);
    const button = screen.getByRole('button', { name: 'Retry the list' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.querySelector('.button-loading-indicator .skeleton-inline')).not.toBeNull();
    fireEvent.click(button);
    expect(retry).not.toHaveBeenCalled();
  });

  it('reserves space and relies on the reduced-motion-aware Loader without adding state motion', () => {
    expect(styles).toContain('.state-message {');
    expect(styles).toContain('min-block-size: 7.5rem;');
    expect(styles).toContain(':root[data-motion="reduced"] .loader-dots > span { animation: none; }');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce) { .loader .loader-dots > span { animation: none; } }');
    expect(styles).not.toMatch(/state-message[^{}]*animation|animation[^{}]*state-message/u);
  });
});

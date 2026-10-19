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
    expect(styles).toContain('min-block-size: 10rem;');
    expect(styles).toContain(':root[data-motion="reduced"] .loader-dots > span { animation: none; }');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce) { .loader .loader-dots > span { animation: none; } }');
    expect(styles).not.toMatch(/state-message[^{}]*animation|animation[^{}]*state-message/u);
  });

  it.each(['lines', 'rows', 'cards', 'panel', 'image'] as const)(
    'wraps the %s placeholder in a hidden skeleton wrapper that can stretch to the message width',
    (loaderVariant) => {
      render(<StateMessage variant="loading" message="Loading items" loaderVariant={loaderVariant} />);
      const message = screen.getByRole('status');
      const wrapper = message.querySelector('.state-message-skeleton');
      expect(wrapper?.parentElement).toBe(message);
      expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
      expect(wrapper?.firstElementChild?.className).toContain(`skeleton-${loaderVariant}`);
      expect(wrapper?.querySelector('.state-message-loader')).toBe(wrapper?.firstElementChild);
      expect(message.getAttribute('aria-live')).toBe('polite');
      expect(message.querySelector('.state-message-copy')?.textContent).toBe('Loading items');
    });

  it('keeps the text loader on one row without a skeleton wrapper', () => {
    const { container } = render(<StateMessage variant="loading" message="Loading settings" />);
    expect(container.querySelector('.state-message-skeleton')).toBeNull();
    expect(container.querySelector('.state-message-loading > .state-message-copy')).not.toBeNull();
  });

  it('stretches the skeleton wrapper to the width of the message', () => {
    expect(styles).toMatch(/\.state-message-skeleton\s*\{[^}]*justify-self:\s*stretch;/u);
    expect(styles).toMatch(/\.state-message-skeleton\s*\{[^}]*min-width:\s*0;/u);
  });

  it('keeps the cards placeholder from hiding every column on narrow screens', () => {
    const { container } = render(<StateMessage variant="loading" message="Loading board" loaderVariant="cards" />);
    expect(container.querySelectorAll('.skeleton-column')).toHaveLength(4);
    // The visually hidden label is the first child, so an nth-child count would hide the first column too.
    const hiding = [...styles.matchAll(/(\.skeleton-column[^{}]*)\{\s*display:\s*none;\s*\}/gu)].map((match) => match[1]!.trim());
    expect(hiding).toHaveLength(2);
    const visible = hiding.map((selector) => 4 - container.querySelectorAll(selector).length);
    // Two columns up to 900px and one up to 700px, matching the grid tracks declared beside them.
    expect(visible).toEqual([2, 1]);
  });
});

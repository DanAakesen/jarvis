import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Loader } from './Loader';

const styles = readFileSync('src/styles.css', 'utf8');

describe('text loading', () => {
  it('renders Loading with decorative dots and a separate stable accessible status', () => {
    const { container } = render(<Loader variant="text" label="Loading settings" />);
    expect(screen.getByRole('status').textContent).toBe('Loading settings');
    const visible = container.querySelector('[aria-hidden="true"]')!;
    expect(visible.textContent).toBe('Loading...');
    expect(visible.querySelector('.loader-dots')?.children).toHaveLength(3);
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('supports immediate inline progress without nesting a live status', () => {
    const { container } = render(<Loader variant="text" size="inline" text="Redirecting" label="Redirecting" announce={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('.loader-inline [aria-hidden="true"]')?.textContent).toBe('Redirecting...');
  });

  it('reserves all three dots and animates appearance then deletion without changing text', () => {
    expect(styles).toContain('.loader-dots { display: inline-block; white-space: nowrap; }');
    expect(styles).toContain('@keyframes loader-dot-two { 0%, 80%, 100% { opacity: 0; } 20% { opacity: 1; } }');
    expect(styles).toContain('@keyframes loader-dot-three { 0%, 60%, 100% { opacity: 0; } 40% { opacity: 1; } }');
    expect(styles).not.toMatch(/loader-core|loader-ring|loader-breathe|loader-ignite|signin-loader/);
  });

  it('leaves three static visible dots for both reduced-motion preferences', () => {
    expect(styles).toContain(':root[data-motion="reduced"] .loader-dots > span { animation: none; }');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce) { .loader .loader-dots > span { animation: none; } }');
  });
});

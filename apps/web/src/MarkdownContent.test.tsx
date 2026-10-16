import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from './MarkdownContent';

const table = [
  '| Hotel | Check-in | Check-out | Price |',
  '|---|---|---|---|',
  '| Fixture Hotel North | 14 May, 15:00 | 15 May, 11:00 | 1,200 DKK |',
  '| Fixture Hotel South | 28 Jun, 16:00 | 29 Jun, 12:00 | 1,800 DKK |',
].join('\n');

describe('MarkdownContent', () => {
  it('renders well-formed historical tables with semantic headers in a keyboard-accessible scroll region', () => {
    render(<MarkdownContent source={`Two synthetic bookings before 1 July 2031:\n\n${table}\n\nAll times are local.`} gfm />);
    const region = screen.getByRole('region', { name: 'Scrollable table' });
    expect(region.tabIndex).toBe(0);
    const rendered = within(region).getByRole('table');
    expect(within(rendered).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Hotel', 'Check-in', 'Check-out', 'Price']);
    expect(within(rendered).getAllByRole('row')).toHaveLength(3);
    expect(within(rendered).getByRole('cell', { name: '14 May, 15:00' })).toBeTruthy();
    expect(within(rendered).getByRole('cell', { name: '1,800 DKK' })).toBeTruthy();
    expect(screen.getByText('All times are local.')).toBeTruthy();
  });

  it('preserves flattened malformed fixture text rather than guessing record boundaries', () => {
    const flattened = table.replaceAll('\n', ' ');
    const source = `I found two synthetic booking confirmations before 1 July 2031:\n${flattened}\nAll times are local. I haven\u2019t found the third booking yet\u2014do you recall its hotel or booking provider?`;
    const { container } = render(<MarkdownContent source={source} gfm />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.textContent).toContain(flattened);
    expect(container.textContent).toContain('All times are local.');
  });

  it('keeps incomplete streamed tables readable and parses them when row boundaries arrive', () => {
    const view = render(<MarkdownContent source="**Bookings**\n\n| Hotel | Check-in |" streaming gfm />);
    expect(screen.getByText('Bookings').tagName).toBe('STRONG');
    view.rerender(<MarkdownContent source={`**Bookings**\n\n${table}`} streaming gfm />);
    expect(screen.getByRole('table')).toBeTruthy();
    view.rerender(<MarkdownContent source={`**Bookings**\n\n${table}`} gfm />);
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('retains safe links and raw-HTML prohibition inside table cells', () => {
    const source = '| Item | Detail |\n|---|---|\n| [Safe](https://example.com) | [Bad](javascript:alert(1)) <img src=x onerror=alert(1)> |\n| Code | `a | b` |';
    const { container } = render(<MarkdownContent source={source} gfm />);
    const link = screen.getByRole('link', { name: 'Safe' });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(container.querySelector('img, script, input')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Bad' })).toBeNull();
  });

  it('preserves CommonMark for existing non-chat readers', () => {
    const { container } = render(<MarkdownContent source={table} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.textContent).toContain('| Hotel | Check-in |');
  });
});

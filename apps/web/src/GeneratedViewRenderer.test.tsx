import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GeneratedView } from '@jarvis/contracts';
import { GeneratedViewRenderer } from './GeneratedViewRenderer';

describe('GeneratedViewRenderer timeline', () => {
  it('keeps Jarvis\'s order and shows a readable date marker', () => {
    const view = {
      version: 1, title: 'Man City case', renderer: 'timeline',
      source: { id: 'research', status: 'complete', updatedAt: '2026-10-08T16:00:00.000Z' },
      data: { events: [
        { at: '2026-09-29T09:00:00.000Z', title: 'Commission verdict', description: 'All charges proven except 4(B).' },
        { at: '2023-02-06T09:00:00.000Z', title: 'Charges announced' },
      ] },
    } as unknown as GeneratedView;
    render(<GeneratedViewRenderer view={view} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('strong')?.textContent)).toEqual(['Commission verdict', 'Charges announced']);
    expect(items[0]!.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-29T09:00:00.000Z');
    expect(items[0]!.querySelector('time')?.textContent).toMatch(/2026/);
    expect(screen.getByText('All charges proven except 4(B).')).not.toBeNull();
  });

  it('draws a chart with a legend and keeps the values available', () => {
    const view = {
      version: 1, title: 'Revenue', renderer: 'chart',
      source: { id: 'usage', status: 'complete', updatedAt: '2026-10-08T16:00:00.000Z' },
      data: { kind: 'bar', series: [
        { name: 'Reported', points: [{ x: '2016', y: 300 }, { x: '2017', y: 450 }] },
        { name: 'Genuine', points: [{ x: '2016', y: 40 }, { x: '2017', y: 60 }] },
      ] },
    } as unknown as GeneratedView;
    const { container } = render(<GeneratedViewRenderer view={view} />);
    expect(screen.getByRole('img', { name: /Revenue: bar chart of Reported, Genuine/ })).not.toBeNull();
    expect(container.querySelectorAll('.chart-bars rect')).toHaveLength(4);
    expect(container.querySelector('.chart-legend')?.textContent).toBe('ReportedGenuine');
    expect(screen.getByRole('table', { name: 'Revenue values', hidden: true }).querySelectorAll('tbody tr')).toHaveLength(4);
  });
});
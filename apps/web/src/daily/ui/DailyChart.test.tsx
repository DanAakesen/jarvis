import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DailyChart } from './DailyChart';

const series = [{ name: 'Synthetic mass', points: [{ x: '2026-10-16', y: 1 }, { x: '2026-10-17', y: 2 }] }];

describe('DailyChart', () => {
  it.each(['line', 'bar', 'area'] as const)('draws an accessible %s chart and provides a disclosed data table', kind => {
    const { container } = render(<DailyChart kind={kind} name="Synthetic daily values" series={series} />);
    expect(screen.getByRole('img', { name: 'Synthetic daily values' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Synthetic daily values data' })).toBeNull();
    fireEvent.click(screen.getByText('View data table'));
    expect(screen.getByRole('table', { name: 'Synthetic daily values data' })).toBeTruthy();
    expect(container.querySelector('svg line')).toBeTruthy();
    expect(container.querySelector('svg path, svg rect')).toBeTruthy();
  });

  it('moves the keyboard readout across recorded values and preserves explicit gaps', () => {
    const data = [{ name: 'Synthetic pulse', points: [
      { x: 0, y: 72 }, { x: 1, y: null }, { x: 2, y: 84, low: 78, high: 90 },
    ] }];
    const { container } = render(<DailyChart kind="line" name="Synthetic pulse over time" series={data} />);
    const chart = screen.getByRole('img', { name: 'Synthetic pulse over time' });
    fireEvent.focus(chart);
    expect(screen.getByRole('status').textContent).toContain('0: 72');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toContain('1: Not recorded');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toContain('2: 84');
    expect(container.querySelectorAll('.daily-chart-series .daily-chart-line')).toHaveLength(1);
    expect(container.querySelector('.daily-chart-range path')).toBeTruthy();
  });

  it('renders an optional labelled target line and a single wide bar', () => {
    const { container } = render(<DailyChart kind="bar" name="Synthetic weekly minutes"
      target={{ value: 20, label: 'Target 20' }} series={[{ name: 'Recorded', points: [{ x: 'week', y: 10 }] }]} />);
    expect(container.querySelector('.daily-chart-target line')).toBeTruthy();
    expect(container.querySelector('.daily-chart-bars path')?.getAttribute('d')).toContain('Q452');
  });
});

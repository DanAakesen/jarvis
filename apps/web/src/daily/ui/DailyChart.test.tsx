import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DailyChart } from './DailyChart';

const series = [{ name: 'Synthetic mass', points: [{ x: '2026-10-16', y: 1 }, { x: '2026-10-17', y: 2 }] }];

describe('DailyChart', () => {
  it.each(['line', 'bar', 'area'] as const)('draws an accessible %s chart and provides a data table', kind => {
    const { container } = render(<DailyChart kind={kind} name="Synthetic daily values" series={series} />);
    expect(screen.getByRole('img', { name: 'Synthetic daily values' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Synthetic daily values data' })).toBeTruthy();
    expect(container.querySelector('svg line')).toBeTruthy();
    expect(container.querySelector('svg path, svg rect')).toBeTruthy();
  });
});

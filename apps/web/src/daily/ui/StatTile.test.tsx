import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('renders a known zero with its unit and optional context', () => {
    render(<StatTile label="Synthetic energy" value={0} unit="kcal" note="Recorded" comparison="No change" />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('kcal')).toBeTruthy();
    expect(screen.getByText('Recorded')).toBeTruthy();
    expect(screen.getByText('No change')).toBeTruthy();
  });

  it.each([null, undefined, Number.NaN, ''])('renders unavailable values as Unknown instead of a blank or zero', value => {
    render(<StatTile label="Synthetic value" value={value} unit="kg" />);
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.queryByText('kg')).toBeNull();
  });

  it('supports compact long values, a sparkline, and comparable or missing deltas', () => {
    const { rerender, container } = render(<StatTile compact label="Synthetic total" value={'a long recorded value that wraps'} delta={{
      current: 10, previous: 8, unit: 'min',
    }} sparkline={{ values: [1, null, 3], label: 'Synthetic time trend' }} />);
    expect(container.querySelector('.daily-stat-tile--compact')).toBeTruthy();
    expect(screen.getByText('+2 min')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Synthetic time trend' })).toBeTruthy();
    expect(screen.getByText('a long recorded value that wraps')).toBeTruthy();
    rerender(<StatTile label="Synthetic total" value={10} delta={{ current: 10, previous: null, unit: 'min' }} />);
    expect(screen.getByText('No comparison')).toBeTruthy();
  });
});

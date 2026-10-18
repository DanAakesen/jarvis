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

  it.each([null, undefined])('renders unavailable values as Unknown instead of a blank or zero', value => {
    render(<StatTile label="Synthetic value" value={value} unit="kg" />);
    expect(screen.getByText('Unknown')).toBeTruthy();
  });
});

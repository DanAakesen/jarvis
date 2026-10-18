import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataNotes } from './DataNotes';
import { DailyGrid, DailyGridItem } from './DailyGrid';
import { DailySectionHeader } from './DailySectionHeader';
import { FreshnessLine } from './FreshnessLine';
import { Meter } from './Meter';
import { Sparkline } from './Sparkline';
import { WorkoutGlyph } from './WorkoutGlyph';

describe('Daily presentation kit', () => {
  it('labels freshness, unknown count, and partial status in text', () => {
    render(<FreshnessLine observedAt="invalid-date" partial />);
    expect(screen.getByRole('status').textContent).toContain('at an unknown time');
    expect(screen.getByRole('status').textContent).toContain('an unknown number of records');
    expect(screen.getByRole('status').textContent).toContain('partial');
  });

  it.each([[1, '1 meal'], [2, '2 meals'], [null, 'an unknown number of meals']] as const)(
    'supports a domain count label for %s records', (count, expected) => {
      render(<FreshnessLine count={count} recordLabel="meals" />);
      expect(screen.getByRole('status').textContent).toContain(expected);
    },
  );

  it('retains the default singular record label', () => {
    render(<FreshnessLine count={1} />);
    expect(screen.getByRole('status').textContent).toContain('1 record');
  });

  it('keeps detailed source notes collapsed behind a native disclosure', () => {
    render(<DataNotes><p>A long synthetic explanation</p></DataNotes>);
    expect(screen.getByText('About this data').closest('details')?.open).toBe(false);
    fireEvent.click(screen.getByText('About this data'));
    expect(screen.getByText('A long synthetic explanation')).toBeTruthy();
  });

  it('shows no sparkline for empty observations and gaps for missing samples', () => {
    const { container, rerender } = render(<Sparkline values={[null, Number.NaN]} label="Synthetic trend" />);
    expect(screen.getByText('No trend available')).toBeTruthy();
    rerender(<Sparkline values={[2, null, 5]} label="Synthetic trend" />);
    expect(screen.getByRole('img', { name: 'Synthetic trend' })).toBeTruthy();
    expect(container.querySelector('path')?.getAttribute('d')).toContain('M4.0');
    expect(container.querySelector('path')?.getAttribute('d')).toContain('M116.0');
  });

  it('explains unknown values and unset targets, and marks partial progress', () => {
    const { rerender } = render(<Meter label="Synthetic progress" value={null} target={null} unit="min" />);
    expect(screen.getByText('Value unknown')).toBeTruthy();
    expect(screen.getByText('Target not set')).toBeTruthy();
    rerender(<Meter label="Synthetic progress" value={45} target={60} unit="min" partial />);
    expect(screen.getByRole('progressbar', { name: 'Synthetic progress' }).getAttribute('aria-valuenow')).toBe('45');
    expect(screen.getByText('Partial value')).toBeTruthy();
    expect(screen.getByText('45 min')).toBeTruthy();
  });

  it('supports domain unknown labels and keeps lower bounds beside the recorded number', () => {
    const { rerender } = render(<Meter label="Synthetic energy" value={null} target={2000} unit="kcal" unknownLabel="Not recorded" />);
    expect(screen.getByText('Not recorded')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    rerender(<Meter label="Synthetic energy" value={800} target={2000} unit="kcal" partial partialLabel="(lower bound)" />);
    const value = screen.getByText('800 kcal');
    expect(value.parentElement?.textContent).toBe('800 kcal (lower bound)');
    expect(screen.getByText('(lower bound)').parentElement).toBe(value.parentElement);
    expect(screen.queryByText('Partial value')).toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('800 kcal (lower bound) of 2,000 kcal');
  });

  it.each([[2500, 2000, '2000'], [10, 0, '0'], [0, 0, '0']] as const)(
    'bounds progress semantics for value %s and target %s without changing the recorded value', (value, target, bounded) => {
      render(<Meter label="Synthetic bounded energy" value={value} target={target} unit="kcal" />);
      const progress = screen.getByRole('progressbar');
      expect(progress.getAttribute('aria-valuenow')).toBe(bounded);
      expect(progress.getAttribute('aria-valuemax')).toBe(String(target));
      expect(progress.getAttribute('aria-valuetext')).toContain(`${value.toLocaleString()} kcal`);
      expect(screen.getAllByText(`${value.toLocaleString()} kcal`).length).toBeGreaterThan(0);
    },
  );

  it('preserves negative target text without exposing an invalid progress range', () => {
    render(<Meter label="Synthetic negative baseline" value={100} target={-1} unit="kcal" />);
    expect(screen.getByText('100 kcal')).toBeTruthy();
    expect(screen.getByText('-1 kcal')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('preserves a negative recorded value without exposing it as progress', () => {
    render(<Meter label="Synthetic negative observation" value={-10} target={2000} unit="kcal" />);
    expect(screen.getByText('-10 kcal')).toBeTruthy();
    expect(screen.getByText('2,000 kcal')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the shared header and responsive grid semantics', () => {
    const { container } = render(<>
      <DailySectionHeader title="Workouts" actions={<button type="button">Action</button>} />
      <DailyGrid columns="twelve"><DailyGridItem span={8}>Overview</DailyGridItem><DailyGridItem span={4}>Types</DailyGridItem></DailyGrid>
    </>);
    expect(screen.getByRole('heading', { level: 2, name: 'Workouts' })).toBeTruthy();
    expect(container.querySelector('.daily-grid--twelve .daily-grid-item--8')).toBeTruthy();
    expect(container.querySelector('.daily-grid--twelve .daily-grid-item--4')).toBeTruthy();
  });

  it('maps workout classes to six decorative glyphs', () => {
    const kinds = ['running', 'walking', 'cycling', 'swimming', 'strength', 'other'];
    const { container } = render(<>{kinds.map(kind => <WorkoutGlyph key={kind} type={kind} />)}</>);
    expect(container.querySelectorAll('.daily-workout-glyph')).toHaveLength(6);
    for (const kind of kinds) expect(container.querySelector(`[data-kind="${kind}"]`)).toBeTruthy();
  });
});

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyChart } from './DailyChart';

const series = [{ name: 'Synthetic mass', points: [{ x: '2026-10-16', y: 1 }, { x: '2026-10-17', y: 2 }] }];

describe('DailyChart', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['line', 'bar', 'area'] as const)('draws an accessible %s chart and provides a disclosed data table', kind => {
    const { container } = render(<DailyChart kind={kind} name="Synthetic daily values" series={series} />);
    expect(screen.getByRole('img', { name: 'Synthetic daily values' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Synthetic daily values data' })).toBeNull();
    fireEvent.click(screen.getByText('View data table'));
    const table = screen.getByRole('table', { name: 'Synthetic daily values data' });
    expect(within(table).getByRole('columnheader', { name: 'Series' })).toBeTruthy();
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
    expect(within(table).getAllByRole('rowheader', { name: 'Synthetic mass' })).toHaveLength(2);
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

  it.each([
    ['categorical', ['day1', 'day2', 'day3']],
    ['numeric', [0, 10, 20]],
  ] as const)('retains unknown endpoint dates in the %s x domain and keeps keyboard markers inside the plot', (_kind, xs) => {
    const { container } = render(<DailyChart kind="line" name="Synthetic unknown endpoints" series={[{
      name: 'Recorded observations', points: xs.map((x, index) => ({ x, y: index === 1 ? 50 : null })),
    }]} />);
    const chart = screen.getByRole('img', { name: 'Synthetic unknown endpoints' });
    const labels = [...container.querySelectorAll('.daily-chart-xaxis text')].map(text => text.textContent);
    expect(labels).toContain(String(xs[0]));
    expect(labels).toContain(String(xs[2]));
    if (typeof xs[0] === 'string') expect(labels).toEqual(xs);
    fireEvent.focus(chart);
    expect(screen.getByRole('status').textContent).toContain(`${xs[0]}: Not recorded`);
    expect(Number(container.querySelector('.daily-chart-active-point circle')?.getAttribute('cx'))).toBe(48);
    fireEvent.keyDown(chart, { key: 'End' });
    expect(screen.getByRole('status').textContent).toContain(`${xs[2]}: Not recorded`);
    expect(Number(container.querySelector('.daily-chart-active-point circle')?.getAttribute('cx'))).toBe(784);
    expect(container.querySelectorAll('.daily-chart-series circle')).toHaveLength(1);
    expect(container.querySelector('.daily-chart-series circle')?.getAttribute('cx')).toBe('416');
    expect([...container.querySelectorAll('.daily-chart-grid text')].map(text => text.textContent)).toEqual(['50', '50.5', '51']);
  });

  it('scales range-only observations using recorded bounds without inventing a central value', () => {
    const { container } = render(<DailyChart kind="line" name="Synthetic recorded range" series={[{
      name: 'Range', points: [{ x: 'day1', y: null, low: 40, high: 60 }],
    }]} />);
    expect(container.querySelector('.daily-chart-range path')?.getAttribute('d')).not.toMatch(/NaN|Infinity/u);
    expect(container.querySelectorAll('.daily-chart-series circle')).toHaveLength(0);
    expect(container.querySelector('.daily-chart-line')?.getAttribute('d')).toBe('');
  });

  it('can disclose a domain table with qualified values without a duplicate raw table', () => {
    render(<DailyChart kind="line" name="Synthetic qualified chart" series={series}
      dataTable={<table><caption>Qualified synthetic values</caption><tbody><tr><td>1 (lower bound)</td></tr></tbody></table>} />);
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByText('View data table'));
    expect(screen.getByRole('table', { name: 'Qualified synthetic values' })).toBeTruthy();
    expect(screen.getByText('1 (lower bound)')).toBeTruthy();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    fireEvent.click(screen.getByText('View data table'));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('retains a domain table when every chart observation is unknown', () => {
    render(<DailyChart kind="line" name="Synthetic unknown values"
      series={[{ name: 'Synthetic protein', points: [{ x: '2026-10-16', y: null }] }]}
      dataTable={<table><caption>Unknown synthetic values</caption><tbody><tr><td>Not recorded</td></tr></tbody></table>} />);
    expect(screen.getByText('No recorded values to chart.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByText('View data table'));
    expect(screen.getByRole('table', { name: 'Unknown synthetic values' })).toBeTruthy();
    expect(screen.getByText('Not recorded')).toBeTruthy();
  });

  it.each([false, true])('cancels native summary toggling so the controlled disclosure toggles exactly once (empty: %s)', empty => {
    render(<DailyChart kind="line" name="Synthetic controlled disclosure"
      series={empty ? [{ name: 'Unknown', points: [{ x: 'day1', y: null }] }] : series}
      dataTable={<table><caption>Synthetic disclosed values</caption><tbody><tr><td>Recorded data</td></tr></tbody></table>} />);
    const summary = screen.getByText('View data table');
    const pointerClick = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    fireEvent(summary, pointerClick);
    expect(pointerClick.defaultPrevented).toBe(true);
    expect(summary.closest('details')?.open).toBe(true);
    expect(screen.getByRole('table', { name: 'Synthetic disclosed values' })).toBeTruthy();
    const keyboardClick = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
    fireEvent(summary, keyboardClick);
    expect(keyboardClick.defaultPrevented).toBe(true);
    expect(summary.closest('details')?.open).toBe(false);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders an optional labelled target line and a single wide bar', () => {
    const { container } = render(<DailyChart kind="bar" name="Synthetic weekly minutes"
      target={{ value: 20, label: 'Target 20' }} series={[{ name: 'Recorded', points: [{ x: 'week', y: 10 }] }]} />);
    expect(container.querySelector('.daily-chart-target line')).toBeTruthy();
    expect(container.querySelector('.daily-chart-bars path')?.getAttribute('d')).toContain('Q452');
  });

  it('matches the solid, dashed and dotted series in the legend', () => {
    const { container } = render(<DailyChart kind="line" name="Synthetic heart rate" series={
      ['Average', 'Minimum', 'Maximum'].map(name => ({ points: series[0]!.points, name }))
    } />);
    const lines = container.querySelectorAll('.daily-chart-line');
    const swatches = container.querySelectorAll('.daily-chart-legend-swatch line');
    expect(swatches).toHaveLength(3);
    for (let index = 0; index < lines.length; index++) {
      expect(swatches[index]?.getAttribute('stroke-dasharray')).toBe(lines[index]?.getAttribute('stroke-dasharray'));
    }
    expect(swatches[1]?.getAttribute('stroke-dasharray')).toBe('6 3');
    expect(swatches[2]?.getAttribute('stroke-dasharray')).toBe('2 4');
  });

  it('omits empty target and gap placeholders from the legend without shifting series styles', () => {
    const { container } = render(<DailyChart kind="line" name="Synthetic observations only" series={[
      { name: 'Synthetic unset target', points: [] },
      ...series,
      { name: 'Synthetic gap placeholder', points: [] },
    ]} />);
    const legend = screen.getByRole('list', { name: 'Synthetic observations only legend' });
    expect(legend.querySelectorAll('li')).toHaveLength(1);
    expect(legend.textContent).toBe('Synthetic mass');
    expect(container.querySelector('.daily-chart-legend-swatch line')?.getAttribute('stroke-dasharray'))
      .toBe(container.querySelector('.daily-chart-series[data-series-index="1"] .daily-chart-line')?.getAttribute('stroke-dasharray'));
  });

  it('measures phone width, responds to resizing and disconnects its observer', () => {
    let resize: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 320 } as DOMRect);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const { container, unmount } = render(<DailyChart kind="line" name="Synthetic responsive chart" series={series} />);
    const figure = container.querySelector('figure')!;
    const svg = screen.getByRole('img', { name: 'Synthetic responsive chart' });
    expect(observe).toHaveBeenCalledWith(figure);
    expect(svg.getAttribute('viewBox')).toBe('0 0 320 220');
    const originalPath = container.querySelector('.daily-chart-line')?.getAttribute('d');
    const notify = (width: number) => act(() => resize?.(
      [{ target: figure, contentRect: { width } } as unknown as ResizeObserverEntry], {} as ResizeObserver,
    ));
    notify(236);
    expect(svg.getAttribute('viewBox')).toBe('0 0 236 220');
    expect(container.querySelector('.daily-chart-line')?.getAttribute('d')).not.toBe(originalPath);
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) notify(invalid);
    expect(svg.getAttribute('viewBox')).toBe('0 0 236 220');
    notify(640);
    expect(svg.getAttribute('viewBox')).toBe('0 0 640 320');
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('reserves room for long numeric ticks and avoids overlapping narrow date labels', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 236 } as DOMRect);
    const { container } = render(<DailyChart kind="line" name="Synthetic wide ticks" series={[{
      name: 'Synthetic value', points: [{ x: '2026-10-17', y: 1200.5 }, { x: '2026-10-18', y: 2400.5 }],
    }]} />);
    for (const tick of container.querySelectorAll('.daily-chart-grid text')) {
      expect(Number(tick.getAttribute('x'))).toBeGreaterThan(tick.textContent!.length * 8);
    }
    expect(container.querySelectorAll('.daily-chart-xaxis text')).toHaveLength(1);
  });

  it('measures without ResizeObserver and renders safely on the server', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 280 } as DOMRect);
    const markup = renderToString(<DailyChart kind="line" name="Synthetic server chart" series={series} />);
    expect(markup).toContain('viewBox="0 0 800 320"');
    render(<DailyChart kind="line" name="Synthetic fallback chart" series={series} />);
    expect(screen.getByRole('img', { name: 'Synthetic fallback chart' }).getAttribute('viewBox')).toBe('0 0 280 220');
  });
});

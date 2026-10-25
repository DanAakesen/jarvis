import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isGeneratedView, type GeneratedView } from '@jarvis/contracts';
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

  it('preserves the raw leap-second value accepted by the timeline contract', () => {
    const view = {
      version: 1, title: 'Leap second', renderer: 'timeline',
      source: { id: 'research', status: 'complete', updatedAt: '2016-12-31T23:59:00Z' },
      data: { events: [{ at: '2016-12-31T23:59:60Z', title: 'Leap second' }] },
    };
    expect(isGeneratedView(view)).toBe(true);
    render(<GeneratedViewRenderer view={view as GeneratedView} />);
    expect(screen.getByText('2016-12-31T23:59:60Z')).not.toBeNull();
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
    const plot = screen.getByRole('region', { name: 'Chart plot: Revenue' });
    expect(plot.hasAttribute('tabindex')).toBe(false);
    expect(plot.hasAttribute('aria-describedby')).toBe(false);
    expect(Number(container.querySelector('svg')?.getAttribute('width'))).toBeLessThanOrEqual(640);
    expect(screen.getByRole('table', { name: 'Revenue values', hidden: true }).querySelectorAll('tbody tr')).toHaveLength(4);
  });

  it('wraps long chart labels and retains their full text and values', () => {
    const labels = ['2026 autumn harvest with an extended category label', '2026 winter planning with another extended category label'];
    const view = {
      version: 1, title: 'Seasonal output', renderer: 'chart',
      source: { id: 'usage', status: 'complete', updatedAt: '2026-10-08T16:00:00.000Z' },
      data: { kind: 'bar', series: [{ name: 'Reported', points: labels.map((x, index) => ({ x, y: index + 1 })) }] },
    } as unknown as GeneratedView;
    const { container } = render(<GeneratedViewRenderer view={view} />);
    const plot = screen.getByRole('region', { name: 'Chart plot: Seasonal output' });

    expect(plot.hasAttribute('tabindex')).toBe(false);
    expect(plot.hasAttribute('aria-describedby')).toBe(false);
    const renderedLabels = Array.from(container.querySelectorAll('.chart-x-label'));
    expect(renderedLabels.map((label) => label.getAttribute('aria-label'))).toEqual(labels);
    expect(renderedLabels.map((label) => Array.from(label.querySelectorAll('tspan'), (line) => line.textContent).join(''))).toEqual(labels);
    expect(renderedLabels.some((label) => label.querySelectorAll('tspan').length > 1)).toBe(true);
    expect(Number(container.querySelector('svg')?.getAttribute('width'))).toBeLessThanOrEqual(640);
    expect(screen.getByRole('table', { name: 'Seasonal output values', hidden: true }).querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('keeps dense chart labels in a local scroll region when points need more room', () => {
    const labels = Array.from({ length: 30 }, (_, index) => `Category ${index + 1} with an extended label`);
    const view = {
      version: 1, title: 'Dense categories', renderer: 'chart',
      source: { id: 'usage', status: 'complete', updatedAt: '2026-10-08T16:00:00.000Z' },
      data: { kind: 'bar', series: [{ name: 'Reported', points: labels.map((x, index) => ({ x, y: index + 1 })) }] },
    } as unknown as GeneratedView;
    const { container } = render(<GeneratedViewRenderer view={view} />);
    const plot = screen.getByRole('region', { name: 'Scrollable chart plot: Dense categories' });

    expect(plot.getAttribute('tabindex')).toBe('0');
    expect(screen.getByText('Scroll horizontally to read all chart labels.')).not.toBeNull();
    expect(Number(container.querySelector('svg')?.getAttribute('width'))).toBeGreaterThan(640);
    expect(screen.getByRole('table', { name: 'Dense categories values', hidden: true }).querySelectorAll('tbody tr')).toHaveLength(30);
  });

  it('keeps long prose, list, detail, task-card and status content intact', () => {
    const longText = `https://example.com/${'unbroken-path-segment/'.repeat(4)}`;
    const source = { id: 'research', status: 'complete' };
    const views = [
      { renderer: 'list', data: { items: [{ title: longText, description: longText, details: [{ label: 'Path', value: longText }] }] } },
      { renderer: 'detail', data: { fields: [{ label: 'Path', value: longText }] } },
      { renderer: 'text', data: { format: 'plain', content: `README ${longText}\n${longText}` } },
      { renderer: 'task-card', data: { id: 'task-1', title: longText, state: 'Running', summary: longText } },
      { renderer: 'status', data: { label: 'Status', value: longText, state: 'warning' } },
    ];

    for (const content of views) {
      const view = { version: 1, title: 'Synthetic narrow view', source, ...content } as unknown as GeneratedView;
      const { container, unmount } = render(<GeneratedViewRenderer view={view} />);
      expect(container.textContent).toContain(longText);
      unmount();
    }
  });

  it('fits images to the renderer and keeps their alternative text', () => {
    const view = {
      version: 1, title: 'Synthetic image', renderer: 'image',
      source: { id: 'image_generation', status: 'complete' },
      data: { images: [{ url: 'https://github.com/example/image.png', alt: 'An oversized synthetic landscape' }] },
    } as unknown as GeneratedView;
    render(<GeneratedViewRenderer view={view} />);
    expect(screen.getByRole('img', { name: 'An oversized synthetic landscape' }).getAttribute('src'))
      .toBe('https://github.com/example/image.png');
  });
});

describe('GeneratedViewRenderer table', () => {
  it('right-aligns numeric columns and leaves text and mixed columns unchanged', () => {
    const view = {
      version: 1, title: 'Sample usage table', renderer: 'table',
      source: { id: 'usage', status: 'complete', updatedAt: '2026-10-08T16:00:00.000Z' },
      data: {
        columns: ['Runs', 'Task', 'Cost (DKK)'],
        rows: [[24.5, 'Sample build', 8.1], [8.1, 'Release check', 'n/a'], [null, null, 0.4]],
      },
    } as unknown as GeneratedView;
    const { container } = render(<GeneratedViewRenderer view={view} />);
    const headers = Array.from(container.querySelectorAll('th'));
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(headers.map((cell) => cell.classList.contains('generated-view-number'))).toEqual([true, false, false]);
    expect(rows.map((row) => Array.from(row.querySelectorAll('td'), (cell) => cell.classList.contains('generated-view-number'))))
      .toEqual([[true, false, false], [true, false, false], [true, false, false]]);
  });

  it('keeps wide tables inside a named, focusable scroll region without dropping cells', () => {
    const columns = Array.from({ length: 12 }, (_, index) => `Column ${index + 1}`);
    const longCell = 'unbroken-cell-value-'.repeat(12);
    const view = {
      version: 1, title: 'Wide synthetic table', renderer: 'table',
      source: { id: 'research', status: 'partial' },
      data: { columns, rows: [columns.map(() => longCell)] },
    } as unknown as GeneratedView;
    const { container } = render(<GeneratedViewRenderer view={view} />);
    const region = screen.getByRole('region', { name: 'Scrollable table: Wide synthetic table' });

    expect(region.getAttribute('tabindex')).toBe('0');
    expect(container.querySelectorAll('th')).toHaveLength(12);
    expect(container.querySelectorAll('td')).toHaveLength(12);
    expect(container.querySelector('tbody')?.textContent).toContain(longCell);
  });
});

describe('GeneratedViewRenderer source note', () => {
  const reason = 'Retained Health records, 1–16 Oct 2026 (Copenhagen dates). Read 17 Oct 2026, 09:00 Copenhagen time. '
    + 'Completeness and freshness are not established. Unknown means no value was recorded, not zero.';
  const source = { id: 'now', status: 'partial', updatedAt: '2026-10-17T07:00:00.000Z', reason };
  const content = {
    table: { renderer: 'table', data: { columns: ['Day', 'Value'], rows: [['2026-10-16', 7.25], ['2026-10-15', null]] } },
    chart: { renderer: 'chart', data: { kind: 'bar', series: [{ name: 'Synthetic', points: [{ x: '2026-10-15', y: 61.5 }, { x: '2026-10-16', y: 62 }] }] } },
    detail: { renderer: 'detail', data: { fields: [{ label: 'Latest', value: 'Synthetic' }] } },
  };
  const make = (renderer: keyof typeof content, overrides: object = {}) => (
    { version: 1, title: 'Synthetic view', source, ...content[renderer], ...overrides } as unknown as GeneratedView
  );

  it('makes wide table scrolling keyboard reachable and names the region', () => {
    render(<GeneratedViewRenderer view={make('table')} />);
    expect(screen.getByRole('region', { name: 'Scrollable table: Synthetic view' }).getAttribute('tabindex')).toBe('0');
  });

  it.each(['table', 'chart', 'detail'] as const)('puts the note directly beneath a %s view', (renderer) => {
    const { container } = render(<GeneratedViewRenderer view={make(renderer)} />);
    const note = container.querySelector('.generated-view-source-note');
    expect(note?.tagName).toBe('P');
    expect(note?.textContent).toBe(reason);
    expect(container.children).toHaveLength(2);
    expect(container.lastElementChild).toBe(note);
  });

  it.each(['table', 'chart', 'detail'] as const)('adds nothing to a %s view without a reason or with a blank one', (renderer) => {
    for (const noted of [{ id: 'now', status: 'complete' }, { ...source, reason: '   ' }]) {
      const { container, unmount } = render(<GeneratedViewRenderer view={make(renderer, { source: noted })} />);
      expect(container.querySelector('.generated-view-source-note')).toBeNull();
      expect(container.children).toHaveLength(1);
      unmount();
    }
  });

  it('trims the note and keeps its text as plain text', () => {
    const view = make('detail', { source: { ...source, reason: '  Read <b>now</b>.  ' } });
    const { container } = render(<GeneratedViewRenderer view={view} />);
    expect(container.querySelector('.generated-view-source-note')?.textContent).toBe('Read <b>now</b>.');
    expect(container.querySelector('.generated-view-source-note b')).toBeNull();
  });

  it('never repeats the note on list and text views, which already carry their own', () => {
    const own = 'Calendar results were incomplete, so some of these slots may not be free.';
    const noted = { id: 'now', status: 'partial', updatedAt: source.updatedAt, reason: own };
    const list = { version: 1, title: 'Free time', renderer: 'list', source: noted, data: { items: [{ title: own }] } };
    const text = { version: 1, title: 'Free time', renderer: 'text', source: noted, data: { format: 'plain', content: own } };
    for (const view of [list, text]) {
      const { container, unmount } = render(<GeneratedViewRenderer view={view as unknown as GeneratedView} />);
      expect(screen.getAllByText(own)).toHaveLength(1);
      expect(container.querySelector('.generated-view-source-note')).toBeNull();
      unmount();
    }
  });

  it('shows nothing for an invalid view, note or not', () => {
    const { container } = render(<GeneratedViewRenderer view={make('table', { data: { columns: [], rows: [] } })} />);
    expect(screen.getByRole('alert').textContent).toBe('This generated view is invalid.');
    expect(container.querySelector('.generated-view-source-note')).toBeNull();
  });
});
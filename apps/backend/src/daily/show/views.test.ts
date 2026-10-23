import { describe, expect, it } from 'vitest';
import {
  dailyQuerySources as sources,
  dailyViewIds,
  isGeneratedView,
  isWorkspaceCommand,
  type DailyJson,
  type DailyQueryResult,
  type DailySourceId,
} from '@jarvis/contracts';
import { buildDailyView, dailyShowSources, isDailyShowSource, maxShownRows, type DailyViewBuild, type DailyViewOptions } from './views.js';

// Synthetic placeholders only. They are not anyone's real figures.
type Row = Record<string, DailyJson>;
type Cells = { columns: string[]; rows: string[][] };
type Plot = { kind: string; series: { name: string; points: { x: string; y: number }[] }[] };
type Fields = { fields: { label: string; value: string }[] };

const observedAt = '2026-10-17T19:26:00.000Z';
const ranged = { startDate: '2026-10-11', endDate: '2026-10-17', timeZone: 'Europe/Copenhagen' } as const;
const closing = 'Completeness and freshness are not established. Unknown means no value was recorded, not zero.';
const notEstablished = 'Completeness and freshness are not established.';
const readStamp = 'Read 17 Oct 2026, 21:26 Copenhagen time.';
const table: DailyViewOptions = { display: 'table' };
const chart: DailyViewOptions = { display: 'chart' };

function read(
  source: DailySourceId,
  items: Row[],
  over: { period?: DailyQueryResult['period']; hasMore?: boolean; latest?: string; processed?: string; observed?: string } = {},
): DailyQueryResult {
  const hasMore = over.hasMore ?? false;
  return {
    source,
    period: over.period === undefined ? ranged : over.period,
    items,
    status: hasMore ? 'partial' : items.length ? 'available' : 'empty',
    units: {},
    provenance: { store: 'daily-sql', detail: 'retained-record', calculations: 'existing-read-model', consistency: 'independent-committed-reads' },
    freshness: {
      observedAt: over.observed ?? observedAt,
      sourceProcessedCommittedAt: over.processed ?? null,
      latestReturnedRecordUpdatedAt: over.latest ?? null,
      staleness: 'unknown',
    },
    coverage: { returned: items.length, hasMore, next: null, sourceCompleteness: 'unknown' },
    revision: '0'.repeat(64),
  };
}

const body = <T>(build: DailyViewBuild) => build.view.data as unknown as T;
const reason = (build: DailyViewBuild) => build.view.source.reason ?? '';

/** Every view must survive the same validators the workspace applies, as a create and as an update. */
function show(result: DailyQueryResult, options: DailyViewOptions): DailyViewBuild {
  const build = buildDailyView(result, options);
  expect(isGeneratedView(build.view)).toBe(true);
  expect(build.viewId).toMatch(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u);
  expect(Object.values(dailyViewIds)).not.toContain(build.viewId);
  for (const operation of ['create', 'update'] as const) {
    expect(isWorkspaceCommand({ commandId: `show-${operation}`, operation, viewId: build.viewId, view: build.view })).toBe(true);
  }
  expect(build.view.source.id).toBe('now');
  expect(reason(build).length).toBeLessThanOrEqual(480);
  expect(reason(build)).toContain(closing);
  return build;
}

const steps = (date: string, value: DailyJson, over: Row = {}): Row => ({ metric_date: date, metric_name: 'step_count', value, avg_value: null, unit: 'count', ...over });
const beat = (minute: string, avg: DailyJson, over: Row = {}): Row => ({ sample_minute: minute, metric_name: 'heart_rate', min_value: 60, avg_value: avg, max_value: 99, unit: 'bpm', ...over });
const night = (date: string, asleep: DailyJson, total: DailyJson): Row => ({ sleep_date: date, asleep_hours: asleep, total_sleep_hours: total, in_bed_hours: null });

describe('daily show view builder: source guard', () => {
  it('covers exactly the sources that have an on-screen form', () => {
    expect([...dailyShowSources].sort()).toEqual([
      sources.days, sources.favorites, sources.heartRate, sources.meals, sources.metrics,
      sources.metricCatalog, sources.plans, sources.sleep, sources.sync, sources.workouts,
    ].sort());
    for (const source of dailyShowSources) expect(isDailyShowSource(source)).toBe(true);
    for (const other of [sources.briefs, sources.brief, sources.workout, 'daily.unknown', '', null, 7]) expect(isDailyShowSource(other)).toBe(false);
  });

  it('refuses to build a view for brief history, brief detail or single-workout detail', () => {
    for (const source of [sources.briefs, sources.brief, sources.workout]) {
      expect(() => buildDailyView(read(source, [{ id: 'one' }], { period: null }), table)).toThrow(TypeError);
    }
  });

  it('does not change the result it was given and is deterministic', () => {
    const result = read(sources.metrics, [steps('2026-10-16', 1234), steps('2026-10-17', null, { avg_value: 0 })]);
    const before = JSON.stringify(result);
    expect(buildDailyView(result, chart)).toEqual(buildDailyView(result, chart));
    expect(JSON.stringify(result)).toBe(before);
  });
});

describe('daily show view builder: measurements', () => {
  it('shows a labelled table with units, Copenhagen dates and an honest footnote', () => {
    const build = show(read(sources.metrics, [steps('2026-10-16', 1234), steps('2026-10-17', 61.5)]), table);
    expect(build.viewId).toBe('daily-metrics-table');
    expect(build.view.title).toBe('Measurements, 11 Oct 2026 to 17 Oct 2026');
    expect(body<Cells>(build)).toEqual({
      columns: ['Date', 'Measurement', 'Value', 'Average', 'Unit'],
      rows: [['16 Oct 2026', 'Step count', '1234', 'Unknown', 'count'], ['17 Oct 2026', 'Step count', '61.5', 'Unknown', 'count']],
    });
    expect(build.view.source).toEqual({
      id: 'now', status: 'complete', updatedAt: observedAt,
      reason: `Retained Health records, 11 Oct 2026 to 17 Oct 2026 (Copenhagen dates). 2 rows shown. Read 17 Oct 2026, 21:26 Copenhagen time. ${closing}`,
    });
    expect(build.receipt).toEqual({ renderer: 'table', rowsShown: 2, rowsReturned: 2, partial: false, notes: [] });
  });
  it('shows the metric catalogue and derived per-day totals without presenting unknown nutrients as zero', () => {
    const catalogue = show(read(sources.metricCatalog, [{
      metric_name: 'body_mass', units: ['kg', 'lb'], first_date: '2026-10-11', last_date: '2026-10-17',
      day_count: 2, latest_updated_at: observedAt,
    }]), table);
    expect(body<Cells>(catalogue).rows[0]).toEqual(['Body mass', 'kg, lb', '11 Oct 2026', '17 Oct 2026', '2', '17 Oct 2026, 21:26']);

    const result = read(sources.days, [{
      meal_date: '2026-10-17', meal_count: 2, energy_kcal: 240, protein_grams: null,
      carbohydrates_grams: 30, fat_grams: 8, fiber_grams: null,
      unknown_nutrients: ['protein_grams', 'fiber_grams'], partial_nutrients: ['carbohydrates_grams'],
      latest_updated_at: observedAt,
    }]);
    result.provenance.calculations = 'derived-from-retained-meals';
    const days = show(result, table);
    expect(body<Cells>(days).columns).toContain('Unknown nutrients');
    expect(body<Cells>(days).rows[0]).toContain('Unknown');
    expect(body<Cells>(days).rows[0]).toContain('carbohydrates_grams');
    expect(reason(days)).toContain('derived from retained, non-deleted meals');
    expect(reason(days)).toContain('lower bounds');
  });

  it('charts one selected nutrition nutrient, omits unknowns and marks partial totals as lower bounds', () => {
    const result = read(sources.days, [
      { meal_date: '2026-10-15', meal_count: 2, protein_grams: 58.5, partial_nutrients: [], unknown_nutrients: [] },
      { meal_date: '2026-10-16', meal_count: 1, protein_grams: null, partial_nutrients: ['protein_grams'], unknown_nutrients: ['protein_grams'] },
      { meal_date: '2026-10-17', meal_count: 3, protein_grams: 46, partial_nutrients: ['protein_grams'], unknown_nutrients: [] },
    ], { hasMore: true });
    result.provenance.calculations = 'derived-from-retained-meals';

    const build = show(result, { display: 'chart', metric: 'protein_grams' });

    expect(build.view.renderer).toBe('chart');
    expect(build.view.title).toBe('Protein (g), 11 Oct 2026 to 17 Oct 2026');
    expect(build.viewId).toMatch(/^daily-nutrition-days-chart-protein-grams-[0-9a-f]{6}$/u);
    expect(body<Plot>(build).series).toEqual([{
      name: 'Protein (g; includes lower bounds)',
      points: [{ x: '15 Oct', y: 58.5 }, { x: '17 Oct', y: 46 }],
    }]);
    expect(build.receipt).toMatchObject({ renderer: 'chart', rowsShown: 2, rowsReturned: 3, partial: true });
    expect(build.receipt.notes).toContain('1 day without a recorded protein total left out of the chart.');
    expect(build.receipt.notes).toContain('2 days have partial protein totals, which are lower bounds.');
    expect(build.receipt.notes).toContain('More records are available beyond this page.');
    expect(reason(build)).toContain('lower bounds');
  });

  it('does not choose a nutrient or chart units together when the request does not identify one', () => {
    const result = read(sources.days, [
      { meal_date: '2026-10-16', protein_grams: 20, energy_kcal: 300 },
    ]);
    const build = show(result, chart);

    expect(build.view.renderer).toBe('table');
    expect(build.receipt.notes).toContain('A nutrition chart needs one named nutrient, so a table is shown.');
  });

  it('keeps a missing value unknown, a recorded zero as zero, and every duplicate-date row', () => {
    const missing: Row = { metric_date: '2026-10-17', metric_name: 'step_count', unit: 'count' };
    const build = show(read(sources.metrics, [steps('2026-10-17', null, { avg_value: 0 }), missing, steps('2026-10-17', 3)]), table);
    expect(body<Cells>(build).rows).toEqual([
      ['17 Oct 2026', 'Step count', 'Unknown', '0', 'count'],
      ['17 Oct 2026', 'Step count', 'Unknown', 'Unknown', 'count'],
      ['17 Oct 2026', 'Step count', '3', 'Unknown', 'count'],
    ]);
  });

  it('formats numbers without a locale and leaves unparseable dates as stored', () => {
    const build = show(read(sources.metrics, [steps('2026-02-30', 1234.56789), steps('not a date', 1_000_000)]), table);
    expect(body<Cells>(build).rows.map((row) => row.slice(0, 3))).toEqual([
      ['2026-02-30', 'Step count', '1234.568'],
      ['not a date', 'Step count', '1000000'],
    ]);
  });

  it('names a single-day period once', () => {
    const day = { startDate: '2026-10-17', endDate: '2026-10-17', timeZone: 'Europe/Copenhagen' } as const;
    const build = show(read(sources.metrics, [steps('2026-10-17', 5)], { period: day }), table);
    expect(build.view.title).toBe('Measurements, 17 Oct 2026');
    expect(reason(build)).toContain('Retained Health records, 17 Oct 2026 (Copenhagen dates).');
  });

  it('draws one measurement in one unit as a bar chart, with the unit in the title and a stable window', () => {
    const build = show(read(sources.metrics, [steps('2026-10-16', 1234), steps('2026-10-17', 2345)]), chart);
    expect(build.view.renderer).toBe('chart');
    expect(build.viewId).toBe('daily-metrics-chart');
    expect(build.view.title).toBe('Step count (count), 11 Oct 2026 to 17 Oct 2026');
    expect(body<Plot>(build)).toEqual({
      kind: 'bar',
      series: [{ name: 'Step count (count)', points: [{ x: '16 Oct', y: 1234 }, { x: '17 Oct', y: 2345 }] }],
    });
    expect(reason(build)).toContain('2 rows drawn.');
    expect(build.receipt).toEqual({ renderer: 'chart', rowsShown: 2, rowsReturned: 2, partial: false, notes: [] });
  });

  it('keeps duplicate-date bars apart instead of merging them', () => {
    const build = show(read(sources.metrics, [steps('2026-10-17', 1), steps('2026-10-17', 2), steps('2026-10-17', 3)]), chart);
    expect(body<Plot>(build).series[0]?.points.map((point) => point.x)).toEqual(['17 Oct', '17 Oct #2', '17 Oct #3']);
  });

  it('draws the average only when no value was recorded, and says so in the series name', () => {
    const build = show(read(sources.metrics, [steps('2026-10-16', null, { avg_value: 80 }), steps('2026-10-17', null, { avg_value: 82.5 })]), chart);
    expect(body<Plot>(build).series).toEqual([{ name: 'Step count average (count)', points: [{ x: '16 Oct', y: 80 }, { x: '17 Oct', y: 82.5 }] }]);
  });

  it('says when an average exists but only the recorded value is drawn', () => {
    const build = show(read(sources.metrics, [steps('2026-10-16', 10, { avg_value: 9 })]), chart);
    expect(build.receipt.notes).toContain('Only the recorded value is drawn, not the average.');
    expect(build.receipt.partial).toBe(false);
  });

  it('leaves out rows with nothing to draw, never plotting them as zero, and discloses it', () => {
    const build = show(read(sources.metrics, [steps('2026-10-16', 5), steps('2026-10-17', null), steps('2026-10-15', 7, { unit: null })]), chart);
    expect(body<Plot>(build).series[0]?.points).toEqual([{ x: '16 Oct', y: 5 }]);
    expect(build.receipt).toMatchObject({ renderer: 'chart', rowsShown: 1, rowsReturned: 3, partial: true });
    expect(build.receipt.notes).toContain('2 rows without a value or unit left out of the chart.');
    expect(build.view.source.status).toBe('partial');
    expect(reason(build)).toContain('1 row drawn. 2 rows without a value or unit left out of the chart.');
  });

  it('falls back to a table and says why when nothing can be drawn honestly', () => {
    const empty = show(read(sources.metrics, [steps('2026-10-16', null), steps('2026-10-17', null)]), chart);
    expect(empty.view.renderer).toBe('table');
    expect(empty.viewId).toBe('daily-metrics-table');
    expect(empty.receipt.notes).toEqual(['No row has both a value and a unit to draw, so a table is shown.']);

    const several = show(read(sources.metrics, [steps('2026-10-17', 1), steps('2026-10-17', 2, { metric_name: 'flights_climbed' })]), chart);
    expect(several.view.renderer).toBe('table');
    expect(several.receipt.notes[0]).toContain('more than one measurement (Step count, Flights climbed)');
    expect(reason(several)).toContain('so a table is shown.');

    const units = show(read(sources.metrics, [steps('2026-10-17', 1), steps('2026-10-18', 2, { unit: 'kcal' })]), chart);
    expect(units.view.renderer).toBe('table');
    expect(units.receipt.notes[0]).toContain('more than one unit (count, kcal)');
  });
});

describe('daily show view builder: measurement filter', () => {
  const mixed = [steps('2026-10-16', 11), steps('2026-10-17', 12), steps('2026-10-17', 3, { metric_name: 'flights_climbed', unit: 'count' })];

  it('keeps only the named measurement and discloses what was filtered', () => {
    const build = show(read(sources.metrics, mixed), { display: 'table', metric: 'step_count' });
    expect(build.view.title).toBe('Step count, 11 Oct 2026 to 17 Oct 2026');
    expect(body<Cells>(build).rows.map((row) => row[2])).toEqual(['11', '12']);
    expect(reason(build)).toContain('2 rows shown (Step count only, from 3 rows on this page).');
    expect(build.receipt).toMatchObject({ rowsShown: 2, rowsReturned: 3 });
  });

  it('finds the rows when the name was copied from a drawn view, and refreshes the same window', () => {
    const stored = show(read(sources.metrics, mixed), { display: 'table', metric: 'step_count' });
    for (const metric of ['Step count', 'step count']) {
      const build = show(read(sources.metrics, mixed), { display: 'table', metric });
      expect(body<Cells>(build).rows.map((row) => row[2])).toEqual(['11', '12']);
      expect(build.viewId).toBe(stored.viewId);
    }
  });

  it('prefers the exact stored name over a name that only reads alike', () => {
    const rows = [steps('2026-10-16', 11), steps('2026-10-17', 4, { metric_name: 'Step count' })];
    const build = show(read(sources.metrics, rows), { display: 'table', metric: 'step_count' });
    expect(body<Cells>(build).rows.map((row) => row[2])).toEqual(['11']);
  });

  it('gives a filtered view its own stable id, kept apart from other filters and the unfiltered window', () => {
    const ids = [
      show(read(sources.metrics, mixed), { display: 'table', metric: 'step_count' }).viewId,
      show(read(sources.metrics, mixed), { display: 'table', metric: 'step_count' }).viewId,
      show(read(sources.metrics, mixed), { display: 'table', metric: 'flights_climbed' }).viewId,
      show(read(sources.metrics, mixed), table).viewId,
      show(read(sources.metrics, mixed), { display: 'chart', metric: 'step_count' }).viewId,
    ];
    expect(ids[0]).toMatch(/^daily-metrics-table-step-count-[0-9a-f]{6}$/u);
    expect(ids[4]).toMatch(/^daily-metrics-chart-step-count-[0-9a-f]{6}$/u);
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(ids).size).toBe(4);
  });

  it('keeps ids valid and short for very long or symbol-only measurement names', () => {
    const long = 'x'.repeat(100);
    const rows = [steps('2026-10-17', 1, { metric_name: long })];
    for (const metric of [long, '###', 'Ünïcode name']) {
      const build = show(read(sources.metrics, rows), { display: 'table', metric });
      expect(build.viewId.length).toBeLessThanOrEqual(64);
      expect(build.view.title.length).toBeLessThanOrEqual(200);
    }
    expect(show(read(sources.metrics, rows), { display: 'table', metric: '###' }).viewId).toMatch(/^daily-metrics-table-x-[0-9a-f]{6}$/u);
  });

  it('says plainly when the named measurement is not on the page, and which ones are', () => {
    const build = show(read(sources.metrics, mixed), { display: 'chart', metric: 'distance' });
    expect(build.view.renderer).toBe('text');
    expect(build.view.title).toBe('Distance, 11 Oct 2026 to 17 Oct 2026');
    expect(body<{ content: string }>(build).content).toBe(
      `None of the 3 rows on this page is Distance. Measurements on this page: Flights climbed, Step count. ${readStamp} ${notEstablished}`,
    );
    expect(build.receipt).toEqual({ renderer: 'text', rowsShown: 0, rowsReturned: 3, partial: false, notes: ['No row on this page is Distance.'] });
    expect(build.view.source.status).toBe('complete');
  });

  it('keeps an empty filtered result specific to the selected measurement', () => {
    const build = show(read(sources.metrics, []), { display: 'chart', metric: 'step_count' });
    expect(build.view.renderer).toBe('text');
    expect(build.view.title).toBe('Step count, 11 Oct 2026 to 17 Oct 2026');
    expect(body<{ content: string }>(build).content).toContain('No Step count measurement rows were returned');
    expect(build.receipt).toEqual({ renderer: 'text', rowsShown: 0, rowsReturned: 0, partial: false, notes: [] });
  });

  it('marks an empty selected page partial only when the filtered query has more rows', () => {
    const build = show(read(sources.metrics, [], { hasMore: true }), { display: 'chart', metric: 'step_count' });
    expect(build.view.source.status).toBe('partial');
    expect(build.receipt).toMatchObject({ rowsReturned: 0, partial: true, notes: ['More records are available beyond this page.'] });
    expect(reason(build)).toContain('More records are available beyond this page.');
  });

  it('carries the read time and the disclosure in the text itself, because a text view prints no footnote', () => {
    const build = show(read(sources.metrics, mixed, { observed: '2026-10-17T07:05:00.000Z' }), { display: 'table', metric: 'distance' });
    const { content } = body<{ content: string }>(build);
    expect(build.view.renderer).toBe('text');
    expect(content).toContain('Read 17 Oct 2026, 09:05 Copenhagen time.');
    expect(content.endsWith(`Copenhagen time. ${notEstablished}`)).toBe(true);
  });

  it('warns that a missing measurement may be on another page', () => {
    const build = show(read(sources.metrics, mixed, { hasMore: true }), { display: 'table', metric: 'distance' });
    const { content } = body<{ content: string }>(build);
    expect(content).toContain('may appear on another page');
    expect(content).toContain(readStamp);
    expect(content.endsWith(notEstablished)).toBe(true);
    expect(build.view.source.status).toBe('partial');
  });

  it('ignores a measurement filter for sources that have no measurements', () => {
    const rows: Row[] = [{ sleep_date: '2026-10-17', asleep_hours: 7.25, total_sleep_hours: 7.5, in_bed_hours: 8 }];
    const build = show(read(sources.sleep, rows), { display: 'table', metric: 'step_count' });
    expect(body<Cells>(build).rows).toHaveLength(1);
    expect(build.viewId).toBe('daily-sleep-table');
  });
});

describe('daily show view builder: sleep, workouts and heart rate', () => {
  it('shows sleep with hours in the labels', () => {
    const build = show(read(sources.sleep, [{ sleep_date: '2026-10-17', asleep_hours: 7.25, total_sleep_hours: 7.5, in_bed_hours: 8 }]), table);
    expect(body<Cells>(build)).toEqual({
      columns: ['Date', 'Asleep (h)', 'Total sleep (h)', 'In bed (h)'],
      rows: [['17 Oct 2026', '7.25', '7.5', '8']],
    });
  });

  it('charts sleep with every series covering the same nights in the same order', () => {
    const rows = [night('2026-10-15', 7.25, 7.5), night('2026-10-16', null, 6.75), night('2026-10-17', 6, 6.5)];
    const build = show(read(sources.sleep, rows), chart);
    const plot = body<Plot>(build);
    expect(build.view.title).toBe('Sleep (h), 11 Oct 2026 to 17 Oct 2026');
    expect(plot.series.map((series) => series.name)).toEqual(['Asleep (h)', 'Total sleep (h)']);
    expect(plot.series.map((series) => series.points.map((point) => point.x))).toEqual([['15 Oct', '17 Oct'], ['15 Oct', '17 Oct']]);
    expect(plot.series[0]?.points.map((point) => point.y)).toEqual([7.25, 6]);
    expect(build.receipt).toMatchObject({ partial: true, rowsShown: 2, rowsReturned: 3 });
  });

  it('draws only the sleep series that has values, and falls back when none has', () => {
    const only = show(read(sources.sleep, [night('2026-10-16', null, 6.75)]), chart);
    expect(body<Plot>(only).series.map((series) => series.name)).toEqual(['Total sleep (h)']);
    const none = show(read(sources.sleep, [night('2026-10-16', null, null)]), chart);
    expect(none.view.renderer).toBe('table');
    expect(none.receipt.notes).toEqual(['No row has a sleep value to draw, so a table is shown.']);
  });

  it('shows workouts in a table by default', () => {
    const rows: Row[] = [{ id: 'workout-alpha', workout_date: '2026-10-17', workout_type: 'Running', duration_seconds: 1800, avg_heart_rate: null }];
    const build = show(read(sources.workouts, rows), table);
    expect(build.view.renderer).toBe('table');
    expect(build.viewId).toBe('daily-workouts-table');
    expect(body<Cells>(build)).toEqual({
      columns: ['Date', 'Workout', 'Duration (s)', 'Average heart rate (bpm)'],
      rows: [['17 Oct 2026', 'Running', '1800', 'Unknown']],
    });
  });

  it('charts recorded workout durations and keeps same-date workouts distinct', () => {
    const rows: Row[] = [
      { id: 'workout-alpha', workout_date: '2026-10-17', workout_type: 'Running', duration_seconds: 1800, avg_heart_rate: null },
      { id: 'workout-beta', workout_date: '2026-10-17', workout_type: 'Cycling', duration_seconds: 2700, avg_heart_rate: 120 },
      { id: 'workout-gamma', workout_date: '2026-10-16', workout_type: 'Walking', duration_seconds: null, avg_heart_rate: null },
    ];
    const build = show(read(sources.workouts, rows), chart);
    expect(build.view.renderer).toBe('chart');
    expect(build.viewId).toBe('daily-workouts-chart');
    expect(body<Plot>(build)).toEqual({
      kind: 'bar',
      series: [{ name: 'Duration (s)', points: [{ x: '17 Oct', y: 1800 }, { x: '17 Oct #2', y: 2700 }] }],
    });
    expect(build.receipt).toMatchObject({
      rowsShown: 2,
      rowsReturned: 3,
      partial: true,
      notes: ['1 row without a value or unit left out of the chart.'],
    });
  });

  it('falls back to a table when no workout has a recorded duration', () => {
    const rows: Row[] = [{ id: 'workout-alpha', workout_date: '2026-10-17', workout_type: 'Running', duration_seconds: null, avg_heart_rate: 120 }];
    const build = show(read(sources.workouts, rows), chart);
    expect(build.view.renderer).toBe('table');
    expect(build.viewId).toBe('daily-workouts-table');
    expect(build.receipt.notes).toEqual(['No row has a workout duration to draw, so a table is shown.']);
  });

  it('shows heart rate in Copenhagen time, with one window per workout', () => {
    const rows = [beat('2026-10-17T07:00:00.000Z', 80), beat('2026-10-17T07:01:00.000Z', null)];
    const build = show(read(sources.heartRate, rows, { period: null }), { display: 'table', workoutId: 'workout-alpha' });
    expect(build.view.title).toBe('Heart rate during a workout');
    expect(body<Cells>(build)).toEqual({
      columns: ['Minute', 'Measurement', 'Minimum', 'Average', 'Maximum', 'Unit'],
      rows: [['17 Oct 2026, 09:00', 'Heart rate', '60', '80', '99', 'bpm'], ['17 Oct 2026, 09:01', 'Heart rate', '60', 'Unknown', '99', 'bpm']],
    });
    expect(reason(build)).toContain('Retained Health records for one workout.');
    const again = show(read(sources.heartRate, rows, { period: null }), { display: 'table', workoutId: 'workout-alpha' });
    const other = show(read(sources.heartRate, rows, { period: null }), { display: 'table', workoutId: 'workout-beta' });
    expect(build.viewId).toMatch(/^daily-heart-rate-table-[0-9a-f]{8}$/u);
    expect(again.viewId).toBe(build.viewId);
    expect(other.viewId).not.toBe(build.viewId);
  });

  it('charts the average heart rate by minute and leaves unknown minutes out', () => {
    const rows = [beat('2026-10-17T07:00:00.000Z', 80), beat('2026-10-17T07:01:00.000Z', null), beat('2026-10-17T07:02:00.000Z', 0)];
    const build = show(read(sources.heartRate, rows, { period: null }), { display: 'chart', workoutId: 'workout-alpha' });
    expect(build.view.title).toBe('Average heart rate (bpm) during a workout');
    expect(body<Plot>(build).series).toEqual([{ name: 'Average heart rate (bpm)', points: [{ x: '09:00', y: 80 }, { x: '09:02', y: 0 }] }]);
    expect(build.receipt).toMatchObject({ partial: true, rowsShown: 2, rowsReturned: 3 });
    expect(build.viewId).toMatch(/^daily-heart-rate-chart-[0-9a-f]{8}$/u);
  });

  it('adds the day to heart-rate labels when a workout crosses Copenhagen midnight', () => {
    const rows = [beat('2026-10-17T21:59:00.000Z', 80), beat('2026-10-17T22:00:00.000Z', 81)];
    const build = show(read(sources.heartRate, rows, { period: null }), { display: 'chart', workoutId: 'workout-alpha' });
    expect(body<Plot>(build).series[0]?.points.map((point) => point.x)).toEqual(['17/10 23:59', '18/10 00:00']);
  });
});

describe('daily show view builder: food, favourites and plans', () => {
  it('shows meals with unknown macros flagged and deleted records marked', () => {
    const rows: Row[] = [
      { meal_date: '2026-10-17', meal_name: 'Oat bowl', energy_kcal: null, protein_grams: 12.5, confidence: 0.8, deleted_at: '2026-10-17T10:00:00.000Z' },
      { meal_date: '2026-10-17', meal_name: 'Soup', energy_kcal: 0, protein_grams: null, confidence: 'estimated', deleted_at: null },
    ];
    const build = show(read(sources.meals, rows), chart);
    expect(build.view.title).toBe('Food history, 11 Oct 2026 to 17 Oct 2026');
    expect(body<Cells>(build)).toEqual({
      columns: ['Date', 'Food', 'Energy (kcal)', 'Protein (g)', 'Confidence'],
      rows: [['17 Oct 2026', 'Oat bowl (deleted record)', 'Unknown', '12.5', '0.8'], ['17 Oct 2026', 'Soup', '0', 'Unknown', 'estimated']],
    });
    expect(build.receipt.notes).toEqual(['A chart is not offered for food history, so a table is shown.']);
  });

  it('shows saved favourites without a period', () => {
    const rows: Row[] = [
      { favorite_name: 'Porridge', aliases_json: ['oats', 'breakfast'], energy_kcal: 250, protein_grams: 9, confidence: 'logged' },
      { favorite_name: 'Plain', aliases_json: [], energy_kcal: null, protein_grams: null, confidence: null },
    ];
    const build = show(read(sources.favorites, rows, { period: null }), table);
    expect(build.view.title).toBe('Saved favourites');
    expect(build.viewId).toBe('daily-favourites-table');
    expect(body<Cells>(build).rows).toEqual([['Porridge', 'oats, breakfast', '250', '9', 'logged'], ['Plain', 'None', 'Unknown', 'Unknown', 'Unknown']]);
    expect(reason(build)).toMatch(/^Retained Health records\. 2 rows shown\./u);
  });

  it('shows meal plans with revisions and deleted records marked', () => {
    const rows: Row[] = [{ plan_name: 'Weekday', energy_kcal: 1800, protein_grams: 90, revision: 3, deleted_at: '2026-10-01T08:00:00.000Z' }];
    const build = show(read(sources.plans, rows, { period: null }), table);
    expect(body<Cells>(build)).toEqual({
      columns: ['Plan', 'Energy (kcal)', 'Protein (g)', 'Revision'],
      rows: [['Weekday (deleted record)', '1800', '90', '3']],
    });
    expect(build.viewId).toBe('daily-plans-table');
  });
});

describe('daily show view builder: sync evidence', () => {
  const item: Row = {
    feeds: [{ feed_kind: 'health_export', accepted_evidence_at: '2026-10-17T18:00:00.000Z', processed_committed_at: null }],
    heartbeat: { last_received_at: '2026-10-17T18:30:00.000Z' },
    inbox: { retained: 4, pending: 1, quarantined: 0, last_accepted_at: null, last_processed_upload_at: null },
  };

  it('keeps receipt, processing and phone contact apart as separate evidence', () => {
    const build = show(read(sources.sync, [item], { period: null }), chart);
    expect(build.view.renderer).toBe('detail');
    expect(build.viewId).toBe('daily-sync');
    expect(body<Fields>(build).fields).toEqual([
      { label: 'Phone last contacted', value: '17 Oct 2026, 20:30' },
      { label: 'Pending uploads', value: '1' },
      { label: 'Quarantined uploads', value: '0' },
      { label: 'Health export feed accepted', value: '17 Oct 2026, 20:00' },
      { label: 'Health export feed processed', value: 'Unknown' },
    ]);
    expect(reason(build)).toContain('Upload receipt, successful processing and phone contact are separate evidence.');
  });

  it('reports missing heartbeat, inbox and feeds as unknown or none, never as zero', () => {
    const build = show(read(sources.sync, [{ feeds: [], heartbeat: null, inbox: null }], { period: null }), table);
    expect(body<Fields>(build).fields).toEqual([
      { label: 'Phone last contacted', value: 'Unknown' },
      { label: 'Pending uploads', value: 'Unknown' },
      { label: 'Quarantined uploads', value: 'Unknown' },
      { label: 'Feeds', value: 'None reported' },
    ]);
  });

  it('says plainly when no sync evidence came back, with the read time', () => {
    const build = show(read(sources.sync, [], { period: null }), table);
    expect(build.view.renderer).toBe('text');
    expect(body<{ content: string }>(build).content).toBe(
      'No sync evidence was returned. That does not show nothing was synced: completeness is not established. Read 17 Oct 2026, 21:26 Copenhagen time.',
    );
  });
});

describe('daily show view builder: empty and partial answers', () => {
  it.each([
    [sources.metrics, 'daily-metrics-table', 'No measurement records were returned from 11 Oct 2026 to 17 Oct 2026.'],
    [sources.sleep, 'daily-sleep-table', 'No sleep records were returned from 11 Oct 2026 to 17 Oct 2026.'],
    [sources.workouts, 'daily-workouts-table', 'No workout records were returned from 11 Oct 2026 to 17 Oct 2026.'],
    [sources.meals, 'daily-meals-table', 'No meal records were returned from 11 Oct 2026 to 17 Oct 2026.'],
  ] as const)('says %s is empty without claiming the source is empty', (source, viewId, sentence) => {
    const build = show(read(source, []), chart);
    expect(build.view.renderer).toBe('text');
    expect(build.viewId).toBe(viewId);
    expect(body<{ content: string }>(build).content).toBe(
      `${sentence} That does not show the source is empty: completeness is not established. Read 17 Oct 2026, 21:26 Copenhagen time.`,
    );
    expect(reason(build)).toContain('Read 17 Oct 2026, 21:26 Copenhagen time.');
    expect(build.view.source.status).toBe('complete');
    expect(build.receipt).toEqual({ renderer: 'text', rowsShown: 0, rowsReturned: 0, partial: false, notes: [] });
  });

  it('words empty single-day, workout and periodless reads to fit', () => {
    const day = { startDate: '2026-10-17', endDate: '2026-10-17', timeZone: 'Europe/Copenhagen' } as const;
    const content = (build: DailyViewBuild) => body<{ content: string }>(build).content;
    expect(content(show(read(sources.sleep, [], { period: day }), table))).toMatch(/^No sleep records were returned for 17 Oct 2026\./u);
    expect(content(show(read(sources.heartRate, [], { period: null }), table))).toMatch(/^No heart rate records were returned for this workout\./u);
    expect(content(show(read(sources.favorites, [], { period: null }), table))).toMatch(/^No saved favourite records were returned\./u);
    expect(content(show(read(sources.plans, [], { period: null }), table))).toMatch(/^No meal plan records were returned\./u);
  });

  it('marks a page with more records beyond it as partial in the view, the footnote and the receipt', () => {
    const build = show(read(sources.metrics, [steps('2026-10-17', 1)], { hasMore: true }), table);
    expect(build.view.source.status).toBe('partial');
    expect(reason(build)).toContain('More records are available beyond this page.');
    expect(build.receipt).toMatchObject({ partial: true, notes: ['More records are available beyond this page.'] });
  });

  it('converts read times to Copenhagen time in winter and summer', () => {
    const winter = show(read(sources.metrics, [steps('2026-12-01', 1)], { observed: '2026-12-01T10:00:00.000Z' }), table);
    expect(reason(winter)).toContain('Read 1 Dec 2026, 11:00 Copenhagen time.');
    expect(winter.view.source.updatedAt).toBe('2026-12-01T10:00:00.000Z');
    const summer = show(read(sources.metrics, [steps('2026-07-01', 1)], { observed: '2026-07-01T10:00:00.000Z' }), table);
    expect(reason(summer)).toContain('Read 1 Jul 2026, 12:00 Copenhagen time.');
  });

  it('reports the latest record and source processing times when there is room', () => {
    const build = show(read(sources.metrics, [steps('2026-10-17', 1)], { latest: '2026-10-17T18:00:00.000Z', processed: '2026-10-17T18:05:00.000Z' }), table);
    expect(reason(build)).toContain('Latest record updated 17 Oct 2026, 20:00. Source last processed 17 Oct 2026, 20:05.');
  });
});

describe('daily show view builder: size limits', () => {
  it('shows at most the row cap and says it', () => {
    const rows = Array.from({ length: maxShownRows + 50 }, () => steps('2026-10-17', 1));
    const table200 = show(read(sources.metrics, rows), table);
    expect(body<Cells>(table200).rows).toHaveLength(maxShownRows);
    expect(table200.receipt).toMatchObject({ rowsShown: maxShownRows, rowsReturned: maxShownRows + 50, partial: true });
    expect(table200.receipt.notes).toContain(`Only the first ${maxShownRows} rows of this page are shown.`);
    const plot = show(read(sources.metrics, rows), chart);
    expect(body<Plot>(plot).series[0]?.points).toHaveLength(maxShownRows);
    expect(plot.receipt.notes).toContain(`Only the first ${maxShownRows} rows of this page are drawn.`);
  });

  it('shortens oversized cells and trims rows until the view fits, saying so', () => {
    const rows: Row[] = Array.from({ length: maxShownRows }, () => ({
      meal_date: '2026-10-17', meal_name: 'y'.repeat(3_000), energy_kcal: 1, protein_grams: 1, confidence: 'logged',
    }));
    const build = show(read(sources.meals, rows), table);
    expect(Buffer.byteLength(JSON.stringify(build.view))).toBeLessThanOrEqual(256 * 1024);
    expect(build.receipt.rowsShown).toBeGreaterThanOrEqual(1);
    expect(build.receipt.rowsShown).toBeLessThan(maxShownRows);
    expect(build.receipt.partial).toBe(true);
    expect(build.receipt.notes.join(' ')).toContain(`Showing only the first ${build.receipt.rowsShown} rows so the view stays small.`);
    expect(build.receipt.notes.join(' ')).toContain(`${maxShownRows} long values shortened.`);
    expect(body<Cells>(build).rows.every((row) => (row[1] ?? '').length <= 2_000)).toBe(true);
  });

  it('calls a table partial when a long value was shortened, even though every row is shown', () => {
    const meal = (name: string): Row => ({ meal_date: '2026-10-17', meal_name: name, energy_kcal: 1, protein_grams: 1, confidence: 'logged' });
    const shortened = show(read(sources.meals, [meal('y'.repeat(2_001))]), table);
    expect(body<Cells>(shortened).rows).toHaveLength(1);
    expect(body<Cells>(shortened).rows[0]?.[1]).toHaveLength(2_000);
    expect(shortened.receipt).toEqual({ renderer: 'table', rowsShown: 1, rowsReturned: 1, partial: true, notes: ['1 long value shortened.'] });
    expect(shortened.view.source.status).toBe('partial');
    expect(reason(shortened)).toContain('1 long value shortened.');

    const exact = show(read(sources.meals, [meal('y'.repeat(2_000))]), table);
    expect(body<Cells>(exact).rows[0]?.[1]).toHaveLength(2_000);
    expect(exact.receipt).toEqual({ renderer: 'table', rowsShown: 1, rowsReturned: 1, partial: false, notes: [] });
    expect(exact.view.source.status).toBe('complete');
  });

  it('keeps the closing disclosure and read time when a long note has to be clipped', () => {
    const names = Array.from({ length: 20 }, (_, index) => `measurement_with_a_long_name_${index}`);
    const rows = names.map((name) => steps('2026-10-17', 1, { metric_name: name }));
    const build = show(read(sources.metrics, rows, { latest: '2026-10-17T18:00:00.000Z', processed: '2026-10-17T18:05:00.000Z' }), chart);
    expect(build.view.renderer).toBe('table');
    expect(reason(build).length).toBeLessThanOrEqual(480);
    expect(reason(build)).toContain('Read 17 Oct 2026, 21:26 Copenhagen time.');
    expect(reason(build).endsWith(closing)).toBe(true);
    expect(reason(build)).not.toContain('Source last processed');
  });
});

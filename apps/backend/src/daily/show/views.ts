import { createHash } from 'node:crypto';
import {
  dailyQuerySources,
  type DailyJson,
  type DailyQueryResult,
  type GeneratedView,
  type GeneratedViewSource,
} from '@jarvis/contracts';

/**
 * Turns one Daily read into the table, chart, detail or text view Jarvis shows on screen (P12-16).
 * It is pure: it reads nothing, calls nothing and calculates nothing beyond choosing which returned rows to
 * draw. Labels, units and date wording mirror the Daily page (apps/web/src/daily/presentation.ts) so a chat
 * view and the page agree. Missing values stay "Unknown" and are never drawn or shown as zero.
 */

type Row = Record<string, DailyJson>;
const sources = dailyQuerySources;

export type DailyShowDisplay = 'table' | 'chart';

export const dailyShowSources = [
  sources.metrics, sources.metricCatalog, sources.sleep, sources.workouts, sources.heartRate,
  sources.meals, sources.days, sources.favorites, sources.plans, sources.sync,
] as const;
export type DailyShowSource = typeof dailyShowSources[number];
type TabularSource = Exclude<DailyShowSource, typeof sources.sync>;

export function isDailyShowSource(value: unknown): value is DailyShowSource {
  return (dailyShowSources as readonly unknown[]).includes(value);
}

/** Rows one view carries. A bigger answer is narrowed by dates or by naming one measurement, never paged. */
export const maxShownRows = 200;

export interface DailyViewOptions {
  readonly display: DailyShowDisplay;
  /** Exact `metric_name` to keep from the rows that were returned (measurements and heart rate only). */
  readonly metric?: string | undefined;
  /** The workout a heart-rate read belongs to; the result does not repeat it. */
  readonly workoutId?: string | undefined;
}

export interface DailyViewReceipt {
  readonly renderer: 'table' | 'chart' | 'detail' | 'text';
  readonly rowsShown: number;
  readonly rowsReturned: number;
  readonly partial: boolean;
  readonly notes: readonly string[];
}

export interface DailyViewBuild {
  readonly viewId: string;
  readonly view: GeneratedView;
  readonly receipt: DailyViewReceipt;
}

// The contract caps a view at 256 KiB and its provenance text at a few hundred characters; stay clear of both.
const viewByteBudget = 240 * 1024;
const reasonLimit = 480;
const cellLimit = 2_000;
const titleLimit = 200;
const moreSentence = 'More records are available beyond this page.';
const notEstablishedSentence = 'Completeness and freshness are not established.';
const closingSentence = `${notEstablishedSentence} Unknown means no value was recorded, not zero.`;
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const dateText = /^(\d{4})-(\d{2})-(\d{2})$/u;
const instantText = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const copenhagen = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const finite = (value: DailyJson | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const present = (value: DailyJson | undefined): value is string => typeof value === 'string' && value.length > 0;
const count = (amount: number, one: string) => `${amount} ${amount === 1 ? one : `${one}s`}`;
const clipText = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
const readable = (value: string) => {
  const spaced = value.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
const listed = (values: readonly string[], limit = 12) => values.length > limit
  ? `${values.slice(0, limit).join(', ')} and ${values.length - limit} more`
  : values.join(', ');

function copenhagenParts(date: Date) {
  const parts = new Map(copenhagen.formatToParts(date).map((part) => [part.type, part.value] as const));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function formatDate(value: string): string | null {
  const [, year, month, day] = dateText.exec(value) ?? [];
  const name = monthNames[Number(month) - 1];
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!year || !day || !name || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return `${Number(day)} ${name} ${year}`;
}

function formatInstant(value: string): string | null {
  if (!instantText.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = copenhagenParts(date);
  const name = monthNames[Number(parts.month) - 1];
  return name ? `${Number(parts.day)} ${name} ${parts.year}, ${parts.hour}:${parts.minute}` : null;
}

const stamp = (value: string): string => formatInstant(value) ?? value;
const readSentence = (observedAt: string): string => `Read ${stamp(observedAt)} Copenhagen time.`;

/** "17 Oct": the short form used on chart axes, where the title already carries the full period. */
function shortDate(value: DailyJson | undefined): string {
  if (typeof value !== 'string') return 'Unknown';
  const full = formatDate(value);
  return full ? full.slice(0, -5) : clipText(value, 12);
}

function minuteParts(value: DailyJson | undefined): { day: string; time: string } | null {
  if (typeof value !== 'string' || !instantText.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = copenhagenParts(date);
  return { day: `${parts.day.padStart(2, '0')}/${parts.month.padStart(2, '0')}`, time: `${parts.hour}:${parts.minute}` };
}

function formatValue(value: DailyJson | undefined): string {
  if (value === undefined || value === null || value === '') return 'Unknown';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : 'Unknown';
  if (typeof value === 'string') return formatDate(value) ?? formatInstant(value) ?? value;
  if (Array.isArray(value)) return value.length ? value.map((entry) => formatValue(entry)).join(', ') : 'None';
  return JSON.stringify(value);
}

interface Column { readonly label: string; readonly read: (row: Row) => DailyJson | undefined }
const field = (label: string, key: string): Column => ({ label, read: (row) => row[key] });
const measurement = (label: string): Column => ({
  label,
  read: (row) => {
    const name = row.metric_name;
    return typeof name === 'string' ? readable(name) : name;
  },
});
const named = (label: string, key: string): Column => ({
  label,
  read: (row) => {
    const name = row[key];
    const deleted = row.deleted_at !== undefined && row.deleted_at !== null;
    return typeof name === 'string' && deleted ? `${name} (deleted record)` : name;
  },
});

interface Meta { readonly label: string; readonly noun: string; readonly slug: string; readonly columns: readonly Column[] }
const metas: Record<TabularSource, Meta> = {
  [sources.metrics]: {
    label: 'Measurements', noun: 'measurement', slug: 'metrics',
    columns: [field('Date', 'metric_date'), measurement('Measurement'), field('Value', 'value'), field('Average', 'avg_value'), field('Unit', 'unit')],
  },
  [sources.metricCatalog]: {
    label: 'Measurement catalogue', noun: 'measurement', slug: 'metric-catalog',
    columns: [measurement('Measurement'), field('Units', 'units'), field('First date', 'first_date'),
      field('Last date', 'last_date'), field('Days measured', 'day_count'), field('Latest update', 'latest_updated_at')],
  },
  [sources.sleep]: {
    label: 'Sleep', noun: 'sleep', slug: 'sleep',
    columns: [field('Date', 'sleep_date'), field('Asleep (h)', 'asleep_hours'), field('Total sleep (h)', 'total_sleep_hours'), field('In bed (h)', 'in_bed_hours')],
  },
  [sources.workouts]: {
    label: 'Workouts', noun: 'workout', slug: 'workouts',
    columns: [field('Date', 'workout_date'), field('Workout', 'workout_type'), field('Duration (s)', 'duration_seconds'), field('Average heart rate (bpm)', 'avg_heart_rate')],
  },
  [sources.heartRate]: {
    label: 'Heart rate during a workout', noun: 'heart rate', slug: 'heart-rate',
    columns: [field('Minute', 'sample_minute'), measurement('Measurement'), field('Minimum', 'min_value'), field('Average', 'avg_value'), field('Maximum', 'max_value'), field('Unit', 'unit')],
  },
  [sources.meals]: {
    label: 'Food history', noun: 'meal', slug: 'meals',
    columns: [field('Date', 'meal_date'), named('Food', 'meal_name'), field('Energy (kcal)', 'energy_kcal'), field('Protein (g)', 'protein_grams'), field('Confidence', 'confidence')],
  },
  [sources.days]: {
    label: 'Nutrition by day', noun: 'nutrition day', slug: 'nutrition-days',
    columns: [field('Date', 'meal_date'), field('Meals', 'meal_count'), field('Energy (kcal)', 'energy_kcal'),
      field('Protein (g)', 'protein_grams'), field('Carbohydrates (g)', 'carbohydrates_grams'),
      field('Fat (g)', 'fat_grams'), field('Fiber (g)', 'fiber_grams'),
      field('Unknown nutrients', 'unknown_nutrients'), field('Partial nutrients', 'partial_nutrients')],
  },
  [sources.favorites]: {
    label: 'Saved favourites', noun: 'saved favourite', slug: 'favourites',
    columns: [field('Favourite', 'favorite_name'), field('Aliases', 'aliases_json'), field('Energy (kcal)', 'energy_kcal'), field('Protein (g)', 'protein_grams'), field('Confidence', 'confidence')],
  },
  [sources.plans]: {
    label: 'Meal plans', noun: 'meal plan', slug: 'plans',
    columns: [named('Plan', 'plan_name'), field('Energy (kcal)', 'energy_kcal'), field('Protein (g)', 'protein_grams'), field('Revision', 'revision')],
  },
};

type Series = { name: string; points: { x: string; y: number }[] }[];
const make = {
  table: (title: string, source: GeneratedViewSource, columns: string[], rows: string[][]): GeneratedView =>
    ({ version: 1, title, renderer: 'table', source, data: { columns, rows } }),
  chart: (title: string, source: GeneratedViewSource, series: Series): GeneratedView =>
    ({ version: 1, title, renderer: 'chart', source, data: { kind: 'bar', series } }),
  detail: (title: string, source: GeneratedViewSource, fields: { label: string; value: string }[]): GeneratedView =>
    ({ version: 1, title, renderer: 'detail', source, data: { fields } }),
  text: (title: string, source: GeneratedViewSource, content: string): GeneratedView =>
    ({ version: 1, title, renderer: 'text', source, data: { format: 'plain', content } }),
};

const receipt = (renderer: DailyViewReceipt['renderer'], shown: number, returned: number, partial: boolean, notes: readonly string[]): DailyViewReceipt =>
  ({ renderer, rowsShown: shown, rowsReturned: returned, partial, notes });

function periodPhrase(period: DailyQueryResult['period']): string | null {
  if (!period) return null;
  const start = formatDate(period.startDate) ?? period.startDate;
  const end = formatDate(period.endDate) ?? period.endDate;
  return start === end ? start : `${start} to ${end}`;
}

function scopeSentence(result: DailyQueryResult): string {
  const period = periodPhrase(result.period);
  if (result.source === sources.days) {
    return `Per-day totals derived from retained, non-deleted meals${period ? `, ${period} (Copenhagen dates)` : ''}. Partial nutrient totals are lower bounds.`;
  }
  if (period) return `Retained Daily records, ${period} (Copenhagen dates).`;
  return result.source === sources.heartRate ? 'Retained Daily records for one workout.' : 'Retained Daily records.';
}

function titleFor(label: string, result: DailyQueryResult): string {
  const period = periodPhrase(result.period);
  return clipText(period ? `${label}, ${period}` : label, titleLimit);
}

/**
 * The footnote under every view: provenance, read time, coverage and the unknown-is-not-zero rule. The closing
 * disclosure and read time are never clipped; the variable lead and the optional timestamps give way first.
 */
function sourceFor(result: DailyQueryResult, partial: boolean, lead: readonly string[]): GeneratedViewSource {
  const { observedAt, latestReturnedRecordUpdatedAt, sourceProcessedCommittedAt } = result.freshness;
  const read = readSentence(observedAt);
  let extras = [
    ...(latestReturnedRecordUpdatedAt ? [`Latest record updated ${stamp(latestReturnedRecordUpdatedAt)}.`] : []),
    ...(sourceProcessedCommittedAt ? [`Source last processed ${stamp(sourceProcessedCommittedAt)}.`] : []),
  ];
  const head = lead.join(' ');
  const compose = (list: readonly string[]) => [head, read, ...list, closingSentence].join(' ');
  while (extras.length && compose(extras).length > reasonLimit) extras = extras.slice(0, -1);
  const fixed = [read, ...extras, closingSentence].join(' ');
  const reason = compose(extras).length <= reasonLimit ? compose(extras) : `${clipText(head, reasonLimit - fixed.length - 1)} ${fixed}`;
  const stamped = instantText.test(observedAt) && !Number.isNaN(Date.parse(observedAt)) ? { updatedAt: observedAt } : {};
  return { id: 'now', status: partial ? 'partial' : 'complete', ...stamped, reason };
}

const hash = (value: string, length: number) => createHash('sha256').update(value).digest('hex').slice(0, length);

/** Stable per source, shown form and filter, so asking again refreshes the same window instead of opening another. */
function viewIdFor(source: DailyShowSource, shown: 'table' | 'chart', options: DailyViewOptions): string {
  if (source === sources.sync) return 'daily-sync';
  const slug = metas[source].slug;
  if (source === sources.heartRate) {
    return `daily-${slug}-${shown}-${hash(`${options.workoutId ?? ''}\u0000${options.metric ?? ''}`, 8)}`;
  }
  if (source === sources.metrics && options.metric) {
    const readableSlug = options.metric.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-').replaceAll(/^-+|-+$/gu, '').slice(0, 20).replace(/-+$/u, '');
    return `daily-${slug}-${shown}-${readableSlug || 'x'}-${hash(options.metric, 6)}`;
  }
  return `daily-${slug}-${shown}`;
}

/** Repeated labels would merge bars on a category axis, so later repeats get " #2", " #3". */
function uniqueLabels(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const times = (seen.get(label) ?? 0) + 1;
    seen.set(label, times);
    return times === 1 ? label : `${label} #${times}`;
  });
}

interface ChartPlan {
  readonly title: string;
  readonly series: Series;
  readonly plotted: number;
  readonly considered: number;
  readonly notes: readonly string[];
}
type ChartDecision = { readonly plan: ChartPlan } | { readonly fallback: string };

/**
 * A chart is drawn only when everything on it shares one unit and one measurement, and only from rows that have
 * a real value; otherwise the honest answer is a table. Every series covers the same rows, in row order.
 */
function planChart(source: TabularSource, rows: readonly Row[]): ChartDecision {
  if (source === sources.sleep) {
    const wanted = [['Asleep (h)', 'asleep_hours'], ['Total sleep (h)', 'total_sleep_hours']] as const;
    const drawn = wanted.filter(([, key]) => rows.some((row) => finite(row[key])));
    const usable = rows.filter((row) => drawn.every(([, key]) => finite(row[key])));
    if (!drawn.length || !usable.length) return { fallback: 'No row has a sleep value to draw, so a table is shown.' };
    const labels = uniqueLabels(usable.map((row) => shortDate(row.sleep_date)));
    return {
      plan: {
        title: 'Sleep (h)',
        series: drawn.map(([name, key]) => ({ name, points: usable.map((row, index) => ({ x: labels[index] ?? '', y: Number(row[key]) })) })),
        plotted: usable.length, considered: rows.length, notes: [],
      },
    };
  }
  if (source !== sources.metrics && source !== sources.heartRate) {
    return { fallback: `A chart is not offered for ${metas[source].label.toLowerCase()}, so a table is shown.` };
  }
  const heart = source === sources.heartRate;
  const names = [...new Set(rows.map((row) => row.metric_name).filter(present))];
  const [name] = names;
  if (names.length !== 1 || !name) {
    return {
      fallback: names.length
        ? `The rows cover more than one measurement (${listed(names.map(readable))}), so a table is shown. Ask for one by name to chart it.`
        : 'The rows have no measurement name, so a table is shown.',
    };
  }
  const key = !heart && rows.some((row) => finite(row.value)) ? 'value' : 'avg_value';
  const usable = rows.filter((row) => finite(row[key]) && present(row.unit));
  const units = [...new Set(usable.map((row) => String(row.unit)))];
  const [unit] = units;
  if (units.length !== 1 || !unit) {
    return {
      fallback: units.length
        ? `The values use more than one unit (${listed(units)}), so a table is shown.`
        : 'No row has both a value and a unit to draw, so a table is shown.',
    };
  }
  const days = new Set(usable.flatMap((row) => {
    const at = minuteParts(row.sample_minute);
    return at ? [at.day] : [];
  }));
  const axis = (row: Row) => {
    if (!heart) return shortDate(row.metric_date);
    const at = minuteParts(row.sample_minute);
    if (!at) return typeof row.sample_minute === 'string' ? clipText(row.sample_minute, 12) : 'Unknown';
    return days.size > 1 ? `${at.day} ${at.time}` : at.time;
  };
  const labels = uniqueLabels(usable.map(axis));
  const shown = clipText(readable(name), 60);
  const label = heart ? `Average ${shown.toLowerCase()} (${unit})` : `${shown}${key === 'avg_value' ? ' average' : ''} (${unit})`;
  return {
    plan: {
      title: heart ? `${label} during a workout` : label,
      series: [{ name: label, points: usable.map((row, index) => ({ x: labels[index] ?? '', y: Number(row[key]) })) }],
      plotted: usable.length, considered: rows.length,
      notes: !heart && key === 'value' && usable.some((row) => finite(row.avg_value))
        ? ['Only the recorded value is drawn, not the average.'] : [],
    },
  };
}

function emptyView(source: TabularSource, result: DailyQueryResult, options: DailyViewOptions): DailyViewBuild {
  const meta = metas[source];
  const period = periodPhrase(result.period);
  const where = period
    ? (period.includes(' to ') ? ` from ${period}` : ` for ${period}`)
    : source === sources.heartRate ? ' for this workout' : '';
  return {
    viewId: viewIdFor(source, 'table', options),
    view: make.text(
      titleFor(meta.label, result),
      sourceFor(result, false, [scopeSentence(result), 'No rows were returned.']),
      `No ${meta.noun} records were returned${where}. That does not show the source is empty: completeness is not established. ${readSentence(result.freshness.observedAt)}`,
    ),
    receipt: receipt('text', 0, 0, false, []),
  };
}

function syncView(result: DailyQueryResult, options: DailyViewOptions): DailyViewBuild {
  const source = sourceFor(result, false, [
    scopeSentence(result),
    'Upload receipt, successful processing and phone contact are separate evidence.',
  ]);
  const viewId = viewIdFor(sources.sync, 'table', options);
  const item = result.items[0];
  if (!item) {
    return {
      viewId,
      view: make.text(
        'Sync evidence',
        source,
        `No sync evidence was returned. That does not show nothing was synced: completeness is not established. ${readSentence(result.freshness.observedAt)}`,
      ),
      receipt: receipt('text', 0, 0, false, []),
    };
  }
  const record = (value: DailyJson | undefined): Row | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  const heartbeat = record(item.heartbeat);
  const inbox = record(item.inbox);
  const feeds = Array.isArray(item.feeds) ? item.feeds.map((feed) => record(feed)).filter((feed): feed is Row => feed !== null) : [];
  const fields = [
    { label: 'Phone last contacted', value: formatValue(heartbeat?.last_received_at) },
    { label: 'Pending uploads', value: formatValue(inbox?.pending) },
    { label: 'Quarantined uploads', value: formatValue(inbox?.quarantined) },
    ...(feeds.length ? feeds.flatMap((feed) => {
      const kind = typeof feed.feed_kind === 'string' ? readable(feed.feed_kind) : 'Unnamed';
      return [
        { label: clipText(`${kind} feed accepted`, 100), value: formatValue(feed.accepted_evidence_at) },
        { label: clipText(`${kind} feed processed`, 100), value: formatValue(feed.processed_committed_at) },
      ];
    }) : [{ label: 'Feeds', value: 'None reported' }]),
  ];
  return { viewId, view: make.detail('Sync evidence', source, fields), receipt: receipt('detail', fields.length, 1, false, []) };
}

export function buildDailyView(result: DailyQueryResult, options: DailyViewOptions): DailyViewBuild {
  const sourceId = result.source;
  if (!isDailyShowSource(sourceId)) throw new TypeError('This Daily source has no on-screen view.');
  if (sourceId === sources.sync) return syncView(result, options);
  const meta = metas[sourceId];
  const returned = result.items.length;
  if (returned === 0) return emptyView(sourceId, result, options);

  const hasMore = result.coverage.hasMore;
  const moreNote = hasMore ? [moreSentence] : [];
  const scope = scopeSentence(result);
  const filterable = sourceId === sources.metrics || sourceId === sources.heartRate;
  const metric = filterable ? options.metric : undefined;
  const wanted = metric ? clipText(readable(metric), 60) : null;
  // The exact stored name wins; a name copied from a drawn view ("Step count") still finds its rows.
  const exact = metric ? result.items.filter((row) => row.metric_name === metric) : result.items;
  const matching = metric && exact.length === 0
    ? result.items.filter((row) => typeof row.metric_name === 'string' && readable(row.metric_name) === readable(metric))
    : exact;
  const keyed = metric && typeof matching[0]?.metric_name === 'string' ? { ...options, metric: matching[0].metric_name } : options;

  if (wanted && matching.length === 0) {
    const names = [...new Set(result.items.map((row) => row.metric_name).filter(present))].map(readable).sort();
    // A text view prints no footnote, so the read time and the disclosure have to live in the text itself.
    const content = `None of the ${count(returned, 'row')} on this page is ${wanted}. ` +
      `Measurements on this page: ${names.length ? listed(names) : 'none with a name'}.` +
      (hasMore ? ' More records are available beyond this page, so it may appear on another page.' : '') +
      ` ${readSentence(result.freshness.observedAt)} ${notEstablishedSentence}`;
    return {
      viewId: viewIdFor(sourceId, 'table', options),
      view: make.text(
        titleFor(wanted, result),
        sourceFor(result, hasMore, [scope, `0 of ${count(returned, 'row')} match.`, ...moreNote]),
        content,
      ),
      receipt: receipt('text', 0, returned, hasMore, [`No row on this page is ${wanted}.`, ...moreNote]),
    };
  }

  const heading = wanted ?? meta.label;
  const filterNote = wanted ? ` (${clipText(wanted, 40)} only, from ${count(returned, 'row')} on this page)` : '';
  const shown = matching.slice(0, maxShownRows);
  const capped = shown.length < matching.length;
  const cappedNote = (verb: 'shown' | 'drawn') => capped ? [`Only the first ${count(maxShownRows, 'row')} of this page are ${verb}.`] : [];

  const decision = options.display === 'chart' ? planChart(sourceId, shown) : null;
  if (decision && 'plan' in decision) {
    const { plan } = decision;
    const skipped = plan.considered - plan.plotted;
    const notes = [
      ...cappedNote('drawn'),
      ...(skipped > 0 ? [`${count(skipped, 'row')} without a value or unit left out of the chart.`] : []),
      ...plan.notes,
    ];
    const partial = hasMore || capped || skipped > 0;
    const period = periodPhrase(result.period);
    return {
      viewId: viewIdFor(sourceId, 'chart', keyed),
      view: make.chart(
        clipText(period ? `${plan.title}, ${period}` : plan.title, titleLimit),
        sourceFor(result, partial, [scope, `${count(plan.plotted, 'row')} drawn${filterNote}.`, ...notes, ...moreNote]),
        plan.series,
      ),
      receipt: receipt('chart', plan.plotted, returned, partial, [...notes, ...moreNote]),
    };
  }

  let clippedCells = 0;
  const cells = shown.map((row) => meta.columns.map((column) => {
    const text = formatValue(column.read(row));
    if (text.length <= cellLimit) return text;
    clippedCells += 1;
    return clipText(text, cellLimit);
  }));
  const columns = meta.columns.map((column) => column.label);
  const title = titleFor(heading, result);
  const probeSource: GeneratedViewSource = { id: 'now', status: 'partial' };
  const bytes = (rows: number) => Buffer.byteLength(JSON.stringify(make.table(title, probeSource, columns, cells.slice(0, rows))));
  let kept = cells.length;
  while (kept > 1 && bytes(kept) > viewByteBudget) kept = Math.ceil(kept / 2);
  const trimmed = kept < cells.length;

  const notes = [
    ...(decision && 'fallback' in decision ? [decision.fallback] : []),
    ...cappedNote('shown'),
    ...(trimmed ? [`Showing only the first ${count(kept, 'row')} so the view stays small. Ask for a narrower period or one measurement to see the rest.`] : []),
    ...(clippedCells ? [`${count(clippedCells, 'long value')} shortened.`] : []),
  ];
  const partial = hasMore || capped || trimmed || clippedCells > 0;
  return {
    viewId: viewIdFor(sourceId, 'table', keyed),
    view: make.table(
      title,
      sourceFor(result, partial, [scope, `${count(kept, 'row')} shown${filterNote}.`, ...notes, ...moreNote]),
      columns,
      cells.slice(0, kept),
    ),
    receipt: receipt('table', kept, returned, partial, [...notes, ...moreNote]),
  };
}

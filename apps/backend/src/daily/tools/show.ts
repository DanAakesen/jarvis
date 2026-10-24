import { randomUUID } from 'node:crypto';
import {
  dailyQuerySources as sources, isDailyQuery, isWorkspaceCommand,
  type WorkspaceCommand,
} from '@jarvis/contracts';
import type { FastifyRequest } from 'fastify';
import { generatedViewValidationOptions } from '../../core/generated-view-validation.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import { resolveDailyOwner } from '../owner.js';
import type { DailyQueryService } from '../query.js';
import {
  buildDailyView, dailyShowSources, isDailyShowSource, maxShownRows,
  type DailyShowDisplay, type DailyShowSource, type DailyViewBuild,
} from '../show/views.js';

// The agent gives a read tool 30 s unless it names its own limit, so this deadline must stay under it: the model
// then reads this tool's failure instead of a generic timeout.
const showDeadlineMs = 25_000;
const foregroundDeadlineMs = 3_000;
const dayMs = 86_400_000;

const selectors: Readonly<Record<DailyShowSource, readonly string[]>> = {
  [sources.metrics]: ['startDate', 'endDate', 'limit', 'metric'],
  [sources.metricCatalog]: ['startDate', 'endDate', 'limit'],
  [sources.sleep]: ['startDate', 'endDate', 'limit'],
  [sources.workouts]: ['startDate', 'endDate', 'limit'],
  [sources.heartRate]: ['workoutId', 'limit', 'metric'],
  [sources.meals]: ['startDate', 'endDate', 'limit'],
  [sources.days]: ['startDate', 'endDate', 'limit', 'metric'],
  [sources.favorites]: ['limit'],
  [sources.plans]: ['limit'],
  [sources.sync]: [],
};
const periodSources = new Set<DailyShowSource>([sources.metrics, sources.metricCatalog, sources.sleep, sources.workouts, sources.meals, sources.days]);
const chartableSources = new Set<DailyShowSource>([sources.metrics, sources.sleep, sources.workouts, sources.heartRate, sources.days]);
const hundredRowSources = new Set<DailyShowSource>([sources.meals, sources.favorites, sources.plans]);
const unsupportedSources = new Set<unknown>([sources.briefs, sources.brief, sources.workout]);

const inputSchema = {
  type: 'object',
  properties: {
    source: {
      type: 'string',
      enum: [...dailyShowSources],
      description: 'What to show: retained measurements such as steps, the measurement catalogue, sleep, workouts, heart rate during one workout, logged food, per-day nutrition totals, saved favourites, meal plans or upload and processing evidence.',
    },
    startDate: { type: 'string', description: 'First day, YYYY-MM-DD, Europe/Copenhagen, inclusive. Required for measurements, the metric catalogue, sleep, workouts, meals and nutrition days; not accepted for the other sources.' },
    endDate: { type: 'string', description: 'Last day, YYYY-MM-DD, inclusive, at most 366 days after startDate. Required with startDate.' },
    workoutId: { type: 'string', minLength: 1, maxLength: 256, description: 'Heart rate only: the exact id of one workout, read from a workouts result.' },
    metric: { type: 'string', minLength: 1, maxLength: 256, description: 'Measurements and heart rate: one exact metric_name or readable name (exact key wins), filtered before the page. Nutrition days: one nutrient key to chart (energy_kcal, protein_grams, carbohydrates_grams, fat_grams or fiber_grams).' },
    display: { type: 'string', enum: ['table', 'chart'], description: 'Choose from the request, not the source: honor an explicit table/chart preference; use a chart for a useful trend or comparison with one comparable metric, not a simple factual question. Defaults to table.' },
    limit: { type: 'integer', minimum: 1, maximum: maxShownRows, description: 'Rows to read after any measurement filter. Meals, favourites and meal plans allow at most 100; the generated view allows at most 200 nutrition days. A chart or a named measurement reads a full filtered page unless this is set.' },
  },
  required: ['source'],
  additionalProperties: false,
} as const;

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !value.startsWith('0000-') &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

const hasControl = (value: string) => [...value].some((character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
});

const isKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !hasControl(value);

interface ShowRequest {
  readonly query: Record<string, unknown>;
  readonly display: DailyShowDisplay;
  readonly metric: string | undefined;
  readonly workoutId: string | undefined;
}

const limitCap = (source: DailyShowSource) => hundredRowSources.has(source) ? 100 : maxShownRows;

/** Refusals are static wording: they reach the model and the logs, so they never echo what the model sent. */
function parse(raw: unknown): ShowRequest {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolRefusal('Send one object with a source and only that source\'s fields.');
  }
  const input = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
  const source = input.source;
  if (unsupportedSources.has(source)) {
    throw new ToolRefusal('Brief history and a single workout are read with daily_query. daily_show shows measurements, the metric catalogue, sleep, workouts, heart rate, meals, per-day nutrition totals, favourites, meal plans and sync evidence.');
  }
  if (!isDailyShowSource(source)) throw new ToolRefusal(`Choose a source: ${dailyShowSources.join(', ')}.`);
  if (Object.hasOwn(input, 'cursor')) {
    throw new ToolRefusal('This tool shows one bounded page and cannot continue a cursor. Narrow the dates or select one measurement to filter before the page limit.');
  }
  const allowed = selectors[source];
  if (Object.keys(input).some((key) => key !== 'source' && key !== 'display' && !allowed.includes(key))) {
    throw new ToolRefusal(`This source takes only: ${['source', ...allowed, 'display'].join(', ')}.`);
  }

  const display = input.display ?? 'table';
  if (display !== 'table' && display !== 'chart') throw new ToolRefusal('Display must be table or chart.');

  let metric: string | undefined;
  if (input.metric !== undefined) {
    metric = typeof input.metric === 'string' ? input.metric.trim() : '';
    if (metric.length < 1 || metric.length > 256 || hasControl(metric)) {
      throw new ToolRefusal('The measurement name must be 1 to 256 characters without control characters.');
    }
  }
  if (source === sources.days && metric !== undefined && display !== 'chart') {
    throw new ToolRefusal('A nutrition nutrient selector is only used for charts. Omit it for a table.');
  }

  const query: Record<string, unknown> = { source };
  if (periodSources.has(source)) {
    const { startDate, endDate } = input;
    if (!isDay(startDate) || !isDay(endDate)) throw new ToolRefusal('Give startDate and endDate as real calendar dates written YYYY-MM-DD.');
    if (endDate < startDate) throw new ToolRefusal('endDate cannot be before startDate.');
    if (Date.parse(endDate) - Date.parse(startDate) > 366 * dayMs) throw new ToolRefusal('The period can be at most 366 days. Narrow it.');
    query.startDate = startDate;
    query.endDate = endDate;
  }
  let workoutId: string | undefined;
  if (source === sources.heartRate) {
    if (!isKey(input.workoutId)) {
      throw new ToolRefusal('Heart rate needs the exact workoutId of one workout. Show the workouts first and use the id from that result.');
    }
    workoutId = input.workoutId;
    query.workoutId = workoutId;
  }
  if (metric !== undefined && source !== sources.days) query.metric = metric;

  if (allowed.includes('limit')) {
    const cap = limitCap(source);
    if (input.limit !== undefined &&
        (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > cap)) {
      throw new ToolRefusal(`The limit must be a whole number from 1 to ${cap}.`);
    }
    const drawn = display === 'chart' && chartableSources.has(source);
    const limit = input.limit ?? (drawn || metric !== undefined ? cap : undefined);
    if (limit !== undefined) query.limit = limit;
  }
  if (!isDailyQuery(query)) throw new ToolRefusal('Those selectors do not make a valid Health read. Check the source, dates and workout id.');
  return { query, display, metric, workoutId };
}

/** Refreshes the view when it is open and opens it when it is not, so asking again never stacks a duplicate. */
async function publish(
  request: FastifyRequest, ownerId: string, build: DailyViewBuild, signal: AbortSignal,
): Promise<'created' | 'refreshed'> {
  const broker = request.server.workspaceCommands;
  const command = (operation: 'create' | 'update'): WorkspaceCommand => {
    const candidate: WorkspaceCommand = { commandId: randomUUID(), operation, viewId: build.viewId, view: build.view };
    if (!isWorkspaceCommand(candidate, generatedViewValidationOptions(request.server))) {
      throw new ToolFailure('The Health view did not pass workspace validation.');
    }
    return candidate;
  };
  try {
    await broker.execute(ownerId, command('update'), signal);
  } catch (error) {
    if (!(error instanceof ToolRefusal)) throw error;
    await broker.execute(ownerId, command('create'), signal);
    return 'created';
  }
  // A refresh does not bring the window forward; showing it is a courtesy, so its failure is not the tool's.
  await broker.execute(
    ownerId, { commandId: randomUUID(), operation: 'show', viewId: build.viewId },
    AbortSignal.any([signal, AbortSignal.timeout(foregroundDeadlineMs)]),
  ).catch(() => undefined);
  return 'refreshed';
}

/** Shows one page of retained Daily data in the workspace as a table, chart or detail view. Reads and draws only. */
export function dailyShowTool(service: Pick<DailyQueryService, 'query'>): JarvisTool {
  return {
    name: 'daily_show',
    description: 'Show retained Health data on screen in the signed-in workspace when a visual is useful or explicitly requested; otherwise answer through daily_query in the conversation. Understand the request in Danish or English: infer its source, metric/nutrient, period, comparison and preferred form from meaning, not exact trigger phrases. Honor explicit table/chart requests. A simple fact or explanation does not need an extra view; use a chart for a clear trend/comparison when one comparable metric is selected. Measurements, the metric catalogue, sleep, workouts, meals and nutrition days need startDate and endDate (YYYY-MM-DD, Europe/Copenhagen, at most 366 days); heart rate needs the exact workoutId from a workouts result; favourites, meal plans and sync take no dates. Nutrition-day totals are derived from retained non-deleted meals; nutrients missing from every meal are Unknown, and partial totals are lower bounds. For measurements and heart rate, metric selects one exact metric_name or readable name and filtering happens before the bounded page. For nutrition days, metric selects one nutrient key: energy_kcal, protein_grams, carbohydrates_grams, fat_grams or fiber_grams. Charts show workout duration, sleep hours, one measurement, one per-day nutrient, or heart rate during a workout; unsupported or incomparable requests fall back to a table with a note. Workout durations are seconds by date. Nutrition charts use returned per-day totals without summing, filling gaps or changing units; partial nutrient totals are lower bounds and unknown values are not plotted. The view adds no calculations, estimates or fill-ins; unknown is never zero, and completeness/freshness are not established. Each source, form and selected metric keeps one view, so asking again refreshes it rather than opening another. This is one bounded page: when partial or hasMore is returned, disclose that and never claim the entire period was shown. Brief history and one workout are not shown here; use daily_query then the existing workspace text/detail view when requested. Report the actual view.renderer, its notes and returned facts. This is private health data, unavailable on the phone; nothing is logged, changed or sent.',
    inputSchema,
    bodyLimit: 2048,
    sensitive: true,
    denyOnPhone: true,
    execute: async (raw, request, signal) => {
      const ownerId = resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Health views are for the signed-in workspace, not for external clients.');
      const { query, display, metric, workoutId } = parse(raw);
      // Refuse before reading: private data that cannot be shown should not be fetched.
      if (!request.server.workspaceCommands.isConnected(ownerId)) {
        throw new ToolRefusal('Open the signed-in conversation workspace to see a Health view, or read the records with daily_query and answer in words.');
      }
      const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(showDeadlineMs)]);
      try {
        const result = await service.query(query, request, operationSignal);
        operationSignal.throwIfAborted();
        const build = buildDailyView(result, { display, metric, workoutId });
        const operation = await publish(request, ownerId, build, operationSignal);
        // A late success after the abort or the deadline must not look like one.
        operationSignal.throwIfAborted();
        return { view: { viewId: build.viewId, operation, ...build.receipt }, result };
      } catch (error) {
        // An outer abort passes through untouched; only this tool's own deadline becomes a clear failure.
        if (signal.aborted) throw signal.reason;
        if (operationSignal.aborted) throw new ToolFailure('Showing the Health view took too long. Try again with a shorter period.');
        throw error;
      }
    },
  };
}

import { useEffect, useState } from 'react';
import { backendFetch } from '../backend-request';
import { TaskWindowLink } from '../TaskWindowLink';
import type { AreaProps } from '../areas';
import { Loader } from '../Loader';
import { CollapsibleSection } from '../CollapsibleSection';

type UsagePeriod = '7d' | '30d' | '90d' | 'all';
type UsageGroupBy = 'project' | 'agent' | 'source';
type UsageSource = 'sandbox' | 'jarvis_model' | 'voice' | 'codex' | 'copilot';
type UsageMetric = 'minutes' | 'input_tokens' | 'output_tokens' | 'turns' | 'premium_requests' | 'screen_frames';
type UsageAgent = 'codex' | 'copilot' | 'jarvis';

interface UsageEntry {
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  agent: UsageAgent;
  source: UsageSource;
  metric: UsageMetric;
  quantity: number;
  costDkk: number | null;
  at: string;
  estimated: boolean;
}

interface UsageReport {
  period: UsagePeriod;
  from: string | null;
  to: string;
  codexToolCallsToday: { tool: 'web_research'; count: string }[] | null;
  entries: UsageEntry[];
  totalEntries: string;
  truncated: boolean;
  dailyToolUsage: {
    date: string;
    tools: { tool: string; count: string }[];
  };
}

type LoadState =
  | { status: 'loading'; requestKey: string }
  | { status: 'error'; message: string; requestKey: string }
  | { status: 'ready'; report: UsageReport; requestKey: string };

const periods: { value: UsagePeriod; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];
const usageSources: UsageSource[] = ['sandbox', 'jarvis_model', 'voice', 'codex', 'copilot'];
const usageMetrics: UsageMetric[] = ['minutes', 'input_tokens', 'output_tokens', 'turns', 'premium_requests', 'screen_frames'];
const usageAgents: UsageAgent[] = ['codex', 'copilot', 'jarvis'];
const maxSqlBigInt = 9_223_372_036_854_775_807n;
const dkk = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 4 });
const quantityFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const countFormat = new Intl.NumberFormat('en-GB');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maxSqlBigInt;
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isUsageEntry(value: unknown): value is UsageEntry {
  return isObject(value) &&
    (value.taskId === null || isId(value.taskId)) &&
    (value.taskTitle === null || typeof value.taskTitle === 'string') &&
    (value.projectId === null || isId(value.projectId)) &&
    (value.projectName === null || typeof value.projectName === 'string') &&
    usageAgents.includes(value.agent as UsageAgent) &&
    usageSources.includes(value.source as UsageSource) &&
    usageMetrics.includes(value.metric as UsageMetric) &&
    typeof value.quantity === 'number' && Number.isFinite(value.quantity) && value.quantity >= 0 &&
    (value.costDkk === null || (typeof value.costDkk === 'number' && Number.isFinite(value.costDkk) && value.costDkk >= 0)) &&
    isDate(value.at) && typeof value.estimated === 'boolean';
}

function isUsageReport(value: unknown): value is UsageReport {
  return isObject(value) &&
    periods.some(({ value: period }) => period === value.period) &&
    (value.from === null || isDate(value.from)) && isDate(value.to) &&
    (value.codexToolCallsToday === null || (Array.isArray(value.codexToolCallsToday) &&
      value.codexToolCallsToday.length <= 10 && value.codexToolCallsToday.every((count) =>
        isObject(count) && count.tool === 'web_research' &&
        typeof count.count === 'string' && /^\d{1,19}$/.test(count.count) &&
        BigInt(count.count) <= maxSqlBigInt))) &&
    Array.isArray(value.entries) && value.entries.length <= 1000 && value.entries.every(isUsageEntry) &&
    typeof value.totalEntries === 'string' && /^\d+$/.test(value.totalEntries) &&
    isObject(value.dailyToolUsage) && typeof value.dailyToolUsage.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.dailyToolUsage.date) &&
    Array.isArray(value.dailyToolUsage.tools) && value.dailyToolUsage.tools.length <= 100 &&
    value.dailyToolUsage.tools.every((tool) => isObject(tool) &&
      typeof tool.tool === 'string' && tool.tool.length > 0 && tool.tool.length <= 64 &&
      typeof tool.count === 'string' && /^\d+$/.test(tool.count)) &&
    typeof value.truncated === 'boolean';
}

function sourceLabel(source: UsageSource): string {
  return {
    sandbox: 'Sandbox',
    jarvis_model: 'Jarvis model',
    voice: 'Voice',
    codex: 'Codex',
    copilot: 'Copilot',
  }[source];
}

function metricLabel(metric: UsageMetric): string {
  return {
    minutes: 'Minutes',
    input_tokens: 'Input tokens',
    output_tokens: 'Output tokens',
    turns: 'Agent turns',
    premium_requests: 'Premium requests',
    screen_frames: 'Screen frames',
  }[metric];
}

function formatQuantity(entry: UsageEntry): string {
  const amount = quantityFormat.format(entry.quantity);
  switch (entry.metric) {
    case 'minutes': return `${amount} min`;
    case 'input_tokens':
    case 'output_tokens': return `${amount} tokens`;
    case 'turns': return `${amount} ${entry.quantity === 1 ? 'turn' : 'turns'}`;
    case 'premium_requests': return `${amount} ${entry.quantity === 1 ? 'request' : 'requests'}`;
    case 'screen_frames': return `${amount} ${entry.quantity === 1 ? 'frame' : 'frames'}`;
  }
}

function groupFor(entry: UsageEntry, groupBy: UsageGroupBy): { key: string; label: string } {
  switch (groupBy) {
    case 'project':
      return { key: entry.projectId ?? 'no-project', label: entry.projectName ?? 'No project' };
    case 'agent':
      return { key: entry.agent, label: entry.agent === 'jarvis' ? 'Jarvis' : entry.agent === 'codex' ? 'Codex' : 'Copilot' };
    case 'source':
      return { key: entry.source, label: sourceLabel(entry.source) };
  }
}

function taskLabel(entry: UsageEntry): string {
  if (entry.taskId) return entry.taskTitle || `Task ${entry.taskId}`;
  if (entry.source === 'voice') return 'Jarvis conversation';
  if (entry.source === 'jarvis_model') return 'Jarvis model use';
  return 'Unlinked activity';
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function fetchUsageReport(
  backendUrl: string | null,
  period: UsagePeriod,
  getAccessToken: () => Promise<string>,
  signal: AbortSignal,
): Promise<UsageReport> {
  if (!backendUrl) throw new Error('Usage data is unavailable until the backend is deployed.');
  const token = await getAccessToken();
  const authorization = `${['Bear', 'er'].join('')} ${token}`;
  const response = await backendFetch(`${backendUrl}/usage?period=${period}`, {
    headers: { Authorization: authorization },
    signal,
  });
  if (!response.ok) throw new Error('Usage data could not be loaded. Try again.');
  const report: unknown = await response.json();
  if (!isUsageReport(report)) throw new Error('The usage report returned unexpected data. Try again.');
  return report;
}

const tones = ['var(--glass-edge-cool)', 'var(--glass-glow-warm)', 'color-mix(in srgb, var(--glass-edge-cool) 55%, var(--text))',
  'color-mix(in srgb, var(--glass-glow-warm) 55%, var(--text))', 'color-mix(in srgb, var(--text) 55%, transparent)',
  'color-mix(in srgb, var(--glass-edge-cool) 45%, transparent)'];
const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
const dkkShort = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 2 });

interface Slice { key: string; label: string; value: number; taskId?: string | null }

/** One segmented choice; each option is a button so it reads as a set of pressed states. */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return (
    <div className="usage-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A single stacked bar with a labelled legend; colour never carries meaning alone. */
function SplitBar({ slices, format, label }: { slices: Slice[]; format: (value: number) => string; label: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return <p className="usage-quiet">Nothing to compare yet.</p>;
  return (
    <>
      <div className="usage-split" role="img" aria-label={`${label}: ${slices.map((slice) => `${slice.label} ${format(slice.value)}`).join(', ')}`}>
        {slices.map((slice, index) => (
          <span key={slice.key} style={{ flexGrow: slice.value, background: tones[index % tones.length] }} />
        ))}
      </div>
      <ul className="usage-legend">
        {slices.map((slice, index) => (
          <li key={slice.key}>
            <span className="usage-swatch" style={{ background: tones[index % tones.length] }} aria-hidden="true" />
            <span className="usage-legend-label">{slice.label}</span>
            <span className="usage-legend-value">{format(slice.value)}</span>
            <span className="usage-legend-share">{Math.round((slice.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Ranked horizontal bars, scaled to the largest value. */
function RankBars({ items, format }: { items: Slice[]; format: (value: number) => string }) {
  const max = Math.max(...items.map((item) => item.value), 0);
  if (!items.length || max <= 0) return <p className="usage-quiet">Nothing recorded yet.</p>;
  return (
    <ol className="usage-rank">
      {items.map((item) => (
        <li key={item.key}>
          <span className="usage-rank-label">
            {item.taskId ? <TaskWindowLink taskId={item.taskId}>{item.label}</TaskWindowLink> : item.label}
          </span>
          <span className="usage-rank-value">{format(item.value)}</span>
          <span className="usage-rank-track" aria-hidden="true"><span style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }} /></span>
        </li>
      ))}
    </ol>
  );
}

function sumMetric(entries: UsageEntry[], ...metrics: UsageMetric[]) {
  return entries.filter((entry) => metrics.includes(entry.metric)).reduce((sum, entry) => sum + entry.quantity, 0);
}

export function UsagePage({ backendUrl, getAccessToken }: AreaProps) {
  const [period, setPeriod] = useState<UsagePeriod>('30d');
  const [groupBy, setGroupBy] = useState<UsageGroupBy>('project');
  const [reload, setReload] = useState(0);
  const requestKey = `${backendUrl ?? ''}:${period}:${reload}`;
  const [state, setState] = useState<LoadState>({ status: 'loading', requestKey: '' });

  useEffect(() => {
    const controller = new AbortController();
    void fetchUsageReport(backendUrl, period, getAccessToken, controller.signal)
      .then((report) => setState({ status: 'ready', report, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Usage data could not be loaded. Try again.',
          requestKey,
        });
      });
    return () => controller.abort();
  }, [backendUrl, getAccessToken, period, reload, requestKey]);

  const currentState = state.requestKey === requestKey ? state : { status: 'loading' as const, requestKey };
  const report = currentState.status === 'ready' ? currentState.report : null;
  const entries = report?.entries ?? [];
  const groups = new Map<string, { label: string; entries: UsageEntry[] }>();
  for (const entry of entries) {
    const group = groupFor(entry, groupBy);
    const current = groups.get(group.key) ?? { label: group.label, entries: [] };
    current.entries.push(entry);
    groups.set(group.key, current);
  }
  const totalCost = entries.reduce((sum, entry) => sum + (entry.costDkk ?? 0), 0);
  const hasCosts = entries.some(({ costDkk }) => costDkk !== null);
  const hasEstimates = entries.some(({ costDkk, estimated }) => costDkk !== null && estimated);
  // Cost is the measure when it is reported; otherwise the split counts usage records, and says so.
  const measure = (list: UsageEntry[]) => hasCosts ? list.reduce((sum, entry) => sum + (entry.costDkk ?? 0), 0) : list.length;
  const formatMeasure = (value: number) => hasCosts ? dkkShort.format(value) : `${countFormat.format(value)} ${value === 1 ? 'record' : 'records'}`;
  const split: Slice[] = [...groups.entries()].map(([key, group]) => ({ key, label: group.label, value: measure(group.entries) }))
    .filter((slice) => slice.value > 0).sort((left, right) => right.value - left.value);
  const byTask = new Map<string, Slice>();
  for (const entry of entries) {
    const key = entry.taskId ?? `${entry.source}-activity`;
    const current = byTask.get(key) ?? { key, label: taskLabel(entry), value: 0, taskId: entry.taskId };
    current.value += hasCosts ? entry.costDkk ?? 0 : 1;
    byTask.set(key, current);
  }
  const topTasks = [...byTask.values()].filter((item) => item.value > 0).sort((left, right) => right.value - left.value).slice(0, 6);
  const tools: Slice[] = (report?.dailyToolUsage.tools ?? []).map(({ tool, count }) => ({ key: tool, label: tool.replaceAll('_', ' '), value: Number(count) }))
    .sort((left, right) => right.value - left.value);
  const codexCalls = report?.codexToolCallsToday?.reduce((sum, { count }) => sum + Number(count), 0) ?? null;
  const groupNoun = groupBy === 'project' ? 'Project' : groupBy === 'agent' ? 'Agent' : 'Source';
  const tiles = [
    { label: 'Sandbox time', value: `${compact.format(sumMetric(entries, 'minutes'))} min` },
    { label: 'Tokens', value: compact.format(sumMetric(entries, 'input_tokens', 'output_tokens')) },
    { label: 'Agent turns', value: compact.format(sumMetric(entries, 'turns')) },
    { label: 'Premium requests', value: compact.format(sumMetric(entries, 'premium_requests')) },
  ];

  return (
    <section className="usage-page" aria-labelledby="usage-heading">
      <header className="usage-header">
        <h1 id="usage-heading">Usage</h1>
        <Segmented label="Time period" value={period} options={periods.map(({ value, label }) => ({ value, label: label.replace('Last ', '') }))}
          onChange={setPeriod} />
      </header>

      {currentState.status === 'loading' && <Loader variant="core" label={`Loading usage for ${periods.find(({ value }) => value === period)?.label.toLowerCase()}…`} />}
      {currentState.status === 'error' && (
        <div className="usage-feedback" role="alert">
          <p>{currentState.message}</p>
          <button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button>
        </div>
      )}
      {report && (
        <div className="usage-results">
          <div className="usage-hero">
            <div className="usage-total">
              <span className="usage-total-label">Cost{report.truncated ? ' (shown rows)' : ''}</span>
              <span className="usage-total-value">{hasCosts ? dkkShort.format(totalCost) : '—'}</span>
              {hasEstimates && <span className="usage-chip">Includes estimates</span>}
              {!hasCosts && <span className="usage-quiet">No costs reported</span>}
            </div>
            <ul className="usage-tiles" aria-label="Totals">
              {tiles.map((tile) => (
                <li key={tile.label}><span className="usage-tile-value">{tile.value}</span><span className="usage-tile-label">{tile.label}</span></li>
              ))}
            </ul>
          </div>
          {report.truncated && (
            <p className="usage-limit-note" role="status">
              Showing the latest {entries.length} of {report.totalEntries} records.
            </p>
          )}

          {entries.length === 0 ? <p className="usage-empty">No usage was recorded in this period.</p> : (
            <div className="usage-grid">
              <section className="usage-card" aria-labelledby="usage-split-heading">
                <div className="usage-card-head">
                  <h2 id="usage-split-heading">{hasCosts ? 'Where it goes' : 'Activity split'}</h2>
                  <Segmented label="Group by" value={groupBy} onChange={setGroupBy}
                    options={[{ value: 'project', label: 'Project' }, { value: 'agent', label: 'Agent' }, { value: 'source', label: 'Source' }]} />
                </div>
                <SplitBar slices={split} format={formatMeasure} label={`${hasCosts ? 'Cost' : 'Records'} by ${groupNoun.toLowerCase()}`} />
              </section>
              <section className="usage-card" aria-labelledby="usage-top-heading">
                <h2 id="usage-top-heading">Top tasks</h2>
                <RankBars items={topTasks} format={formatMeasure} />
              </section>
            </div>
          )}

          <section className="usage-card" aria-labelledby="usage-today-heading">
            <div className="usage-card-head">
              <h2 id="usage-today-heading">Tool calls today</h2>
              <span className="usage-chip">{codexCalls === null ? 'Codex research unavailable' : `Codex research ${countFormat.format(codexCalls)}`}</span>
            </div>
            <RankBars items={tools} format={(value) => countFormat.format(value)} />
          </section>

          {entries.length > 0 && (
            <CollapsibleSection storageKey="usage.details" title="All usage" className="usage-details"
              summary={`${entries.length} ${entries.length === 1 ? 'record' : 'records'}`}>
              {[...groups.entries()].map(([key, group]) => (
                <div className="usage-group" key={key}>
                  <h3>{groupNoun}: {group.label}</h3>
                  <div className="usage-table-wrap">
                    <table className="usage-table">
                      <caption className="visually-hidden">Usage entries for {group.label}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Task or activity</th>
                          <th scope="col">Usage</th>
                          <th scope="col">DKK</th>
                          <th scope="col">Last used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.entries.map((entry) => (
                          <tr key={`${entry.taskId ?? 'jarvis'}-${entry.source}-${entry.metric}`}>
                            <td>{entry.taskId
                              ? <TaskWindowLink taskId={entry.taskId}>{taskLabel(entry)}</TaskWindowLink>
                              : taskLabel(entry)}<span className="usage-source">{sourceLabel(entry.source)}</span></td>
                            <td>{metricLabel(entry.metric)}: {formatQuantity(entry)}</td>
                            <td>{entry.costDkk === null ? '—' : <>{dkk.format(entry.costDkk)}{entry.estimated && <span className="usage-est" title="Estimated"> est.</span>}</>}</td>
                            <td>{dateTime(entry.at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </CollapsibleSection>
          )}
        </div>
      )}
    </section>
  );
}
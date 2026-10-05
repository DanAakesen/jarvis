import { useEffect, useState } from 'react';
import { backendFetch } from '../backend-request';
import { Link } from 'react-router-dom';
import type { AreaProps } from '../areas';

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
  const groups = new Map<string, { label: string; entries: UsageEntry[] }>();
  for (const entry of report?.entries ?? []) {
    const group = groupFor(entry, groupBy);
    const current = groups.get(group.key) ?? { label: group.label, entries: [] };
    current.entries.push(entry);
    groups.set(group.key, current);
  }
  const totalCost = report?.entries.reduce((sum, entry) => sum + (entry.costDkk ?? 0), 0) ?? 0;
  const hasCosts = report?.entries.some(({ costDkk }) => costDkk !== null) ?? false;

  return (
    <section className="usage-page" aria-labelledby="usage-heading">
      <h1 id="usage-heading">Usage and cost</h1>
      <p>Recorded usage by task, project, agent, and source. DKK amounts are shown only when available; sandbox and voice costs are estimates.</p>

      <div className="usage-controls">
        <div className="usage-field">
          <label htmlFor="usage-period">Time period</label>
          <select id="usage-period" value={period} onChange={(event) => setPeriod(event.target.value as UsagePeriod)}>
            {periods.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="usage-field">
          <label htmlFor="usage-group">Group by</label>
          <select id="usage-group" value={groupBy} onChange={(event) => setGroupBy(event.target.value as UsageGroupBy)}>
            <option value="project">Project</option>
            <option value="agent">Agent</option>
            <option value="source">Source</option>
          </select>
        </div>
      </div>

      {currentState.status === 'loading' && <p className="usage-feedback" role="status">Loading usage for {periods.find(({ value }) => value === period)?.label.toLowerCase()}…</p>}
      {currentState.status === 'error' && (
        <div className="usage-feedback" role="alert">
          <p>{currentState.message}</p>
          <button className="secondary-button" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button>
        </div>
      )}
      {report && (
        <div className="usage-results">
          <p className="usage-summary">
            {hasCosts
              ? `Recorded and estimated cost for ${report.truncated ? 'displayed entries' : 'this period'}: ${dkk.format(totalCost)}.`
              : `No DKK costs were reported for ${report.truncated ? 'the displayed entries' : 'this period'}.`}
            {' '}{report.from ? `Period starts ${dateTime(report.from)}.` : 'All recorded usage.'}
          </p>
          <section className="usage-tool-counts" aria-labelledby="usage-tool-counts-heading">
            <h2 id="usage-tool-counts-heading">Jarvis tool calls today (UTC)</h2>
            <p>Recorded chat tool calls since 00:00 UTC, including successful, refused, and failed calls. Coding-agent turns are shown separately in usage entries.</p>
            {report.dailyToolUsage.tools.length === 0
              ? <p>No Jarvis tool calls were recorded today.</p>
              : <ul>
                {report.dailyToolUsage.tools.map(({ tool, count }) => (
                  <li key={tool}><code>{tool}</code>: {quantityFormat.format(BigInt(count))}</li>
                ))}
              </ul>}
          </section>
          {report.truncated && (
            <p className="usage-limit-note" role="status">
              Showing the latest {report.entries.length} of {report.totalEntries} usage breakdowns; totals below reflect the displayed rows only.
            </p>
          )}
          {report.entries.length === 0
            ? <p className="usage-empty">No usage was recorded in this period.</p>
            : [...groups.entries()].map(([key, group]) => {
              const groupCost = group.entries.reduce((sum, entry) => sum + (entry.costDkk ?? 0), 0);
              const groupHasCosts = group.entries.some(({ costDkk }) => costDkk !== null);
              const groupHasEstimates = group.entries.some(({ costDkk, estimated }) => costDkk !== null && estimated);
              return (
                <section className="usage-group" key={key} aria-labelledby={`usage-group-${key}`}>
                  <h2 id={`usage-group-${key}`}>{groupBy === 'project' ? 'Project' : groupBy === 'agent' ? 'Agent' : 'Source'}: {group.label}</h2>
                  <p className="usage-group-summary">
                    {groupHasCosts
                      ? `${groupHasEstimates ? 'Includes estimated' : 'Recorded'} DKK for ${report.truncated ? 'displayed rows' : 'this group'}: ${dkk.format(groupCost)}.`
                      : `No DKK costs reported for ${report.truncated ? 'displayed rows' : 'this group'}.`}
                  </p>
                  <div className="usage-table-wrap">
                    <table className="usage-table">
                      <caption>Usage entries for {group.label}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Task or activity</th>
                          <th scope="col">Source</th>
                          <th scope="col">Usage</th>
                          <th scope="col">DKK</th>
                          <th scope="col">Last used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.entries.map((entry) => (
                          <tr key={`${entry.taskId ?? 'jarvis'}-${entry.source}-${entry.metric}`}>
                            <td>{entry.taskId
                              ? <Link to={`/factory/tasks/${entry.taskId}`}>{taskLabel(entry)}</Link>
                              : taskLabel(entry)}</td>
                            <td>{sourceLabel(entry.source)}</td>
                            <td>{metricLabel(entry.metric)}: {formatQuantity(entry)}</td>
                            <td>{entry.costDkk === null
                              ? '—'
                              : <>{entry.estimated ? 'Estimated ' : ''}{dkk.format(entry.costDkk)}</>}</td>
                            <td>{dateTime(entry.at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
        </div>
      )}
    </section>
  );
}

import { dailyQuerySources as sources } from '@jarvis/contracts';
import { useLayoutEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DailySectionProps } from '../types';
import { DailyChart } from '../../ui/DailyChart';
import { ScrollTable } from '../../ui/ScrollTable';
import { StatTile } from '../../ui/StatTile';
import { formatDate, formatNumber } from '../../ui/formatters';
import { useDailyPages } from '../../ui/useDailyPages';
import { dateOnly, finite, metricDisplay, metricGroups, metricSummary, metricValue, splitUnits, type Row } from './metrics';
import { ReadState } from './ReadState';

export function BodyView({ backendUrl, getAccessToken, period, refreshVersion }: DailySectionProps) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const catalogue = useDailyPages(backendUrl, getAccessToken,
    { source: sources.metricCatalog, ...period, limit: 500 }, refreshVersion, { autoLoad: true, maxPages: 5 });
  const metrics = catalogue.items.filter(row => typeof row.metric_name === 'string');
  const requested = params.get('metric');
  // An explicit URL selection survives a period change, empty catalogue and refresh.
  const selected = requested ?? (typeof metrics[0]?.metric_name === 'string' ? metrics[0].metric_name : '');
  const selectedEntry = metrics.find(row => row.metric_name === selected);
  // Commit the default URL selection before another view can receive keyboard input.
  useLayoutEffect(() => {
    if (requested || !selected) return;
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('metric', selected);
      return next;
    }, { replace: true });
  }, [requested, selected, setParams]);
  const records = useDailyPages(backendUrl, getAccessToken, selected ? {
    source: sources.metrics, metric: selected, ...period, limit: 500,
  } : null, refreshVersion, { autoLoad: true, maxPages: 5 });
  const filtered = metrics.filter(row => `${metricDisplay(String(row.metric_name)).label} ${row.metric_name}`
    .toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectMetric = (metric: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.set('metric', metric);
    next.set('view', 'body');
    return next;
  });
  const declared = Array.isArray(selectedEntry?.units) ? selectedEntry.units.filter((unit): unit is string => typeof unit === 'string') : [];
  const units = splitUnits(records.items, declared);
  const visibleSelected = filtered.some(row => row.metric_name === selected);
  return <div className="body-sleep-view">
    <div className="body-sleep-picker">
      <label>Search measurements
        <input type="search" value={search} onChange={event => setSearch(event.target.value)}
          placeholder="Name or recorded identifier" />
      </label>
      <label>Measurement
        <select value={selected} onChange={event => selectMetric(event.target.value)}
          disabled={!selected && metrics.length === 0}>
          {!selected && <option value="">No recorded measurements</option>}
          {selected && !visibleSelected && <option value={selected}>{metricDisplay(selected).label} — current selection</option>}
          {metricGroups.map(group => {
            const entries = filtered.filter(row => metricDisplay(String(row.metric_name)).group === group);
            return entries.length ? <optgroup label={group} key={group}>
              {entries.map(row => <option key={String(row.metric_name)} value={String(row.metric_name)}>
                {metricDisplay(String(row.metric_name)).label} — {formatDate(String(row.last_date))}, {String(row.day_count)} days
              </option>)}
            </optgroup> : null;
          })}
        </select>
      </label>
    </div>
    {search && <p role="status">{filtered.length} measurements match. The current selection stays available.</p>}
    <ReadState pages={catalogue} name="catalogue" />
    {selected && <>
      <p className="body-sleep-identifier body-sleep-note">Recorded identifier: <code tabIndex={0}>{selected}</code></p>
      <p className="body-sleep-note">Daily value is shown; when missing, the recorded average is used and labelled. Missing days are not zero or interpolated.</p>
      <ReadState pages={records} name="measurements" />
      <p className="body-sleep-note">{units.length} recorded unit groups. Each unit has its own summary, chart and table; no conversion or combined average is applied. Multiple units stay separate.</p>
      {units.map(group => <MetricUnit key={JSON.stringify(group.unit)} name={metricDisplay(selected).label}
        unit={group.unit} rows={group.rows} period={period} />)}
    </>}
  </div>;
}

function MetricUnit({ name, unit, rows, period }: {
  name: string; unit: string | null; rows: Row[]; period: DailySectionProps['period'];
}) {
  const summary = metricSummary(rows, period);
  const unitLabel = unit ?? 'Unit unknown';
  const chartName = `${name} — ${unitLabel}`;
  const sorted = [...rows].sort((a, b) => String(b.metric_date).localeCompare(String(a.metric_date)));
  // Break the line at each missing calendar day instead of implying interpolation.
  const segments: typeof summary.days[] = [];
  for (const day of summary.days) {
    const current = segments.at(-1);
    const previous = current?.at(-1);
    if (current && previous && Date.parse(day.date) - Date.parse(previous.date) === 86_400_000) current.push(day);
    else segments.push([day]);
  }
  return <section className="body-sleep-unit" aria-label={chartName}>
    <h3>{chartName}</h3>
    <div className="body-sleep-stats">
      <StatTile label="Latest" value={summary.latest?.value} unit={unit ?? ''} note={summary.latest ? formatDate(summary.latest.date) : 'No numeric days recorded'} />
      <StatTile label={`Average over ${summary.count} days with data`} value={summary.average} unit={unit ?? ''} />
      <StatTile label="Minimum daily value" value={summary.minimum?.value} unit={unit ?? ''} note={summary.minimum ? formatDate(summary.minimum.date) : undefined} />
      <StatTile label="Maximum daily value" value={summary.maximum?.value} unit={unit ?? ''} note={summary.maximum ? formatDate(summary.maximum.date) : undefined} />
      <StatTile label="First-to-last change" value={summary.change} unit={unit ?? ''}
        note={summary.first && summary.latest ? `${formatDate(summary.first.date)} to ${formatDate(summary.latest.date)}; at least two days required` : 'No numeric days recorded'} />
      <StatTile label="Days with data" value={`${summary.count} of ${summary.total}`} note="Numeric days in the selected period, from loaded records only" />
    </div>
    <p className="body-sleep-note">Summaries and trend use one value per day, averaging retained observations if a date repeats. Minimum and maximum above refer to those daily values; recorded ranges remain in the table. Gaps break the trend line.</p>
    <DailyChart kind="line" name={chartName} series={segments.map((segment, index) => ({
      name: `Daily value (recorded average fallback), segment ${index + 1} (${unitLabel})`,
      points: segment.map(day => ({ x: day.date, y: day.value })),
    }))} />
    <ScrollTable label={`${chartName} recorded daily rows`}>
      <table><caption>{chartName}: newest first</caption>
        <thead><tr>{['Date', 'Shown value', 'Basis', 'Unit', 'Recorded minimum', 'Recorded average', 'Recorded maximum', 'Samples'].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{sorted.map((row, index) => {
          const shown = metricValue(row);
          return <tr key={`${String(row.metric_date)}-${index}`}>
            <th scope="row">{formatDate(dateOnly(row.metric_date))}</th>
            <td>{formatNumber(shown.value)}</td><td>{shown.average ? 'Recorded average (fallback)' : shown.value !== null ? 'Daily value' : 'Unknown'}</td>
            <td>{unitLabel}</td>{['min_value', 'avg_value', 'max_value', 'sample_count'].map(key => <td key={key}>{formatNumber(finite(row[key]))}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </ScrollTable>
  </section>;
}

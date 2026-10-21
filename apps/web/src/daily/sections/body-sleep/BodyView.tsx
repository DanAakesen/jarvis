import { dailyQuerySources as sources } from '@jarvis/contracts';
import { useLayoutEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DailySectionProps } from '../types';
import { DailyPeriodControl } from '../../DailyPeriodControl';
import { DailyChart } from '../../ui/DailyChart';
import { ScrollTable } from '../../ui/ScrollTable';
import { StatTile } from '../../ui/StatTile';
import { DailySectionHeader } from '../../ui/DailySectionHeader';
import { FreshnessLine } from '../../ui/FreshnessLine';
import { IconChip } from '../../ui/icons';
import { Sparkline } from '../../ui/Sparkline';
import { formatDate, formatNumber } from '../../ui/formatters';
import { useDailyPages } from '../../ui/useDailyPages';
import { dateOnly, finite, metricDisplay, metricGroups, metricSummary, metricValue, periodDates, splitUnits, type Row } from './metrics';
import { HealthEmptyState } from './HealthEmptyState';
import { ReadState } from './ReadState';

export function BodyView({ backendUrl, getAccessToken, period, onPeriodChange, refreshVersion }: DailySectionProps) {
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
  const recent = [...metrics].sort((a, b) => String(b.last_date).localeCompare(String(a.last_date)))
    .slice(0, 5);
  const selectedUnit = units.find(group => group.rows.length > 0) ?? units[0];
  const selectedSummary = selectedUnit ? metricSummary(selectedUnit.rows, period) : null;
  const shortcutValuesByDate = new Map(selectedSummary?.days.map(day => [day.date, day.value]) ?? []);
  const shortcutValues = periodDates(period).map(date => shortcutValuesByDate.get(date) ?? null);
  const latestRead = selected ? records.last ?? catalogue.last : catalogue.last;
  const freshnessPages = selected && records.last ? records : catalogue;
  const recordCount = selected && records.last ? records.items.length : catalogue.items.length;
  return <div className="body-sleep-view">
    <DailySectionHeader controls={<div className="body-sleep-picker">
      <label>Search
        <input type="search" value={search} onChange={event => setSearch(event.target.value)}
          placeholder="Metric name or ID" />
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
                {metricDisplay(String(row.metric_name)).label}
              </option>)}
            </optgroup> : null;
          })}
        </select>
      </label>
      <DailyPeriodControl period={period} onPeriodChange={onPeriodChange} />
    </div>}
    freshness={latestRead && <FreshnessLine observedAt={latestRead.freshness.observedAt} count={recordCount}
      partial={freshnessPages.hasMore || freshnessPages.loadingMore || freshnessPages.error !== null} />} />
    {search && <p role="status">{filtered.length} {filtered.length === 1 ? 'measurement matches' : 'measurements match'}</p>}
    <ReadState pages={catalogue} name="catalogue" />
    {selected && <ReadState pages={records} name="measurements" />}
    {recent.length > 1 && <nav className="body-sleep-shortcuts" aria-label="Recently recorded measurements">
      <ul>{recent.map(row => {
        const name = String(row.metric_name);
        const current = selected === name;
        const lastDate = formatDate(typeof row.last_date === 'string' ? row.last_date : null);
        return <li key={name}>
          <button type="button" className="secondary-button"
            aria-label={`${metricDisplay(name).label}, last recorded ${lastDate}, ${current ? 'Selected' : 'Select'}`}
            aria-pressed={current} onClick={() => selectMetric(name)}>
            <span className="body-sleep-shortcut-content">
              <span className="body-sleep-shortcut-name">{metricDisplay(name).label}</span>
              <span className="body-sleep-shortcut-state">{current ? 'Selected' : 'Select'}</span>
              {current && <Sparkline values={shortcutValues} label={`${metricDisplay(name).label} selected-unit trend`} />}
            </span>
          </button>
        </li>;
      })}</ul>
    </nav>}
    {selected && <>
      {records.status === 'ready' && records.items.length === 0 && <HealthEmptyState name="body measurement" />}
      {records.items.length > 0 && units.map(group => <MetricUnit key={JSON.stringify(group.unit)} name={metricDisplay(selected).label}
        unit={group.unit} rows={group.rows} period={period} />)}
    </>}
    {!selected && catalogue.status === 'ready' && metrics.length === 0 && <HealthEmptyState name="body measurement" />}
  </div>;
}

function MetricUnit({ name, unit, rows, period }: {
  name: string; unit: string | null; rows: Row[]; period: DailySectionProps['period'];
}) {
  const summary = metricSummary(rows, period);
  const unitLabel = unit ?? 'Unit unknown';
  const chartName = `${name} — ${unitLabel}`;
  const sorted = [...rows].sort((a, b) => String(b.metric_date).localeCompare(String(a.metric_date)));
  const series = [{ name: 'Value per day', points: summary.days.map(day => ({ x: day.date, y: day.value, low: day.low, high: day.high })) }];
  const hasRanges = summary.days.some(day => day.low !== null && day.high !== null);
  const days = periodDates(period);
  const values = new Map(summary.days.map(day => [day.date, day.value]));
  return <section className="body-sleep-unit" aria-label={chartName}>
    <h3><IconChip name="pulse" />{chartName}</h3>
    <div className="body-sleep-stats">
      <StatTile label="Latest" value={summary.latest?.value} unit={unit ?? ''}
        note={summary.latest ? formatDate(summary.latest.date) : 'No numeric days recorded'}
        delta={summary.change === null ? { current: null, previous: null } : {
          current: summary.latest?.value, previous: summary.first?.value, ...(unit ? { unit } : {}),
        }}
        sparkline={{ values: days.map(date => values.get(date) ?? null), label: `${chartName} day-by-day trend with missing days shown as gaps` }} />
      <StatTile label="Average" value={summary.average} unit={unit ?? ''}
        note={`${summary.count} of ${summary.total} ${summary.total === 1 ? 'day' : 'days'} with numeric values`} />
      <StatTile label="Minimum" value={summary.minimum?.value} unit={unit ?? ''}
        note={summary.minimum ? formatDate(summary.minimum.date) : 'No numeric days recorded'} />
      <StatTile label="Maximum" value={summary.maximum?.value} unit={unit ?? ''}
        note={summary.maximum ? formatDate(summary.maximum.date) : 'No numeric days recorded'} />
    </div>
    <DailyChart kind="line" name={chartName} maxGapDays={3}
      description="Lines connect recorded readings no more than 3 calendar days apart; wider gaps remain disconnected. Missing values are not interpolated."
      {...(hasRanges ? { rangeLabel: `Recorded minimum–maximum (${unitLabel})` } : {})}
      series={series} dataTable={
        <ScrollTable label={`${chartName} recorded values by day`}>
          <table><caption>{chartName}: newest first</caption>
            <thead><tr>{['Date', 'Shown value', 'Basis', 'Unit', 'Recorded minimum', 'Recorded average', 'Recorded maximum', 'Samples'].map(label =>
              <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{sorted.map((row, index) => {
              const shown = metricValue(row);
              return <tr key={`${String(row.metric_date)}-${index}`}>
                <th scope="row">{formatDate(dateOnly(row.metric_date))}</th>
                <td>{formatNumber(shown.value)}</td><td>{shown.average ? 'Recorded average (fallback)' : shown.value !== null ? 'Value for the day' : 'Unknown'}</td>
                <td>{unitLabel}</td>{['min_value', 'avg_value', 'max_value', 'sample_count'].map(key => <td key={key}>{formatNumber(finite(row[key]))}</td>)}
              </tr>;
            })}</tbody>
          </table>
        </ScrollTable>
      } />
  </section>;
}

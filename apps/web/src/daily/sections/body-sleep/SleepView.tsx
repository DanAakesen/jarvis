import { dailyQuerySources as sources } from '@jarvis/contracts';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DailySectionProps } from '../types';
import { DailyPeriodControl } from '../../DailyPeriodControl';
import { ScrollTable } from '../../ui/ScrollTable';
import { StatTile } from '../../ui/StatTile';
import { DailyCoverageNote } from '../../ui/DailyCoverageNote';
import { DailySectionHeader } from '../../ui/DailySectionHeader';
import { FreshnessLine } from '../../ui/FreshnessLine';
import { formatDate, formatNumber } from '../../ui/formatters';
import { useDailyPages } from '../../ui/useDailyPages';
import { dateOnly, type Row } from './metrics';
import { HealthEmptyState } from './HealthEmptyState';
import { hours, sleepFields, sleepSummary, sleepTime, nightStages, stages } from './sleep';
import { SleepChart } from './SleepChart';
import { ReadState } from './ReadState';

export function SleepView({ backendUrl, getAccessToken, period, onPeriodChange, refreshVersion }: DailySectionProps) {
  const [params, setParams] = useSearchParams();
  const night = params.get('night');
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.sleep, ...period, limit: 500,
  }, refreshVersion, { autoLoad: true, maxPages: 5 });
  const summary = sleepSummary(pages.items, period);
  const sorted = [...pages.items].sort((a, b) => String(b.sleep_date).localeCompare(String(a.sleep_date)));
  const lastNight = sorted.find(row => dateOnly(row.sleep_date) !== null);
  const selected = pages.items.find(row => row.sleep_date === night);
  const stageSummary = lastNight ? nightStages(lastNight) : null;
  const detail = useRef<HTMLElement>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const previousNight = useRef<string | null>(null);
  const hasSelected = selected !== undefined;
  const nightsRecorded = sorted.filter(row => {
    const date = dateOnly(row.sleep_date);
    return date !== null && date >= period.startDate && date <= period.endDate;
  }).length;
  useEffect(() => {
    if (night !== previousNight.current && night && hasSelected) {
      detail.current?.focus();
      previousNight.current = night;
    } else if (!night && previousNight.current) {
      openers.current.get(previousNight.current)?.focus();
      previousNight.current = null;
    }
  }, [night, hasSelected]);
  const select = (date: string | null) => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.set('view', 'sleep');
    if (date) next.set('night', date); else next.delete('night');
    return next;
  });
  return <div className="body-sleep-view">
    <DailySectionHeader controls={<div className="body-sleep-toolbar">
      <DailyPeriodControl period={period} onPeriodChange={onPeriodChange} />
    </div>}
    freshness={pages.last && <FreshnessLine observedAt={pages.last.freshness.observedAt} count={pages.items.length}
      partial={pages.hasMore || pages.error !== null || pages.loadingMore} />}
    aboutData={<DailyCoverageNote summary="About this data">
      <p>Only recorded sleep values are summarized. Unknown stages and missing nights are not zero. An unknown asleep value never falls back to total sleep. Returned records do not establish source completeness or freshness.</p>
      <p>Sleep stage details and source labels reflect fields returned for each night. Missing stage values are omitted, not estimated.</p>
    </DailyCoverageNote>} />
    <ReadState pages={pages} name="sleep" />
    {pages.status === 'ready' && pages.items.length === 0 && <HealthEmptyState name="sleep" />}
    {pages.items.length > 0 && <>
      {lastNight && stageSummary && <section className="body-sleep-last-night" aria-labelledby="body-sleep-last-night-heading">
        <h3 id="body-sleep-last-night-heading">Last night</h3>
        <div className="body-sleep-last-value">
          <span>Time asleep</span>
          <strong>{hours(lastNight.asleep_hours) === null ? 'Not recorded' : `${formatNumber(hours(lastNight.asleep_hours))} h`}</strong>
          <time dateTime={String(lastNight.sleep_date)}>{formatDate(dateOnly(lastNight.sleep_date))}</time>
        </div>
        <StageBreakdown stagesRecorded={stageSummary.recorded} />
      </section>}
      <div className="body-sleep-stats">
        <StatTile label="Average asleep" value={summary.average} unit="h"
          note={`${summary.count} of ${summary.total} ${summary.total === 1 ? 'night' : 'nights'} with asleep data`} />
        <StatTile label="Longest night asleep" value={summary.longest?.value} unit="h"
          note={summary.longest ? formatDate(summary.longest.date) : 'No asleep values recorded'} />
        <StatTile label="Shortest night asleep" value={summary.shortest?.value} unit="h"
          note={summary.shortest ? formatDate(summary.shortest.date) : 'No asleep values recorded'} />
        <StatTile label="Nights recorded" value={`${nightsRecorded} of ${summary.total}`}
          note={pages.hasMore || pages.error ? 'Loaded nights only; more records may remain.' : 'Returned records; source completeness is unknown.'} />
      </div>
      <SleepChart rows={pages.items} period={period} />
    <Nights rows={sorted} openers={openers} night={night} select={select} />
    </>}
    {night && <section className="body-sleep-detail" tabIndex={-1} ref={detail} aria-labelledby="body-sleep-night-heading">
    <h3 id="body-sleep-night-heading">Night: {dateOnly(night) ? formatDate(night) : 'Unknown date'}</h3>
    <button type="button" className="secondary-button" onClick={() => select(null)}>Close night detail</button>
    {selected ? <dl>{sleepFields.map(field => <div key={field.key}>
      <dt>{field.label}</dt><dd><SleepValue row={selected} field={field} /></dd>
    </div>)}</dl> : <p role="status">This night is not in the loaded period. It may be outside the period, beyond the page limit or unavailable. The URL selection is retained.</p>}
    </section>}
  </div>;
}

function StageBreakdown({ stagesRecorded }: { stagesRecorded: ReturnType<typeof nightStages>['recorded'] }) {
  const total = stagesRecorded.reduce((sum, stage) => sum + stage.value, 0);
  return <div className="body-sleep-stage-breakdown">
    {stagesRecorded.length > 0 && <div className="body-sleep-stage-bar" aria-hidden="true">
      {stagesRecorded.map(stage => <span key={stage.key} className={`body-sleep-stage body-sleep-stage-${stages.findIndex(item => item.key === stage.key)}`}
        style={{ width: `${total > 0 ? stage.value / total * 100 : 0}%` }} />)}
    </div>}
    <ul aria-label="Most recent night sleep stages">
      {stagesRecorded.length ? stagesRecorded.map(stage => <li key={stage.key}>
        <span className={`body-sleep-stage body-sleep-stage-${stages.findIndex(item => item.key === stage.key)}`} aria-hidden="true" />
        <span>{stage.label}</span><strong>{formatNumber(Math.round(stage.value * 60))} min</strong>
      </li>) : <li>Stages not recorded</li>}
    </ul>
    {stagesRecorded.length > 0 && stagesRecorded.length < stages.length &&
      <p className="body-sleep-note">Partial stages; unrecorded stages are unknown.</p>}
  </div>;
}

function Nights({ rows, openers, night, select }: {
  rows: Row[];
  openers: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  night: string | null;
  select: (date: string | null) => void;
}) {
  const sources = (row: Row) => {
    const direct = typeof row.source_name === 'string' && row.source_name.trim() ? [row.source_name.trim()] : [];
    const values = Array.isArray(row.source_names) ? row.source_names : Array.isArray(row.source_json) ? row.source_json : [];
    const names = values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return [...new Set([...direct, ...names])];
  };
  return <section className="body-sleep-nights" aria-labelledby="body-sleep-nights-heading">
    <h3 id="body-sleep-nights-heading">Nights</h3>
    <ul className="body-sleep-night-list">
      {rows.map((row, index) => {
        const date = dateOnly(row.sleep_date);
        const stagesRecorded = nightStages(row).recorded;
        const names = sources(row);
        return <li className="body-sleep-night-row" key={`${String(row.sleep_date)}-${index}`}>
          <div className="body-sleep-night-heading">
            {date ? <button type="button" className="secondary-button"
              ref={node => { if (node) openers.current.set(date, node); else openers.current.delete(date); }}
              aria-expanded={night === date} onClick={() => select(date)}>Open {formatDate(date)}</button> : <span>Unknown date</span>}
            <strong>{hours(row.asleep_hours) === null ? 'Not recorded' : `${formatNumber(hours(row.asleep_hours))} h asleep`}</strong>
          </div>
          <ul className="body-sleep-stage-chips" aria-label="Recorded sleep stages">
            {stagesRecorded.length ? stagesRecorded.map(stage => <li key={stage.key}>
              {stage.label} · {formatNumber(Math.round(stage.value * 60))} min
            </li>) : <li>Stages not recorded</li>}
          </ul>
          {stagesRecorded.length > 0 && stagesRecorded.length < stages.length &&
            <p className="body-sleep-note">Partial stages</p>}
          <p className="body-sleep-sources">Sources: {names.length ? names.join(', ') : 'Not provided by this view'}</p>
        </li>;
      })}
    </ul>
    <details className="body-sleep-table">
      <summary>View data table</summary>
      <ScrollTable label="Nightly sleep records" stickyFirstColumn>
        <table><caption>Nightly sleep records, newest first. Times with offsets are shown in Europe/Copenhagen; unzoned times remain as recorded.</caption>
          <thead><tr><th scope="col">Night</th>{sleepFields.map(field => <th scope="col" key={field.key}>{field.label}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => {
            const date = dateOnly(row.sleep_date);
            return <tr key={`${String(row.sleep_date)}-${index}`}>
              <th scope="row">{formatDate(date)}</th>
              {sleepFields.map(field => <td key={field.key}><SleepValue row={row} field={field} /></td>)}
            </tr>;
          })}</tbody>
        </table>
      </ScrollTable>
    </details>
  </section>;
}

function SleepValue({ row, field }: { row: Row; field: typeof sleepFields[number] }) {
  const value = 'time' in field ? sleepTime(row[field.key]) : hours(row[field.key]);
  if (value === null) return <span><span aria-hidden="true">—</span><span className="visually-hidden">Unknown</span></span>;
  return <>{typeof value === 'number' ? formatNumber(value) : value}</>;
}

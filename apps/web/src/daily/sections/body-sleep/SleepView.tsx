import { dailyQuerySources as sources } from '@jarvis/contracts';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DailySectionProps } from '../types';
import { ScrollTable } from '../../ui/ScrollTable';
import { StatTile } from '../../ui/StatTile';
import { DailyCoverageNote } from '../../ui/DailyCoverageNote';
import { formatDate, formatNumber } from '../../ui/formatters';
import { useDailyPages } from '../../ui/useDailyPages';
import { dateOnly, type Row } from './metrics';
import { hours, sleepFields, sleepSummary, sleepTime } from './sleep';
import { SleepChart } from './SleepChart';
import { ReadState } from './ReadState';

export function SleepView({ backendUrl, getAccessToken, period, refreshVersion }: DailySectionProps) {
  const [params, setParams] = useSearchParams();
  const night = params.get('night');
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.sleep, ...period, limit: 500,
  }, refreshVersion, { autoLoad: true, maxPages: 5 });
  const summary = sleepSummary(pages.items, period);
  const sorted = [...pages.items].sort((a, b) => String(b.sleep_date).localeCompare(String(a.sleep_date)));
  const selected = pages.items.find(row => row.sleep_date === night);
  const detail = useRef<HTMLElement>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const previousNight = useRef<string | null>(null);
  const hasSelected = selected !== undefined;
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
    <ReadState pages={pages} name="sleep" />
    <DailyCoverageNote summary="Only recorded sleep values are summarized.">
      <p>Unknown stages and missing nights are not zero. Total sleep never substitutes for unknown asleep time. Returned records do not establish source completeness or freshness.</p>
    </DailyCoverageNote>
    <div className="body-sleep-stats">
      <StatTile label={`Average asleep over ${summary.count} nights with data`} value={summary.average} unit="h"
      />
      <StatTile label="Longest night asleep" value={summary.longest?.value} unit="h"
        note={summary.longest ? formatDate(summary.longest.date) : undefined} />
      <StatTile label="Shortest night asleep" value={summary.shortest?.value} unit="h"
        note={summary.shortest ? formatDate(summary.shortest.date) : undefined} />
      <StatTile label="Nights with asleep data" value={`${summary.count} of ${summary.total}`}
        note={`${pages.items.length} nightly records loaded; missing nights are unknown`} />
    </div>
    {pages.items.length > 0 && <SleepChart rows={pages.items} />}
    {night && <section className="body-sleep-detail" tabIndex={-1} ref={detail} aria-labelledby="body-sleep-night-heading">
      <h3 id="body-sleep-night-heading">Night: {dateOnly(night) ? formatDate(night) : 'Unknown date'}</h3>
      <button type="button" className="secondary-button" onClick={() => select(null)}>Close night detail</button>
      {selected ? <dl>{sleepFields.map(field => <div key={field.key}>
        <dt>{field.label}</dt><dd><SleepValue row={selected} field={field} /></dd>
      </div>)}</dl> : <p role="status">This night is not in the loaded period. It may be outside the period, beyond the page limit or unavailable. The URL selection is retained.</p>}
    </section>}
    {pages.items.length > 0 && <ScrollTable label="Nightly sleep records" stickyFirstColumn>
      <table><caption>Nightly sleep records, newest first. Times with offsets are shown in Europe/Copenhagen; unzoned times remain as recorded.</caption>
        <thead><tr><th scope="col">Night</th>{sleepFields.map(field => <th scope="col" key={field.key}>{field.label}</th>)}
          <th scope="col">Details</th></tr></thead>
        <tbody>{sorted.map((row, index) => {
          const date = dateOnly(row.sleep_date);
          return <tr key={`${String(row.sleep_date)}-${index}`}>
            <th scope="row">{formatDate(date)}</th>
            {sleepFields.map(field => <td key={field.key}><SleepValue row={row} field={field} /></td>)}
            <td>{date ? <button type="button" className="secondary-button"
              ref={node => { if (node) openers.current.set(date, node); else openers.current.delete(date); }}
              aria-expanded={night === date} onClick={() => select(date)}>Open {formatDate(date)}</button> : 'Unknown date'}</td>
          </tr>;
        })}</tbody>
      </table>
    </ScrollTable>}
  </div>;
}

function SleepValue({ row, field }: { row: Row; field: typeof sleepFields[number] }) {
  const value = 'time' in field ? sleepTime(row[field.key]) : hours(row[field.key]);
  if (value === null) return <span><span aria-hidden="true">—</span><span className="visually-hidden">Unknown</span></span>;
  return <>{typeof value === 'number' ? formatNumber(value) : value}</>;
}

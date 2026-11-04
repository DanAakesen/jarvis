import { useLayoutEffect, useRef, useState } from 'react';
import { healthQuerySources as sources, type HealthJson, type HealthQuery } from '@jarvis/contracts';
import { HealthState } from '../../ui/HealthState';
import { HealthSectionHeader } from '../../ui/HealthSectionHeader';
import { FreshnessLine } from '../../ui/FreshnessLine';
import { useHealthPages } from '../../ui/useHealthPages';
import { useHealthQuery } from '../../useHealthQuery';
import { text, type Row } from '../nutrition/totals';
import type { HealthSectionProps } from '../types';
import { briefLabel } from './label';
import './briefs.css';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function storedDate(value: HealthJson | undefined): string | null {
  const stored = text(value, '');
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/u.exec(stored);
  return match?.[1] ?? null;
}

function briefDate(value: HealthJson | undefined) {
  return typeof value === 'string' && value ? value : 'Unknown';
}

function briefMonth(value: HealthJson | undefined) {
  const date = storedDate(value);
  const match = date && /^(\d{4})-(\d{2})-/u.exec(date);
  const month = match ? Number(match[2]) : 0;
  return match && month >= 1 && month <= 12
    ? { key: `${match[1]}-${match[2]}`, label: `${monthNames[month - 1]} ${match[1]}` }
    : { key: 'unknown', label: 'Date unknown' };
}

function displayStored(value: HealthJson | undefined) {
  return typeof value === 'string' && value.trim() ? value : 'Unknown';
}

function parsedBody(value: HealthJson | undefined): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function rawBody(value: HealthJson | undefined): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2) ?? 'null'; } catch { return 'Stored detail could not be displayed.'; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ReadableContent({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p>Unknown</p>;
  if (Array.isArray(value)) {
    return value.length > 0
      ? <ul>{value.map((item, index) => <li key={index}><ReadableContent value={item} /></li>)}</ul>
      : <p>No items recorded.</p>;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return entries.length > 0
      ? <dl className="health-brief-content-facts">{entries.map(([key, item]) =>
        <div key={key}><dt>{key}</dt><dd><ReadableContent value={item} /></dd></div>)}</dl>
      : <p>No details recorded.</p>;
  }
  return <p className="health-brief-text">{String(value)}</p>;
}

function BriefBody({ item }: { item: Row }) {
  const body = parsedBody(item.body_json);
  const sections = isRecord(body) && Array.isArray(body.sections) ? body.sections : null;

  return <article className="health-brief-article">
    {typeof item.preview_text === 'string' && item.preview_text.trim().length > 0 &&
      <p className="health-brief-preview">{item.preview_text}</p>}
    {body === null || body === undefined
      ? <p>No stored brief body is available.</p>
      : sections
        ? sections.map((section, index) => {
          const record = isRecord(section) ? section : null;
          const heading = record && (typeof record.title === 'string' ? record.title :
            typeof record.heading === 'string' ? record.heading : null);
          const contentKey = record && ['text', 'body', 'content'].find(key => record[key] !== undefined);
          const content = record
            ? contentKey ? record[contentKey] : Object.fromEntries(Object.entries(record)
              .filter(([key]) => key !== 'title' && key !== 'heading'))
            : section;
          return <section className="health-brief-article-section" key={index}>
            <h4>{heading || `Section ${index + 1}`}</h4>
            <ReadableContent value={content} />
          </section>;
        })
        : <section className="health-brief-article-section">
          <h4>{typeof body === 'string' ? 'Brief' : 'Brief details'}</h4>
          <ReadableContent value={body} />
        </section>}
    <details className="health-brief-raw">
      <summary>Raw brief</summary>
      <pre>{rawBody(item.body_json)}</pre>
    </details>
  </article>;
}

function groupBriefs(items: Record<string, HealthJson>[]) {
  const groups = new Map<string, { label: string; rows: Row[] }>();
  items.forEach(record => {
    const row = record as Row;
    const group = briefMonth(row.started_at);
    const existing = groups.get(group.key);
    if (existing) existing.rows.push(row);
    else groups.set(group.key, { label: group.label, rows: [row] });
  });
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

export default function BriefsSection(props: HealthSectionProps) {
  const historyQuery: HealthQuery | null = props.sources.includes(sources.briefs)
    ? { source: sources.briefs, limit: 50 } : null;
  const history = useHealthPages(props.backendUrl, props.getAccessToken, historyQuery, props.refreshVersion,
    { autoLoad: true, maxPages: 10 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedQuery: HealthQuery | null = selectedId && props.sources.includes(sources.brief)
    ? { source: sources.brief, briefId: selectedId } : null;
  const detail = useHealthQuery(props.backendUrl, props.getAccessToken, selectedQuery, props.refreshVersion);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    if (selectedId) {
      detailHeading.current?.focus({ preventScroll: true });
      wasOpen.current = true;
    } else if (wasOpen.current) {
      opener.current?.focus({ preventScroll: true });
      wasOpen.current = false;
    }
  }, [selectedId]);

  const item = detail.data?.items[0] as Row | undefined;
  const selectedSummary = history.items.find(record => text(record.id, '') === selectedId) as Row | undefined;
  const displayedItem = item ?? selectedSummary;
  const selectedIndex = history.items.findIndex(record => text(record.id, '') === selectedId);
  const newerNeighbor = selectedIndex > 0 ? history.items[selectedIndex - 1] as Row : undefined;
  const olderNeighbor = selectedIndex >= 0 && selectedIndex < history.items.length - 1
    ? history.items[selectedIndex + 1] as Row : undefined;
  const newerRecord = newerNeighbor && text(newerNeighbor.id, '') ? newerNeighbor : undefined;
  const olderRecord = olderNeighbor && text(olderNeighbor.id, '') ? olderNeighbor : undefined;
  const groups = groupBriefs(history.items);
  const loadedCount = history.items.length;

  return <section className="health-briefs" aria-labelledby="briefs-heading">
    <HealthSectionHeader title="Briefs" headingId="briefs-heading"
      freshness={<FreshnessLine {...(history.first ? { observedAt: history.first.freshness.observedAt } : {})}
        count={loadedCount} recordLabel="briefs" partial={history.hasMore || history.error !== null} />} />
    <section className="health-brief-history" aria-label="Brief history" hidden={selectedId !== null}
      aria-busy={history.status === 'loading' || history.loadingMore}>
      {(history.status === 'idle' || history.status === 'loading' || history.loadingMore) && loadedCount === 0 &&
        <HealthState status="loading" />}
      {history.error && <HealthState status="error" message={history.error} retryLabel="Retry brief history" onRetry={history.reload} />}
      {history.status === 'ready' && loadedCount === 0 && !history.error && !history.hasMore && !history.loadingMore &&
        <div className="health-brief-empty" role="status">
          <p>No briefs</p>
        </div>}
      {loadedCount > 0 && <>
        <p className="health-brief-count" role="status">{loadedCount} {loadedCount === 1 ? 'brief' : 'briefs'} loaded.</p>
        {history.status === 'loading' && <p className="health-brief-refresh" role="status">Refreshing brief history…</p>}
        {groups.map(group => <section className="health-brief-month" key={group.key}
          aria-labelledby={`health-brief-month-${group.key}`}>
          <h3 id={`health-brief-month-${group.key}`}>{group.label}</h3>
          <ul className="health-brief-list">
            {group.rows.map((row, index) => {
              const id = text(row.id, '');
              const date = briefDate(row.started_at);
              const label = briefLabel(row);
              const reasonId = `health-brief-unavailable-${group.key}-${index}`;
              return <li key={id || `${group.key}-${index}`}>
                <button className="ghost-button health-brief-row" type="button" disabled={!id}
                  aria-label={`Open brief ${label}, ${date}`}
                  {...(!id ? { 'aria-describedby': reasonId } : {})}
                  onClick={event => {
                    opener.current = event.currentTarget;
                    setSelectedId(id);
                  }}>
                  <time className="health-brief-date"
                    dateTime={typeof row.started_at === 'string' ? row.started_at : undefined}>{date}</time>
                  <span className="health-brief-label">{label}</span>
                  <span className="health-brief-chips">
                    <span>Status: {displayStored(row.status)}</span>
                    <span>Delivery: {displayStored(row.delivery_status)}</span>
                  </span>
                  {!id && <span className="health-brief-unavailable" id={reasonId}>
                    Details unavailable because this brief has no recorded identifier.
                  </span>}
                </button>
              </li>;
            })}
          </ul>
        </section>)}
      </>}
      {history.hasMore && history.capped &&
        <p className="health-brief-coverage" role="status">Page limit reached.</p>}
      {history.hasMore && !history.capped && <div className="health-brief-coverage" role="status">
        <button className="secondary-button" type="button" onClick={history.loadMore} disabled={history.loadingMore}>
          {history.loadingMore ? 'Loading more briefs…' : 'Load more'}
        </button>
      </div>}
    </section>
    {selectedId !== null && <section className="health-brief-detail" aria-labelledby="brief-detail-heading">
      <button className="secondary-button" type="button" onClick={() => setSelectedId(null)}>Back to brief history</button>
      <h3 id="brief-detail-heading" ref={detailHeading} tabIndex={-1}>
        {displayedItem ? briefLabel(displayedItem) : 'Brief details'}
      </h3>
      <p className="health-brief-announcement" role="status" aria-live="polite">
        Showing {displayedItem ? `${briefLabel(displayedItem)}, ${briefDate(displayedItem.started_at)}` : 'brief details'}.
      </p>
      <nav className="health-brief-navigation" aria-label="Navigate loaded briefs">
        <div>
          <button className="secondary-button" type="button" disabled={!newerRecord}
            {...(!newerRecord ? { 'aria-describedby': 'health-brief-newer-reason' } : {})}
            onClick={() => newerRecord && setSelectedId(text(newerRecord.id, ''))}>Newer brief</button>
          {!newerRecord && <span id="health-brief-newer-reason" className="visually-hidden">{newerNeighbor
            ? 'The newer brief cannot be opened because it has no recorded identifier.'
            : 'No newer brief is loaded.'}</span>}
        </div>
        <div>
          <button className="secondary-button" type="button" disabled={!olderRecord}
            {...(!olderRecord ? { 'aria-describedby': 'health-brief-older-reason' } : {})}
            onClick={() => olderRecord && setSelectedId(text(olderRecord.id, ''))}>Older brief</button>
          {!olderRecord && <span id="health-brief-older-reason" className="visually-hidden">{olderNeighbor
            ? 'The older brief cannot be opened because it has no recorded identifier.'
            : 'No older brief is loaded.'}</span>}
        </div>
      </nav>
      {detail.pending && !detail.data && <HealthState status="loading" />}
      {detail.error && <HealthState status="error" message={detail.error} retryLabel="Retry brief details" onRetry={detail.reload} />}
      {detail.data && !item && <HealthState status="empty" emptyMessage="No brief details were returned for this record." />}
      {item && <>
        <ul className="health-brief-meta" aria-label="Brief facts">
          <li><span>Date</span><span>{briefDate(item.started_at)}</span></li>
          <li><span>Status</span><span>{displayStored(item.status)}</span></li>
          <li><span>Delivery</span><span>{displayStored(item.delivery_status)}</span></li>
          <li><span>Trigger</span><span>{displayStored(item.trigger)}</span></li>
        </ul>
        <BriefBody item={item} />
      </>}
    </section>}
  </section>;
}

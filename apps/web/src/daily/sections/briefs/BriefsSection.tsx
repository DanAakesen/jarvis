import { useLayoutEffect, useRef, useState } from 'react';
import { dailyQuerySources as sources, type DailyJson, type DailyQuery } from '@jarvis/contracts';
import { DailyState } from '../../ui/DailyState';
import { DailyCoverageNote } from '../../ui/DailyCoverageNote';
import { useDailyPages } from '../../ui/useDailyPages';
import { useDailyQuery } from '../../useDailyQuery';
import { text, type Row } from '../nutrition/totals';
import type { DailySectionProps } from '../types';
import './briefs.css';

function briefTitle(item: Row) {
  return text(item.title) ?? text(item.kind) ?? 'Unknown';
}

function briefDate(value: DailyJson | undefined) {
  const stored = text(value);
  return stored && /^\d{4}-\d{2}-\d{2}T/u.test(stored) ? stored.slice(0, 10) : 'Unknown';
}

function displayStored(value: DailyJson | undefined) {
  return typeof value === 'string' && value.trim() ? value : 'Unknown';
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'Unknown';
  try { return JSON.stringify(value, null, 2); } catch { return 'Stored detail could not be displayed.'; }
}

function parsedBody(value: DailyJson | undefined): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function BriefBody({ item }: { item: Row }) {
  const body = parsedBody(item.body_json);
  const sections = typeof body === 'object' && body !== null && !Array.isArray(body) &&
    Array.isArray((body as Record<string, unknown>).sections)
    ? (body as { sections: unknown[] }).sections : null;
  return <div className="daily-briefs-detail-content">
    {typeof item.preview_text === 'string' && item.preview_text.length > 0 &&
      <section><h4>Preview</h4><p className="daily-brief-text">{item.preview_text}</p></section>}
    {body === null || body === undefined
      ? <p>No stored brief body is available.</p>
      : sections
        ? sections.map((section, index) => {
          const record = typeof section === 'object' && section !== null && !Array.isArray(section)
            ? section as Record<string, unknown> : null;
          const heading = record && (typeof record.title === 'string' ? record.title :
            typeof record.heading === 'string' ? record.heading : null);
          const content = record ? record.text ?? record.body ?? record.content ?? record : section;
          return <section key={index}><h4>{heading || `Section ${index + 1}`}</h4>
            <p className="daily-brief-text">{contentText(content)}</p></section>;
        })
        : <section><h4>Stored brief</h4><p className="daily-brief-text">{contentText(body)}</p></section>}
  </div>;
}

export default function BriefsSection(props: DailySectionProps) {
  const historyQuery: DailyQuery | null = props.sources.includes(sources.briefs)
    ? { source: sources.briefs, limit: 50 } : null;
  const history = useDailyPages(props.backendUrl, props.getAccessToken, historyQuery, props.refreshVersion,
    { autoLoad: true, maxPages: 10 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedQuery: DailyQuery | null = selectedId && props.sources.includes(sources.brief)
    ? { source: sources.brief, briefId: selectedId } : null;
  const detail = useDailyQuery(props.backendUrl, props.getAccessToken, selectedQuery, props.refreshVersion);
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
  return <section className="daily-briefs" aria-labelledby="briefs-heading">
    <h2 id="briefs-heading">Briefs</h2>
    <DailyCoverageNote summary="Briefs are historical records, not current health or a new delivery.">
      <p>Stored timestamps are displayed by their date as recorded. No timezone is inferred.</p>
    </DailyCoverageNote>
    <section aria-labelledby="brief-history-heading" hidden={selectedId !== null}>
        <h3 id="brief-history-heading">Brief history</h3>
        {history.status === 'loading' && history.items.length === 0 && <DailyState status="loading" />}
        {history.error && <DailyState status="error" message={history.error} retryLabel="Retry brief history" onRetry={history.reload} />}
        {history.status === 'ready' && history.items.length === 0 && !history.error && <DailyState status="empty" />}
        {history.items.length > 0 && <ul className="daily-brief-list">
          {history.items.map((record, index) => {
            const row = record as Row;
            const id = text(row.id);
            const startedAt = text(row.started_at);
            return <li key={id ?? `brief-${index}`}>
              <article>
                <h4>{briefTitle(row)}</h4>
                <p><time dateTime={startedAt ?? undefined}>{briefDate(row.started_at)}</time></p>
                <p>Status: {displayStored(row.status)} · Delivery: {displayStored(row.delivery_status)}</p>
                {id
                  ? <button className="secondary-button" type="button" onClick={event => {
                    opener.current = event.currentTarget;
                    setSelectedId(id);
                  }}>Open brief</button>
                  : <p>Details unavailable: this brief has no recorded identifier.</p>}
              </article>
            </li>;
          })}
        </ul>}
        {history.hasMore && <DailyState status="partial" coverage={{ returned: history.items.length, hasMore: true }}
          {...(!history.capped ? { onLoadMore: history.loadMore } : {})} />}
        {history.first && <DailyState status="ready" freshness={history.first.freshness} />}
    </section>
    {selectedId !== null && <section className="daily-brief-detail" aria-labelledby="brief-detail-heading">
        <div className="daily-brief-detail-heading">
          <h3 id="brief-detail-heading" ref={detailHeading} tabIndex={-1}>
            {item ? briefTitle(item) : 'Brief details'}
          </h3>
          <button className="secondary-button" type="button" onClick={() => setSelectedId(null)}>Back to brief history</button>
        </div>
        {detail.pending && !detail.data && <DailyState status="loading" />}
        {detail.error && <DailyState status="error" message={detail.error} retryLabel="Retry brief details" onRetry={detail.reload} />}
        {detail.data && !item && <DailyState status="empty" emptyMessage="No brief details were returned for this record." />}
        {item && <>
          <dl className="daily-brief-facts">
            <div><dt>Date</dt><dd>{briefDate(item.started_at)}</dd></div>
            <div><dt>Status</dt><dd>{displayStored(item.status)}</dd></div>
            <div><dt>Delivery</dt><dd>{displayStored(item.delivery_status)}</dd></div>
            <div><dt>Trigger</dt><dd>{displayStored(item.trigger)}</dd></div>
          </dl>
          <BriefBody item={item} />
          {detail.data && <DailyState status="ready" freshness={detail.data.freshness} />}
        </>}
      </section>}
  </section>;
}

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dailyQuerySources as sources, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import type { DailySectionProps } from '../../types';
import { useDailyPages, type DailyPages } from '../../../ui/useDailyPages';
import { StatTile } from '../../../ui/StatTile';
import { DailyState } from '../../../ui/DailyState';
import { DailyUnavailable } from '../../../ui/DailyUnavailable';
import { FreshnessLine } from '../../../ui/FreshnessLine';
import { IconChip } from '../../../ui/icons';
import { formatDate } from '../../../ui/formatters';
import { categoryTiles, healthSummary, healthTabs, healthWindow, syncStatus, weeklyProgress, type HealthTab, type Tile } from './data';
import { readTarget } from '../../../training-targets';
import { useTrainingTargetsShared } from '../../../training-targets-context';
import './health-panel.css';

const labels: Record<HealthTab, string> = {
  overview: 'Overview', sleep: 'Sleep', activity: 'Activity', workouts: 'Workouts',
  body: 'Body', nutrition: 'Nutrition', all: 'All data',
};
type Props = Pick<DailySectionProps, 'backendUrl' | 'getAccessToken' | 'sources' | 'refreshVersion'>;

function healthMessage(message: string) {
  return message.replace(/\bdaily\b/giu, 'Health');
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return <div className="health-panel-tiles">{tiles.map(tile => <StatTile compact key={tile.key}
    label={tile.label} value={tile.value} {...(typeof tile.value === 'number' && tile.unit ? { unit: tile.unit } : {})}
    note={tile.date ? <><time dateTime={tile.date}>{formatDate(tile.date)}</time>{tile.unit ? '' : ' · Unit not received'}
      {tile.note && <> · {tile.note}</>}</> : tile.note} />)}</div>;
}

function ReadStatus({ name, page, served }: { name: string; page: DailyPages; served: boolean }) {
  if (!served) return <DailyUnavailable>{`${name} is not served by this backend.`}</DailyUnavailable>;
  if (page.error) return <DailyState status="error" message={`${name}: ${healthMessage(page.error)}`} onRetry={page.reload} />;
  if (page.status === 'loading' || page.status === 'idle') return <DailyState status="loading" loadingLabel="Loading Health history" />;
  return page.hasMore ? <DailyState status="partial" coverage={{ returned: page.items.length, hasMore: true }}
    {...(!page.capped ? { onLoadMore: page.loadMore } : {})} /> : null;
}

export function HealthPanel(props: Props) {
  const targets = useTrainingTargetsShared();
  const [params, setParams] = useSearchParams();
  const requested = params.get('healthTab');
  const tab = healthTabs.find(item => item === requested) ?? 'overview';
  const open = params.get('panel') !== 'closed';
  const id = useId();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const window = healthWindow(now);
  const served = (source: DailySourceId) => props.sources.includes(source);
  const query = (source: DailySourceId): DailyQuery | null => !served(source) ? null :
    source === sources.sync ? { source } :
      { source, ...window, limit: 200 } as DailyQuery;
  const options = { autoLoad: true, settle: true };
  const metrics = useDailyPages(props.backendUrl, props.getAccessToken, query(sources.metrics), props.refreshVersion, options);
  const catalog = useDailyPages(props.backendUrl, props.getAccessToken, query(sources.metricCatalog), props.refreshVersion, options);
  const sleep = useDailyPages(props.backendUrl, props.getAccessToken, query(sources.sleep), props.refreshVersion, options);
  const workouts = useDailyPages(props.backendUrl, props.getAccessToken, query(sources.workouts), props.refreshVersion, options);
  const nutrition = useDailyPages(props.backendUrl, props.getAccessToken, query(sources.days), props.refreshVersion, options);
  const sync = useDailyPages(props.backendUrl, props.getAccessToken, query(sources.sync), props.refreshVersion);
  const reads = [
    { name: 'Health metrics', page: metrics, source: sources.metrics },
    { name: 'Metric catalogue', page: catalog, source: sources.metricCatalog },
    { name: 'Sleep', page: sleep, source: sources.sleep },
    { name: 'Workouts', page: workouts, source: sources.workouts },
    { name: 'Nutrition', page: nutrition, source: sources.days },
  ];
  const records = { metrics: metrics.items, catalog: catalog.items, sleep: sleep.items, workouts: workouts.items, nutrition: nutrition.items };
  const select = (next: HealthTab) => setParams(previous => {
    const copy = new URLSearchParams(previous);
    copy.set('panel', 'health');
    copy.set('healthTab', next);
    return copy;
  });
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = healthTabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % healthTabs.length :
      event.key === 'ArrowLeft' ? (index + healthTabs.length - 1) % healthTabs.length :
        event.key === 'Home' ? 0 : event.key === 'End' ? healthTabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    select(healthTabs[next]!);
    document.getElementById(`${id}-tab-${healthTabs[next]}`)?.focus();
  };
  const incomplete = (page: DailyPages, source: DailySourceId) =>
    !served(source) || page.status !== 'ready' || page.hasMore || Boolean(page.error);
  const summary = healthSummary(records, now).map(tile => {
    const read = tile.key === 'night' || tile.key === 'sleep-average' ? { page: sleep, source: sources.sleep } :
      ['steps', 'active', 'resting'].includes(tile.key) ? { page: metrics, source: sources.metrics } :
        tile.key === 'food' ? { page: nutrition, source: sources.days } : { page: workouts, source: sources.workouts };
    return incomplete(read.page, read.source) ? { ...tile, value: 'Unavailable', note: 'Waiting for a complete read of this window.' } : tile;
  });
  const visibleReads = tab === 'overview' || tab === 'all' ? reads : [
    reads[0]!, reads[1]!, ...(tab === 'sleep' ? [reads[2]!] : tab === 'workouts' ? [reads[3]!] : tab === 'nutrition' ? [reads[4]!] : []),
  ];
  const tiles = categoryTiles(records, tab);
  const noCategories = catalog.status === 'ready' && catalog.items.length > 0 && !catalog.items.some(row => typeof row.category === 'string');
  const categoryUnavailable = noCategories && (tab === 'activity' || tab === 'body');
  const ready = visibleReads.every(read => served(read.source) && read.page.status === 'ready' && !read.page.error && !read.page.hasMore);
  return <section id="health-panel" className="health-panel" aria-labelledby={`${id}-heading`}>
    <header className="health-panel-header">
      <IconChip name="pulse" />
      <div className="health-panel-heading"><h2 id={`${id}-heading`}>Health</h2>
        {served(sources.sync) ? <p role="status">{sync.status === 'ready' && !sync.error ? syncStatus(sync.items, now) :
          sync.error ? 'Sync status unavailable' : 'Checking sync status'}</p> :
          <DailyUnavailable>Sync status is not served by this backend.</DailyUnavailable>}
      </div>
      <button className="ghost-button" type="button" aria-expanded={open} aria-controls={`${id}-content`}
        onClick={() => setParams(previous => {
          const copy = new URLSearchParams(previous);
          copy.set('panel', open ? 'closed' : 'health');
          return copy;
        })}>{open ? 'Collapse Health' : 'Expand Health'}</button>
    </header>
    <div id={`${id}-content`} hidden={!open}>
      <div className="health-panel-tabs" role="tablist" aria-label="Health views" onKeyDown={keyboard}>
        {healthTabs.map(item => <button type="button" className="daily-section-tab" key={item} role="tab"
          id={`${id}-tab-${item}`} aria-controls={`${id}-view-${item}`} aria-selected={tab === item}
          tabIndex={tab === item ? 0 : -1} onClick={() => select(item)}>{labels[item]}</button>)}
      </div>
      {healthTabs.map(item => <div key={item} id={`${id}-view-${item}`} role="tabpanel"
        aria-labelledby={`${id}-tab-${item}`} hidden={tab !== item} tabIndex={0} className="health-panel-view">
        {tab === item && <>
          <div className="health-panel-status">
            <p>Received records · {formatDate(window.startDate)}–{formatDate(window.endDate)} · Europe/Copenhagen.
              Source completeness is unknown.</p>
            {visibleReads.map(read => <ReadStatus key={read.source} {...read} served={served(read.source)} />)}
            {tab === 'overview' && served(sources.sync) && sync.error && <DailyState status="error" message={`Sync: ${healthMessage(sync.error)}`} onRetry={sync.reload} />}
            {noCategories && tab !== 'overview' && <p>Metric categories are not served by this catalogue. Uncategorised metrics appear in All data.</p>}
          </div>
          {tab === 'overview' ? <>
            <Tiles tiles={summary} />
            <div className="health-panel-targets">
              {(['gym', 'run'] as const).map(kind => {
                const read = readTarget(targets.view, kind === 'gym' ? 'gymSessionsPerWeek' : 'runSessionsPerWeek');
                const progress = weeklyProgress(workouts.items, read.status === 'ready' ? read.value : null, kind, now);
                const unavailable = incomplete(workouts, sources.workouts);
                const label = `${kind === 'gym' ? 'Gym' : 'Run'} weekly target`;
                if (read.status === 'loading') return <StatTile compact key={kind} label={label} value="Loading target" />;
                if (read.status === 'failed') return <StatTile compact key={kind} label={label} value="Targets unavailable"
                  note={targets.view.status === 'error' && targets.view.kind === 'unavailable' ? undefined
                    : <button className="ghost-button" type="button" onClick={targets.retry}>Retry</button>} />;
                return <StatTile compact key={kind} label={label}
                  value={progress.target === null ? 'No target set' : unavailable ? 'Unavailable' : `${progress.done} / ${progress.target} sessions`}
                  note={progress.target === null ? <a href="/settings#training-targets">Set training targets</a> :
                    unavailable ? 'A complete workout read is needed to calculate remaining sessions.' :
                      `${progress.remaining} sessions remaining · ${progress.days} days remaining including today`}
                  comparison={progress.target !== null && !unavailable ? 'Received sessions this Copenhagen week (Monday–Sunday).' : undefined} />;
              })}
            </div>
          </> : tiles.length ? <Tiles tiles={tiles} /> : categoryUnavailable ?
            <DailyUnavailable>Category grouping is unavailable without catalogue categories. See All data for received metrics.</DailyUnavailable> : ready ?
            <DailyState status="empty" emptyMessage="No data received for this view." /> : null}
          <div className="health-panel-freshness">{visibleReads.filter(read => read.page.last).map(read =>
            <div key={read.source}><span>{read.name}</span><FreshnessLine observedAt={read.page.last?.freshness.observedAt ?? null}
              count={read.page.items.length} partial={read.page.hasMore || Boolean(read.page.error)} /></div>)}</div>
        </>}
      </div>)}
    </div>
  </section>;
}

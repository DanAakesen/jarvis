import { dailyQuerySources as sources } from '@jarvis/contracts';
import { useEffect, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DailySectionProps } from '../types';
import { BodyView } from './BodyView';
import { SleepView } from './SleepView';
import './body-sleep.css';

export default function BodySleepSection(props: DailySectionProps) {
  const [params, setParams] = useSearchParams();
  const hasBody = props.sources.includes(sources.metrics) && props.sources.includes(sources.metricCatalog);
  const hasSleep = props.sources.includes(sources.sleep);
  const views = [...(hasBody ? ['body'] : []), ...(hasSleep ? ['sleep'] : [])];
  const requested = params.get('view');
  const view = views.find(item => item === requested) ?? views[0];
  useEffect(() => {
    if (!view || view === requested) return;
    setParams(previous => {
      const copy = new URLSearchParams(previous);
      copy.set('view', view);
      return copy;
    }, { replace: true });
  }, [view, requested, setParams]);
  const select = (next: string) => {
    setParams(previous => {
      const copy = new URLSearchParams(previous);
      copy.set('view', next);
      return copy;
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = views.indexOf(view ?? '');
    const next = event.key === 'ArrowRight' ? (index + 1) % views.length :
      event.key === 'ArrowLeft' ? (index - 1 + views.length) % views.length :
        event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : undefined;
    if (next === undefined || !views[next]) return;
    event.preventDefault();
    select(views[next]);
    document.getElementById(`body-sleep-tab-${views[next]}`)?.focus();
  };
  return <section className="body-sleep" aria-labelledby="body-sleep-heading">
    <h2 id="body-sleep-heading">Body &amp; sleep</h2>
    <div className="daily-section-tabs" role="tablist" aria-label="Body and sleep views" onKeyDown={onKeyDown}>
      {views.map(item => <button type="button" className="daily-section-tab" key={item} role="tab"
        id={`body-sleep-tab-${item}`} aria-controls={`body-sleep-panel-${item}`}
        aria-selected={view === item} tabIndex={view === item ? 0 : -1} onClick={() => select(item)}>
        {item === 'body' ? 'Body' : 'Sleep'}
      </button>)}
    </div>
    {!hasBody && <p>Body is unavailable: this backend must expose both measurements and the metric catalogue.</p>}
    {!hasSleep && <p>Sleep is unavailable: this backend does not expose sleep records.</p>}
    {views.map(item => <div role="tabpanel" key={item} id={`body-sleep-panel-${item}`}
      aria-labelledby={`body-sleep-tab-${item}`} hidden={item !== view} tabIndex={0}>
      {item === view && (item === 'body' ? <BodyView {...props} /> : <SleepView {...props} />)}
    </div>)}
  </section>;
}

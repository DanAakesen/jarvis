import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dailyQuerySources } from '@jarvis/contracts';
import { loadProfile } from '../../../auth';
import { NutritionTargetsSettings } from '../../NutritionTargetsSettings';
import { useDailyQuery } from '../../useDailyQuery';
import type { DailySectionProps } from '../types';
import { sourceCoverage } from './coverage';
import { formatTime } from '../../ui/formatters';
import './rules.css';

const syncQuery = { source: dailyQuerySources.sync };
const rules = [
  ['Access', 'Daily is owner-only. The backend verifies your Microsoft sign-in before allowing access to your data.'],
  ['Behaviour', 'Daily shows retained health, workout and nutrition records. Missing values stay unknown. Coaching and recomposition automation are not enabled.'],
  ['Mail', 'Gmail attention belongs to the opt-in Daily feed. It is not connected here until the owner enables it and a web source is served.'],
  ['Calendar', 'Calendar attention belongs to the opt-in Daily feed. It is not connected here until the owner enables it and a web source is served.'],
  ['Refresh', 'Refresh reads the data Jarvis already holds; it does not fetch new health data from your phone. Phone contact, upload receipt and completed processing are different events.'],
  ['Notification', 'Recurring Daily notifications remain off. Reading historical briefs does not generate or deliver a new brief.'],
  ['Sources', 'Health uploads and nutrition capture feed Daily. Coverage below reports only served sync evidence; a recent read or phone contact does not prove fresh data.'],
] as const;

function AccountPill({ backendUrl, getAccessToken }: Pick<DailySectionProps, 'backendUrl' | 'getAccessToken'>) {
  const [attempt, setAttempt] = useState(0);
  const [account, setAccount] = useState<{ name?: string; failed?: boolean; backendUrl: string | null; getAccessToken: typeof getAccessToken }>();
  useEffect(() => {
    const controller = new AbortController();
    void getAccessToken().then(token => {
      if (controller.signal.aborted) return;
      return loadProfile({ backendUrl }, token, controller.signal);
    }).then(profile => {
      if (!controller.signal.aborted && profile) setAccount({ name: profile.name, backendUrl, getAccessToken });
    }).catch(() => {
      if (!controller.signal.aborted) setAccount({ failed: true, backendUrl, getAccessToken });
    });
    return () => controller.abort();
  }, [backendUrl, getAccessToken, attempt]);
  const current = account?.backendUrl === backendUrl && account.getAccessToken === getAccessToken ? account : undefined;
  return <div className="daily-rules-account" role="status">
    {current?.name
      ? <span className="daily-rules-pill">Protected · {current.name}</span>
      : current?.failed
        ? <>Account unavailable <button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Retry account</button></>
        : 'Checking account…'}
  </div>;
}

export default function RulesSection({ backendUrl, getAccessToken, sources, refreshVersion }: DailySectionProps) {
  const syncAvailable = sources.includes(dailyQuerySources.sync);
  const sync = useDailyQuery(backendUrl, getAccessToken, syncAvailable ? syncQuery : null, refreshVersion);
  const coverage = sourceCoverage(sync.data, Boolean(sync.error));
  return <div className="daily-rules">
    <header className="daily-rules-header">
      <Link to="/daily">Back to Daily</Link>
      <AccountPill backendUrl={backendUrl} getAccessToken={getAccessToken} />
    </header>
    <section aria-labelledby="daily-rules-targets">
      <h2 id="daily-rules-targets">Targets</h2>
      <p>Set your own nutrition targets. Daily does not estimate energy needs from body measurements.</p>
      <NutritionTargetsSettings backendUrl={backendUrl} getAccessToken={getAccessToken} />
      <p className="daily-rules-note">Training targets are not available here yet.</p>
    </section>
    <section aria-labelledby="daily-rules-heading">
      <h2 id="daily-rules-heading">Rules</h2>
      <div className="daily-rules-cards">
        {rules.map(([title, copy]) => <article key={title} className="daily-rules-card">
          <h3>{title}</h3><p>{copy}</p>
        </article>)}
      </div>
    </section>
    <section aria-labelledby="daily-rules-coverage">
      <h2 id="daily-rules-coverage">Source coverage</h2>
      {syncAvailable && sync.pending && <p role="status">Checking sync status…</p>}
      {sync.error && <p role="alert">{sync.error} Previous sync evidence, if shown, may be stale.</p>}
      {!syncAvailable && <p>Sync status is not served here.</p>}
      <ul className="daily-rules-sources">
        {coverage.map(source => <li key={source.label}>
          <div className="daily-rules-source-title"><h3>{source.label}</h3><span className="daily-rules-pill">{source.status}</span></div>
          <p>Last sync: {source.at ? <time dateTime={source.at}>{formatTime(source.at)}</time> : 'Unknown'}</p>
          <p className="daily-rules-note">{source.note}</p>
        </li>)}
      </ul>
      {syncAvailable && <button type="button" className="secondary-button" disabled={sync.pending} onClick={sync.reload}>
        {sync.pending ? 'Checking…' : 'Check sync again'}
      </button>}
    </section>
  </div>;
}

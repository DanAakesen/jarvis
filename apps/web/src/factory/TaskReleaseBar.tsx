import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchReleaseView } from './release-data';
import type { ReleaseView } from './release-data';
import { Loader } from '../Loader';

const idPattern = /^[1-9]\d{0,18}$/u;
const releaseStatuses = ['building', 'deploying', 'released', 'failed'];
const runStatuses = ['queued', 'in_progress', 'completed'];
const deploymentStatuses = ['queued', 'in_progress', 'success', 'failure'];
const maxGraphAgeMs = 24 * 60 * 60 * 1000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReleaseView(value: unknown, projectId: string): value is ReleaseView {
  if (!isObject(value) || !isObject(value.project) || value.project.id !== projectId ||
    typeof value.project.name !== 'string' || typeof value.project.repo !== 'string' ||
    typeof value.project.defaultBranch !== 'string' || !Array.isArray(value.releases) ||
    !Array.isArray(value.workflowRuns) || !Array.isArray(value.deployments)) return false;
  if (!value.releases.every((item) => isObject(item) && typeof item.id === 'string' &&
    typeof item.version === 'string' && typeof item.sha === 'string' &&
    releaseStatuses.includes(String(item.status)) && typeof item.createdAt === 'string' &&
    Number.isFinite(Date.parse(item.createdAt)) &&
    (item.releasedAt === null || (typeof item.releasedAt === 'string' && Number.isFinite(Date.parse(item.releasedAt)))))) {
    return false;
  }
  if (!value.workflowRuns.every((item) => isObject(item) && typeof item.id === 'string' &&
    typeof item.workflow === 'string' && runStatuses.includes(String(item.status)) &&
    (item.conclusion === null || ['success', 'failure', 'cancelled'].includes(String(item.conclusion))) &&
    (item.startedAt === null || (typeof item.startedAt === 'string' && Number.isFinite(Date.parse(item.startedAt)))) &&
    (item.completedAt === null || (typeof item.completedAt === 'string' && Number.isFinite(Date.parse(item.completedAt)))))) {
    return false;
  }
  if (!value.deployments.every((item) => isObject(item) && typeof item.id === 'string' &&
    deploymentStatuses.includes(String(item.status)) && typeof item.at === 'string' &&
    Number.isFinite(Date.parse(item.at)))) return false;
  if (value.graph === null) return true;
  return isObject(value.graph) && typeof value.graph.fetchedAt === 'string' &&
    Number.isFinite(Date.parse(value.graph.fetchedAt)) && Array.isArray(value.graph.commits) &&
    value.graph.commits.every((commit) => isObject(commit) && typeof commit.sha === 'string' &&
      typeof commit.message === 'string' && typeof commit.committedAt === 'string' &&
      Number.isFinite(Date.parse(commit.committedAt)));
}

function repositoryPath(repository: string): string {
  return repository.split('/').map(encodeURIComponent).join('/');
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function latestByDate<T>(values: T[], date: (value: T) => string | null): T | undefined {
  return [...values].sort((left, right) =>
    Date.parse(date(right) ?? '') - Date.parse(date(left) ?? ''))[0];
}

function TrailIcon({ name }: { name: 'repo' | 'refresh' | 'open' }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'repo': return <svg {...common}><rect x="3.5" y="4" width="17" height="16" rx="3" /><path d="M3.5 9h17M8 4v5" /></svg>;
    case 'refresh': return <svg {...common}><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19 4.5V8h-3.5" /></svg>;
    case 'open': return <svg {...common}><path d="M14 4h6v6M20 4l-8.5 8.5" /><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></svg>;
  }
}

function relativeTime(value: string): string {
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Tone for a pipeline dot; the state word is always shown beside it. */
function pipelineTone(value: string | null | undefined): string {
  if (!value) return 'idle';
  if (['success', 'released', 'completed'].includes(value)) return 'ok';
  if (['failure', 'failed', 'cancelled'].includes(value)) return 'bad';
  return 'live';
}

export function TaskReleaseBar({
  backendUrl,
  getAccessToken,
  projectId,
  variant = 'bar',
}: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  projectId: string;
  /** `trail` draws the project's recent commits as a lit timeline for the Kanban board. */
  variant?: 'bar' | 'trail';
}) {
  const [view, setView] = useState<{ data: ReleaseView; stale: boolean } | null>(null);
  const [result, setResult] = useState<{
    requestKey: string;
    status: 'loading' | 'ready' | 'error';
    message?: string;
  }>({ requestKey: '', status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const requestKey = `${backendUrl ?? ''}:${projectId}:${refreshKey}`;
  const currentView = view?.data.project.id === projectId ? view.data : null;
  const currentStale = view?.data.project.id === projectId ? view.stale : false;
  const currentResult = result.requestKey === requestKey ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    const setError = (message: string) => {
      if (!controller.signal.aborted) setResult({ requestKey, status: 'error', message });
    };
    if (!projectId) {
      return () => controller.abort();
    } else if (!backendUrl) {
      void Promise.resolve().then(() => setError('Release data unavailable.'));
    } else if (!idPattern.test(projectId)) {
      void Promise.resolve().then(() => setError('Select a project.'));
    } else {
      void fetchReleaseView(backendUrl, projectId, getAccessToken, controller.signal).then((data: unknown) => {
        if (controller.signal.aborted) return;
        if (!isReleaseView(data, projectId)) throw new Error('Jarvis returned invalid release data.');
        const stale = data.graph !== null &&
          Date.now() - Date.parse(data.graph.fetchedAt) > maxGraphAgeMs;
        setView({ data, stale });
        setResult({ requestKey, status: 'ready' });
      }).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Release data could not be loaded. Try again.');
      });
    }
    return () => controller.abort();
  }, [backendUrl, getAccessToken, projectId, refreshKey, requestKey]);

  if (!projectId) {
    if (variant === 'trail') {
      return (
        <section className="release-trail release-trail-empty" aria-label="Project release context">
          <span className="release-trail-icon"><TrailIcon name="repo" /></span>
          <div className="release-trail-line" aria-hidden="true"><span /><span /><span /><span /></div>
          <p>No project selected.</p>
        </section>
      );
    }
    return (
      <section className="task-release-bar" aria-label="Project release context">
        <p>No project selected.</p>
      </section>
    );
  }

  if (!currentView) {
    return (
      <section className={variant === 'trail' ? 'release-trail release-trail-empty' : 'task-release-bar'} aria-label="Project release context">
        <p role={currentResult?.status === 'error' ? 'alert' : 'status'}>
          {currentResult?.status === 'error'
            ? currentResult.message
            : !backendUrl
              ? 'Release data unavailable.'
              : <Loader variant="inline" announce={false} label="Loading project release context…" />}
        </p>
        {currentResult?.status === 'error' && backendUrl && (
          <button className="secondary-button" type="button" onClick={() => setRefreshKey((key) => key + 1)}>
            Retry release data
          </button>
        )}
      </section>
    );
  }

  const repositoryUrl = `https://github.com/${repositoryPath(currentView.project.repo)}`;
  const latestRelease = latestByDate(currentView.releases, (release) => release.createdAt);
  const latestBuild = latestByDate(currentView.workflowRuns, (run) => run.completedAt ?? run.startedAt);
  const latestDeployment = latestByDate(currentView.deployments, (deployment) => deployment.at);
  const commits = currentView.graph
    ? [...currentView.graph.commits].sort((left, right) =>
      Date.parse(right.committedAt) - Date.parse(left.committedAt)).slice(0, 3)
    : [];
  const loading = !currentResult || currentResult.status === 'loading';
  const releaseUrl = latestRelease
    ? `/factory/projects/${projectId}/releases/${encodeURIComponent(latestRelease.id)}`
    : `/factory/projects/${projectId}/releases`;

  if (variant === 'trail') {
    const trail = currentView.graph
      ? [...currentView.graph.commits].sort((left, right) =>
        Date.parse(right.committedAt) - Date.parse(left.committedAt)).slice(0, 5).reverse()
      : [];
    const buildState = latestBuild ? latestBuild.conclusion ?? latestBuild.status : null;
    return (
      <section className="release-trail" aria-label="Project release context">
        <span className="release-trail-icon"><TrailIcon name="repo" /></span>
        <div className="release-trail-project">
          <p className="release-trail-name">
            <Link to={`/factory/projects/${projectId}`}>{currentView.project.name}</Link>
            <span aria-hidden="true">/</span>
            <code>{currentView.project.defaultBranch}</code>
          </p>
          <ul className="release-trail-pipeline" aria-label="Pipeline">
            <li data-tone={pipelineTone(buildState)}>Build {buildState ? statusLabel(buildState) : 'not reported'}</li>
            <li data-tone={pipelineTone(latestDeployment?.status)}>Deploy {latestDeployment ? statusLabel(latestDeployment.status) : 'not reported'}</li>
            {latestRelease && <li data-tone={pipelineTone(latestRelease.status)}><Link to={releaseUrl}>v{latestRelease.version}</Link></li>}
          </ul>
        </div>
        {currentView.graph === null
          ? <p className="release-trail-note" role="status">Commit history is unavailable.</p>
          : trail.length === 0
            ? <p className="release-trail-note">No commits yet.</p>
            : (
              <ol className="release-trail-commits" aria-label="Recent commits, oldest to newest">
                {trail.map((commit, index) => (
                  <li key={commit.sha} data-latest={index === trail.length - 1 || undefined}>
                    <a href={`${repositoryUrl}/commit/${encodeURIComponent(commit.sha)}`} target="_blank" rel="noreferrer"
                      title={`${commit.message} · ${formatDate(commit.committedAt)}`}>
                      <span className="release-trail-dot" aria-hidden="true" />
                      <code>{commit.sha.slice(0, 7)}</code>
                      <span className="release-trail-message">{commit.message}</span>
                      <time dateTime={commit.committedAt}>{relativeTime(commit.committedAt)}</time>
                    </a>
                  </li>
                ))}
              </ol>
            )}
        <div className="release-trail-actions">
          <button className="release-trail-button" type="button" disabled={loading} onClick={() => setRefreshKey((key) => key + 1)}
            aria-label={loading ? 'Refreshing release context' : 'Refresh release context'} title="Refresh">
            <TrailIcon name="refresh" />
          </button>
          <Link className="release-trail-open" to={releaseUrl}><TrailIcon name="open" /><span>Open release</span></Link>
        </div>
        {currentStale && currentView.graph &&
          <p className="release-trail-note release-trail-wide" role="status">Commit data may be stale. Fetched {formatDate(currentView.graph.fetchedAt)}.</p>}
        {currentResult?.status === 'error' && currentResult.message && (
          <p className="release-trail-note release-trail-wide" role="alert">Refresh failed; showing the last loaded project data. {currentResult.message}</p>
        )}
      </section>
    );
  }

  return (
    <section className="task-release-bar" aria-label="Project release context">
      <div className="task-release-project">
        <Link to={`/factory/projects/${projectId}`}>{currentView.project.name}</Link>
        <span>Default: <code>{currentView.project.defaultBranch}</code></span>
      </div>
      <dl className="task-release-statuses">
        <div>
          <dt>Build</dt>
          <dd>{latestBuild
            ? <a href={`${repositoryUrl}/actions/runs/${encodeURIComponent(latestBuild.id)}`} target="_blank" rel="noreferrer">
              <span className={`release-status state-${latestBuild.conclusion ?? latestBuild.status}`}>
                {latestBuild.conclusion ?? statusLabel(latestBuild.status)}
              </span>
              <span>{latestBuild.workflow}</span>
            </a>
            : 'Not reported'}
          </dd>
        </div>
        <div>
          <dt>Deployment</dt>
          <dd>{latestDeployment
            ? <span className={`release-status state-${latestDeployment.status}`}>
              {statusLabel(latestDeployment.status)}
            </span>
            : 'Not reported'}
          </dd>
        </div>
        {latestRelease && (
          <div>
            <dt>Release</dt>
            <dd>
              <span className="task-release-version">
                <Link to={releaseUrl}>v{latestRelease.version}</Link>
                <span className={`release-status state-${latestRelease.status}`}>{latestRelease.status}</span>
              </span>
            </dd>
          </div>
        )}
      </dl>
      <div className="task-release-commits">
        <h2>Recent commits</h2>
        {currentView.graph === null
          ? <p role="status">Commit history is unavailable.</p>
          : commits.length === 0
            ? <p>No commits are available for this project.</p>
            : <ol>
              {commits.map((commit) => (
                <li key={commit.sha}>
                  <a href={`${repositoryUrl}/commit/${encodeURIComponent(commit.sha)}`} target="_blank" rel="noreferrer">
                    <code>{commit.sha.slice(0, 7)}</code> {commit.message}
                  </a>
                  <time dateTime={commit.committedAt}>{formatDate(commit.committedAt)}</time>
                </li>
              ))}
            </ol>}
        {currentStale && currentView.graph &&
          <p className="task-release-stale" role="status">Commit data may be stale. Fetched {formatDate(currentView.graph.fetchedAt)}.</p>}
        {currentResult?.status === 'error' && currentResult.message && (
          <p className="task-release-stale" role="alert">Refresh failed; showing the last loaded project data. {currentResult.message}</p>
        )}
      </div>
      <div className="task-release-actions">
        {currentView.releases.length === 0
          ? <p>No releases have been recorded for this project.</p>
          : null}
        <button className="secondary-button" type="button" disabled={loading}
          onClick={() => setRefreshKey((key) => key + 1)}>
          {loading ? <Loader variant="inline" announce={false} label={currentView ? 'Refreshing…' : 'Loading…'} /> : 'Refresh'}
        </button>
        <Link className="secondary-button" to={releaseUrl}>Open release</Link>
      </div>
    </section>
  );
}

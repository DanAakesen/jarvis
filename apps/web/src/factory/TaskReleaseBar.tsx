import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchReleaseView } from './ReleasePage';
import type { ReleaseView } from './ReleasePage';

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

export function TaskReleaseBar({
  backendUrl,
  getAccessToken,
  projectId,
}: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  projectId: string;
}) {
  const [view, setView] = useState<ReleaseView | null>(null);
  const [result, setResult] = useState<{
    projectId: string;
    status: 'loading' | 'ready' | 'error';
    message?: string;
  }>({ projectId: '', status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const currentView = view?.project.id === projectId ? view : null;
  const currentResult = result.projectId === projectId ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    const setError = (message: string) => {
      if (!controller.signal.aborted) setResult({ projectId, status: 'error', message });
    };
    if (!backendUrl) {
      setError('Release data is unavailable until the backend is deployed.');
    } else if (!idPattern.test(projectId)) {
      setError('Select an active project to load release context.');
    } else {
      setResult({ projectId, status: 'loading' });
      void fetchReleaseView(backendUrl, projectId, getAccessToken, controller.signal).then((data: unknown) => {
        if (controller.signal.aborted) return;
        if (!isReleaseView(data, projectId)) throw new Error('Jarvis returned invalid release data.');
        setView(data);
        setResult({ projectId, status: 'ready' });
      }).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Release data could not be loaded. Try again.');
      });
    }
    return () => controller.abort();
  }, [backendUrl, getAccessToken, projectId, refreshKey]);

  if (!projectId) {
    return (
      <section className="task-release-bar" aria-label="Project release context">
        <p>Select a project to view its release and commit context.</p>
      </section>
    );
  }

  if (!currentView) {
    return (
      <section className="task-release-bar" aria-label="Project release context">
        <p role={currentResult?.status === 'error' ? 'alert' : 'status'}>
          {currentResult?.status === 'error'
            ? currentResult.message
            : !backendUrl
              ? 'Release data is unavailable until the backend is deployed.'
              : 'Loading project release context…'}
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
  const stale = currentView.graph !== null &&
    Date.now() - Date.parse(currentView.graph.fetchedAt) > maxGraphAgeMs;
  const releaseUrl = latestRelease
    ? `/factory/projects/${projectId}/releases/${encodeURIComponent(latestRelease.id)}`
    : `/factory/projects/${projectId}/releases`;

  return (
    <section className="task-release-bar" aria-label="Project release context">
      <div className="task-release-project">
        <Link to={`/factory/projects/${projectId}`}>{currentView.project.name}</Link>
        <a href={repositoryUrl} target="_blank" rel="noreferrer">{currentView.project.repo}</a>
        <span>Default branch <code>{currentView.project.defaultBranch}</code></span>
      </div>
      <dl className="task-release-statuses">
        <div>
          <dt>Latest build</dt>
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
          <dt>Latest deployment</dt>
          <dd>{latestDeployment
            ? <span className={`release-status state-${latestDeployment.status}`}>
              {statusLabel(latestDeployment.status)}
            </span>
            : 'Not reported'}
          </dd>
        </div>
        {latestRelease && (
          <div>
            <dt>Latest release</dt>
            <dd>
              <Link to={releaseUrl}>Build {latestRelease.version}</Link>{' '}
              <span className={`release-status state-${latestRelease.status}`}>{latestRelease.status}</span>
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
        {stale && <p className="task-release-stale" role="status">Commit data may be stale. Fetched {formatDate(currentView.graph!.fetchedAt)}.</p>}
        {currentResult?.status === 'error' && currentResult.message && (
          <p className="task-release-stale" role="alert">Refresh failed; showing the last loaded project data. {currentResult.message}</p>
        )}
      </div>
      <div className="task-release-actions">
        {currentView.releases.length === 0
          ? <p>No releases have been recorded for this project.</p>
          : null}
        <button className="secondary-button" type="button" disabled={currentResult?.status === 'loading'}
          onClick={() => setRefreshKey((key) => key + 1)}>
          {currentResult?.status === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
        <Link className="secondary-button" to={releaseUrl}>Open release</Link>
      </div>
    </section>
  );
}

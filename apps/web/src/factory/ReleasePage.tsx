import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { backendFetch } from '../backend-request';
import type { AreaProps } from '../areas';
import { fetchReleaseView } from './release-data';
import type {
  Deployment, DeploymentStatus, GitGraph, PullRequest, Release, ReleaseView, WorkflowRun,
} from './release-data';

async function fetchReleaseProjectId(
  backendUrl: string,
  releaseId: string,
  getAccessToken: () => Promise<string>,
  signal: AbortSignal,
): Promise<string> {
  const token = await getAccessToken();
  const response = await backendFetch(
    `${backendUrl.replace(/\/+$/, '')}/factory/releases/${encodeURIComponent(releaseId)}`,
    { headers: { Authorization: `${['Bear', 'er'].join('')} ${token}` }, signal, cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Release data could not be loaded. Try again.');
  const result = await response.json() as { projectId?: unknown };
  if (typeof result.projectId !== 'string' || !/^[1-9]\d{0,18}$/u.test(result.projectId)) {
    throw new Error('The project for this release could not be found.');
  }
  return result.projectId;
}

interface MarkerState {
  pullRequest?: PullRequest;
  checks?: PullRequest['checks'];
  release?: Release;
  deployment?: Deployment;
}

function formatDate(value: string | null): string {
  if (!value) return 'Not released';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Unknown time';
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return 'Not started';
  if (!completedAt) return 'In progress';
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(duration) || duration < 0) return 'Unknown';
  const seconds = Math.floor(duration / 1000);
  if (seconds < 60) return 'Under a minute';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} hr ${Math.floor((seconds % 3600) / 60)} min`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function repositoryPath(repo: string): string {
  return repo.split('/').map(encodeURIComponent).join('/');
}

function runStatus(run: WorkflowRun): string {
  return run.status === 'completed' ? run.conclusion ?? 'Completed' : run.status.replace('_', ' ');
}

function deploymentState(status: DeploymentStatus): string {
  return status.replace('_', ' ');
}

function linkedRunUrl(repositoryUrl: string, runId: string): string {
  return `${repositoryUrl}/actions/runs/${encodeURIComponent(runId)}`;
}

function markerFor(sha: string, data: ReleaseView): MarkerState {
  const pullRequest = data.pullRequests.find((pr) => pr.headSha.toLowerCase() === sha.toLowerCase());
  const release = data.releases.find((item) => item.sha.toLowerCase() === sha.toLowerCase());
  const deployment = release
    ? data.deployments.find((item) => item.releaseId === release.id)
    : undefined;
  return {
    ...(pullRequest ? { pullRequest, checks: pullRequest.checks } : {}),
    ...(release ? { release } : {}),
    ...(deployment ? { deployment } : {}),
  };
}

function markerDescription(marker: MarkerState): string {
  return [
    marker.pullRequest && `PR #${marker.pullRequest.number} ${marker.pullRequest.state}`,
    marker.checks && `checks ${marker.checks}`,
    marker.release && `release ${marker.release.status}`,
    marker.deployment && `deployment ${marker.deployment.status}`,
  ].filter(Boolean).join(', ') || 'No linked PR, checks, release, or deployment';
}

function GraphLegend() {
  return (
    <>
      <ul className="release-graph-legend" aria-label="Graph state markers">
        <li><span className="graph-key graph-key-pr" aria-hidden="true" />Pull request</li>
        <li><span className="graph-key graph-key-checks" aria-hidden="true" />Checks</li>
        <li><span className="graph-key graph-key-release" aria-hidden="true" />Release</li>
        <li><span className="graph-key graph-key-deployment" aria-hidden="true" />Deployment</li>
      </ul>
      <p className="release-legend-note">Marker shapes show record type; colour follows the status shown in the linked records.</p>
    </>
  );
}

function GitGraphView({ graph, data }: { graph: GitGraph; data: ReleaseView }) {
  if (graph.branches.length === 0) {
    return <p className="release-feedback">No branches or commits were returned by GitHub.</p>;
  }
  const positions = new Map(graph.commits.map((commit, index) => [commit.sha, index]));
  const width = Math.max(720, 188 + graph.commits.length * 64);
  const height = Math.max(66, graph.branches.length * 48 + 20);
  const laneY = (index: number) => 26 + index * 48;
  const commitX = (sha: string) => 164 + (positions.get(sha) ?? 0) * 64;

  return (
    <>
      <GraphLegend />
      <div className="release-graph-scroll" role="region" aria-label="Scrollable commit graph" tabIndex={0}>
        <svg
          className="release-graph"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          style={{ width, height }}
          role="group"
          aria-label={`${graph.branches.length} ${graph.branches.length === 1 ? 'branch' : 'branches'} and ${graph.commits.length} ${graph.commits.length === 1 ? 'commit' : 'commits'}, ordered by commit time`}
        >
          {graph.branches.map((branch, lane) => {
            const ordered = [...branch.commits].reverse().filter((sha) => positions.has(sha));
            const points = ordered.map((sha) => `${commitX(sha)},${laneY(lane)}`).join(' L ');
            const start = ordered.length > 0 ? `M ${points}` : `M 164,${laneY(lane)}`;
            const path = ordered.length > 0 ? `${start} H ${width - 24}` : `${start} H ${width - 24}`;
            return (
              <g key={branch.name} className="release-graph-lane">
                <title>{branch.name}</title>
                <text x="8" y={laneY(lane) + 4} textLength="138" lengthAdjust="spacingAndGlyphs">{branch.name}</text>
                <path d={path} />
                {branch.commits.map((sha) => {
                  const commit = graph.commits.find((item) => item.sha === sha);
                  if (!commit) return null;
                  const x = commitX(sha);
                  const y = laneY(lane);
                  const marker = markerFor(sha, data);
                  const description = markerDescription(marker);
                  const ariaLabel = `Commit ${shortSha(sha)}: ${commit.message}; ${commit.author}; ${formatDate(commit.committedAt)}; ${description}`;
                  const href = `https://github.com/${repositoryPath(data.project.repo)}/commit/${encodeURIComponent(sha)}`;
                  return (
                    <g key={`${branch.name}-${sha}`}>
                      <a href={href} target="_blank" rel="noreferrer" aria-label={ariaLabel}>
                        <title>{ariaLabel}</title>
                        <circle className="graph-hit-target" cx={x} cy={y} r="22" />
                        <circle className="graph-commit" cx={x} cy={y} r="6" />
                      </a>
                      {marker.pullRequest && <circle className={`graph-marker graph-marker-pr state-${marker.pullRequest.state}`} cx={x - 8} cy={y - 9} r="3.5" />}
                      {marker.checks && <rect className={`graph-marker graph-marker-checks state-${marker.checks}`} x={x + 4.5} y={y - 12.5} width="7" height="7" rx="1" />}
                      {marker.release && <path className={`graph-marker graph-marker-release state-${marker.release.status}`} d={`M ${x - 8} ${y + 5} l 4 4 -4 4 -4 -4 Z`} />}
                      {marker.deployment && <circle className={`graph-marker graph-marker-deployment state-${marker.deployment.status}`} cx={x + 8} cy={y + 9} r="3.5" />}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      {graph.truncated && <p className="release-freshness">Showing a bounded recent graph: branch or commit history was truncated.</p>}
    </>
  );
}

function StatusLabel({ state, children }: { state: string; children: string }) {
  return <span className={`release-status state-${state.replaceAll(' ', '-')}`}>{children}</span>;
}

export function ReleasePage({ backendUrl, getAccessToken }: AreaProps) {
  const { projectId, releaseId } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<ReleaseView | null>(null);
  const [result, setResult] = useState<{
    projectId: string | null;
    status: 'loading' | 'refreshing' | 'ready' | 'error';
    message?: string;
  }>({ projectId: null, status: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);
  const currentView = view?.project.id === projectId ? view : null;

  useEffect(() => {
    const controller = new AbortController();
    const requestKey = projectId ?? '';
    const handleError = (cause: unknown) => {
      if (!controller.signal.aborted) {
        setResult({
          projectId: requestKey,
          status: 'error',
          message: cause instanceof Error ? cause.message : 'Release data could not be loaded. Try again.',
        });
      }
    };
    if (!backendUrl) {
      void Promise.resolve().then(() => handleError(new Error('Release data is unavailable until the backend is deployed.')));
    } else if (!projectId || !/^[1-9]\d{0,18}$/u.test(projectId)) {
      void Promise.resolve().then(() => handleError(new Error('This project is not available.')));
    } else {
      void fetchReleaseView(backendUrl, projectId, getAccessToken, controller.signal).then((value) => {
        if (controller.signal.aborted) return;
        setView(value);
        setResult({ projectId, status: 'ready' });
      }).catch(handleError);
    }
    return () => controller.abort();
  }, [backendUrl, getAccessToken, projectId, requestVersion]);

  const data = currentView;
  const refreshing = result.projectId === projectId && result.status === 'refreshing';
  const loading = !data && (
    result.projectId !== projectId || result.status === 'loading' || result.status === 'refreshing'
  );
  const error = result.projectId === projectId && result.status === 'error' ? result.message ?? '' : '';
  const refresh = () => {
    setResult({ projectId: projectId ?? null, status: data ? 'refreshing' : 'loading' });
    setRequestVersion((current) => current + 1);
  };
  if (!data && loading) {
    return <section className="release-page" aria-labelledby="release-heading"><h1 id="release-heading">Project releases</h1><p role="status">Loading releases…</p></section>;
  }
  if (!data && error) {
    return (
      <section className="release-page" aria-labelledby="release-heading">
        <h1 id="release-heading">Project releases</h1>
        <div className="release-feedback" role="alert">
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={refresh}>Retry</button>
        </div>
        <Link className="home-link" to="/factory/projects">Back to projects</Link>
      </section>
    );
  }
  if (!data) return null;
  const repositoryUrl = `https://github.com/${repositoryPath(data.project.repo)}`;
  const selectedRelease = releaseId ? data.releases.find((release) => release.id === releaseId) : undefined;
  const releaseRuns = (release: Release) => data.workflowRuns.filter((run) => run.releaseId === release.id);
  const releaseDeployments = (release: Release) => data.deployments.filter((deployment) => deployment.releaseId === release.id);
  const releasePullRequests = (release: Release) => {
    const runNumbers = new Set(releaseRuns(release).flatMap((run) => run.pullRequestNumber === null ? [] : [run.pullRequestNumber]));
    return data.pullRequests.filter((pr) => pr.headSha.toLowerCase() === release.sha.toLowerCase() || runNumbers.has(pr.number));
  };
  const releaseTasks = (release: Release) => {
    const runTasks = releaseRuns(release).flatMap((run) => run.taskId ? [run.taskId] : []);
    const prTasks = releasePullRequests(release).flatMap((pr) => pr.taskId ? [pr.taskId] : []);
    return [...new Set([...runTasks, ...prTasks])];
  };

  return (
    <section className="release-page" aria-labelledby="release-heading">
      <div className="release-page-header">
        <div>
          <Link className="release-back-link" to="/factory/projects">Back to projects</Link>
          <h1 id="release-heading">{data.project.name} releases</h1>
          <p><a href={repositoryUrl} target="_blank" rel="noreferrer">{data.project.repo}</a> · default branch <code>{data.project.defaultBranch}</code></p>
        </div>
        <button className="secondary-button" type="button" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh releases and graph'}
        </button>
      </div>
      {error && <p className="release-feedback" role="status">{error} Showing the last loaded records.</p>}

      <section className="release-section" aria-labelledby="graph-heading">
        <div className="release-section-heading">
          <div>
            <h2 id="graph-heading">Git history</h2>
            <p>Branches and recent commits are fetched from GitHub when this view is opened or refreshed.</p>
          </div>
          {data.graph && <p className="release-freshness">Fetched {formatDate(data.graph.fetchedAt)}</p>}
        </div>
        {!data.graph
          ? <p className="release-feedback" role="status">The GitHub graph is unavailable. Release records are still shown; refresh to try again.</p>
          : <GitGraphView graph={data.graph} data={data} />}
      </section>

      {releaseId && (
        <section className="release-section selected-release" aria-labelledby="selected-release-heading">
          {selectedRelease ? (
            <>
              <h2 id="selected-release-heading">Release {selectedRelease.version}</h2>
              <dl className="release-details">
                <div><dt>Status</dt><dd><StatusLabel state={selectedRelease.status}>{selectedRelease.status}</StatusLabel></dd></div>
                <div><dt>Commit</dt><dd><a href={`${repositoryUrl}/commit/${encodeURIComponent(selectedRelease.sha)}`} target="_blank" rel="noreferrer"><code>{shortSha(selectedRelease.sha)}</code></a></dd></div>
                <div><dt>Created</dt><dd>{formatDate(selectedRelease.createdAt)}</dd></div>
                <div><dt>Released</dt><dd>{formatDate(selectedRelease.releasedAt)}</dd></div>
              </dl>
              <RelatedReleaseItems
                release={selectedRelease}
                repositoryUrl={repositoryUrl}
                runs={releaseRuns(selectedRelease)}
                deployments={releaseDeployments(selectedRelease)}
                pullRequests={releasePullRequests(selectedRelease)}
                taskIds={releaseTasks(selectedRelease)}
              />
              <button className="secondary-button" type="button" onClick={() => navigate(`/factory/projects/${projectId}/releases`)}>
                Close release details
              </button>
            </>
          ) : (
            <>
              <h2 id="selected-release-heading">Release not found</h2>
              <p>This release is not present in the current project records.</p>
            </>
          )}
        </section>
      )}

      <section className="release-section" aria-labelledby="releases-heading">
        <h2 id="releases-heading">Releases</h2>
        {data.releases.length === 0
          ? <p className="release-feedback">No release has been recorded for this project yet. Releases appear after a default-branch push is received by the GitHub webhook.</p>
          : (
            <ul className="release-record-list">
              {data.releases.map((release) => (
                <li key={release.id} className="release-record">
                  <div className="release-record-title">
                    <Link to={`/factory/projects/${projectId}/releases/${release.id}`}>Build {release.version}</Link>
                    <StatusLabel state={release.status}>{release.status}</StatusLabel>
                  </div>
                  <dl className="release-details">
                    <div><dt>Commit</dt><dd><a href={`${repositoryUrl}/commit/${encodeURIComponent(release.sha)}`} target="_blank" rel="noreferrer"><code>{shortSha(release.sha)}</code></a></dd></div>
                    <div><dt>Created</dt><dd>{formatDate(release.createdAt)}</dd></div>
                    <div><dt>Released</dt><dd>{formatDate(release.releasedAt)}</dd></div>
                    <div><dt>Workflow runs</dt><dd>{releaseRuns(release).length}</dd></div>
                    <div><dt>Deployments</dt><dd>{releaseDeployments(release).length}</dd></div>
                    <div><dt>Linked tasks</dt><dd>{releaseTasks(release).length}</dd></div>
                  </dl>
                  <RelatedReleaseItems
                    release={release}
                    repositoryUrl={repositoryUrl}
                    runs={releaseRuns(release)}
                    deployments={releaseDeployments(release)}
                    pullRequests={releasePullRequests(release)}
                    taskIds={releaseTasks(release)}
                  />
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="release-section" aria-labelledby="runs-heading">
        <h2 id="runs-heading">Workflow runs</h2>
        {data.workflowRuns.length === 0
          ? <p className="release-feedback">No workflow runs have been recorded for this project.</p>
          : (
            <ul className="release-run-list">
              {data.workflowRuns.map((run) => (
                <li key={run.id}>
                  <div className="release-record-title">
                    <a href={linkedRunUrl(repositoryUrl, run.id)} target="_blank" rel="noreferrer">{run.workflow}</a>
                    <StatusLabel state={run.conclusion ?? run.status}>{runStatus(run)}</StatusLabel>
                  </div>
                  <dl className="release-details">
                    <div><dt>Trigger</dt><dd>{run.trigger}</dd></div>
                    <div><dt>Duration</dt><dd>{formatDuration(run.startedAt, run.completedAt)}</dd></div>
                    <div><dt>Commit</dt><dd><a href={`${repositoryUrl}/commit/${encodeURIComponent(run.headSha)}`} target="_blank" rel="noreferrer"><code>{shortSha(run.headSha)}</code></a></dd></div>
                    {run.pullRequestNumber !== null && <div><dt>Pull request</dt><dd><a href={`${repositoryUrl}/pull/${run.pullRequestNumber}`} target="_blank" rel="noreferrer">#{run.pullRequestNumber}</a></dd></div>}
                    {run.taskId && <div><dt>Task</dt><dd><Link to={`/factory/tasks/${run.taskId}`}>Task #{run.taskId}</Link></dd></div>}
                  </dl>
                  {run.conclusion === 'failure' && (
                    <a className="release-log-link" href={linkedRunUrl(repositoryUrl, run.id)} target="_blank" rel="noreferrer">Open failing log on GitHub</a>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="release-section" aria-labelledby="deployments-heading">
        <h2 id="deployments-heading">Deployments</h2>
        {data.deployments.length === 0
          ? <p className="release-feedback">No deployments have been recorded for this project.</p>
          : (
            <ul className="release-deployment-list">
              {data.deployments.map((deployment) => {
                const release = data.releases.find((item) => item.id === deployment.releaseId);
                return (
                  <li key={deployment.id}>
                    <div className="release-record-title">
                      <span>{deployment.environment}</span>
                      <StatusLabel state={deployment.status}>{deploymentState(deployment.status)}</StatusLabel>
                    </div>
                    <dl className="release-details">
                      <div><dt>Time</dt><dd>{formatDate(deployment.at)}</dd></div>
                      {release && <div><dt>Release</dt><dd><Link to={`/factory/projects/${projectId}/releases/${release.id}`}>Build {release.version}</Link></dd></div>}
                    </dl>
                    <a href={`${repositoryUrl}/deployments/${encodeURIComponent(deployment.environment)}`} target="_blank" rel="noreferrer">Open deployment on GitHub</a>
                  </li>
                );
              })}
            </ul>
          )}
      </section>
    </section>
  );
}

export function ReleaseRedirectPage({ backendUrl, getAccessToken }: AreaProps) {
  const { releaseId } = useParams();
  const navigate = useNavigate();
  const [lookup, setLookup] = useState<{ releaseId: string | null; status: 'loading' | 'error'; message?: string }>({
    releaseId: null,
    status: 'loading',
  });
  const [requestVersion, setRequestVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const handleError = (cause: unknown) => {
      if (!controller.signal.aborted) {
        setLookup({
          releaseId: releaseId ?? '',
          status: 'error',
          message: cause instanceof Error ? cause.message : 'Release data could not be loaded. Try again.',
        });
      }
    };
    if (!backendUrl) {
      void Promise.resolve().then(() => handleError(new Error('Release data is unavailable until the backend is deployed.')));
    } else if (!releaseId || !/^[1-9]\d{0,18}$/u.test(releaseId)) {
      void Promise.resolve().then(() => handleError(new Error('This release is not available.')));
    } else {
      void fetchReleaseProjectId(backendUrl, releaseId, getAccessToken, controller.signal).then((projectId) => {
        if (!controller.signal.aborted) {
          navigate(`/factory/projects/${projectId}/releases/${releaseId}`, { replace: true });
        }
      }).catch(handleError);
    }
    return () => controller.abort();
  }, [backendUrl, getAccessToken, navigate, releaseId, requestVersion]);

  const loading = lookup.releaseId !== releaseId || lookup.status === 'loading';
  return (
    <section className="release-page" aria-labelledby="release-heading">
      <h1 id="release-heading">Opening release</h1>
      {loading
        ? <p role="status">Loading release…</p>
        : (
          <div className="release-feedback" role="alert">
            <p>{lookup.message}</p>
            <button className="secondary-button" type="button" onClick={() => {
              setLookup({ releaseId: releaseId ?? null, status: 'loading' });
              setRequestVersion((current) => current + 1);
            }}>Retry</button>
          </div>
        )}
      <Link className="home-link" to="/factory/projects">Back to projects</Link>
    </section>
  );
}

function RelatedReleaseItems({ release, repositoryUrl, runs, deployments, pullRequests, taskIds }: {
  release: Release;
  repositoryUrl: string;
  runs: WorkflowRun[];
  deployments: Deployment[];
  pullRequests: PullRequest[];
  taskIds: string[];
}) {
  return (
    <div className="release-related">
      <div>
        <h3>Workflow runs</h3>
        {runs.length ? (
          <ul>{runs.map((run) => <li key={run.id}><a href={linkedRunUrl(repositoryUrl, run.id)} target="_blank" rel="noreferrer">{run.workflow} · {runStatus(run)}</a></li>)}</ul>
        ) : <p>No workflow runs are linked to this release.</p>}
      </div>
      <div>
        <h3>Deployments</h3>
        {deployments.length ? (
          <ul>{deployments.map((deployment) => <li key={deployment.id}>{deployment.environment} · {deploymentState(deployment.status)} · {formatDate(deployment.at)}</li>)}</ul>
        ) : <p>No deployments are linked to this release.</p>}
      </div>
      <div>
        <h3>Pull requests and tasks</h3>
        {pullRequests.length || taskIds.length ? (
          <ul>
            {pullRequests.map((pr) => <li key={pr.id}><a href={`${repositoryUrl}/pull/${pr.number}`} target="_blank" rel="noreferrer">PR #{pr.number} · {pr.state} · checks {pr.checks}</a></li>)}
            {taskIds.map((taskId) => <li key={taskId}><Link to={`/factory/tasks/${taskId}`}>Task #{taskId}</Link></li>)}
          </ul>
        ) : <p>No linked pull requests or tasks were recorded for this release.</p>}
      </div>
      <span className="visually-hidden">Release SHA {release.sha}</span>
    </div>
  );
}

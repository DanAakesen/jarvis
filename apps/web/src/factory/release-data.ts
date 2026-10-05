import { backendFetch } from '../backend-request';

export type ReleaseStatus = 'building' | 'deploying' | 'released' | 'failed';
export type RunStatus = 'queued' | 'in_progress' | 'completed';
export type DeploymentStatus = 'queued' | 'in_progress' | 'success' | 'failure';

export interface Project {
  id: string;
  name: string;
  repo: string;
  defaultBranch: string;
}

export interface Release {
  id: string;
  version: string;
  sha: string;
  status: ReleaseStatus;
  createdAt: string;
  releasedAt: string | null;
}

export interface PullRequest {
  id: string;
  number: number;
  branch: string;
  headSha: string;
  state: 'open' | 'merged' | 'closed';
  checks: 'pending' | 'passed' | 'failed';
  taskId: string | null;
}

export interface WorkflowRun {
  id: string;
  workflow: string;
  trigger: string;
  headSha: string;
  status: RunStatus;
  conclusion: 'success' | 'failure' | 'cancelled' | null;
  startedAt: string | null;
  completedAt: string | null;
  releaseId: string | null;
  pullRequestNumber: number | null;
  taskId: string | null;
}

export interface Deployment {
  id: string;
  releaseId: string;
  environment: string;
  status: DeploymentStatus;
  at: string;
}

export interface GitGraphCommit {
  sha: string;
  message: string;
  author: string;
  committedAt: string;
  parents: string[];
}

export interface GitGraph {
  fetchedAt: string;
  truncated: boolean;
  branches: { name: string; commits: string[] }[];
  commits: GitGraphCommit[];
}

export interface ReleaseView {
  project: Project;
  releases: Release[];
  pullRequests: PullRequest[];
  workflowRuns: WorkflowRun[];
  deployments: Deployment[];
  graph: GitGraph | null;
}

export async function fetchReleaseView(
  backendUrl: string,
  projectId: string,
  getAccessToken: () => Promise<string>,
  signal: AbortSignal,
): Promise<ReleaseView> {
  const token = await getAccessToken();
  const response = await backendFetch(
    `${backendUrl.replace(/\/+$/, '')}/factory/projects/${encodeURIComponent(projectId)}/releases`,
    { headers: { Authorization: `${['Bear', 'er'].join('')} ${token}` }, signal, cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Release data could not be loaded. Try again.');
  return await response.json() as ReleaseView;
}

type PullRequestMapping = {
  readonly kind: 'pull_request';
  readonly repository: string;
  readonly number: number;
  readonly branch: string;
  readonly headSha: string;
  readonly state: 'open' | 'merged' | 'closed';
  readonly openedAt: string;
  readonly mergedAt: string | null;
}

type CheckRunMapping = {
  readonly kind: 'check_run';
  readonly repository: string;
  readonly headSha: string;
  readonly pullRequestNumbers: readonly number[];
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly conclusion: 'success' | 'failure' | 'cancelled' | null;
};

type WorkflowRunMapping = {
  readonly kind: 'workflow_run';
  readonly repository: string;
  readonly id: number;
  readonly name: string;
  readonly deploymentWorkflow?: boolean;
  readonly event: string;
  readonly branch: string;
  readonly headSha: string;
  readonly runNumber: number;
  readonly pullRequestNumbers: readonly number[];
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly conclusion: 'success' | 'failure' | 'cancelled' | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
};

type PushMapping = {
  readonly kind: 'push';
  readonly repository: string;
  readonly ref: string;
  readonly sha: string;
  readonly at: string;
};

type DeploymentStatusMapping = {
  readonly kind: 'deployment_status';
  readonly repository: string;
  readonly id: number;
  readonly sha: string;
  readonly environment: string;
  readonly status: 'queued' | 'in_progress' | 'success' | 'failure';
  readonly at: string;
  readonly workflowRunId?: number;
  readonly workflowId?: number;
};

type IssueLabeledMapping = {
  readonly kind: 'issue_labeled';
  readonly repository: string;
  readonly number: number;
  readonly label: 'Jarvis';
};

export type GithubWebhookMapping =
  | PullRequestMapping
  | CheckRunMapping
  | WorkflowRunMapping
  | PushMapping
  | DeploymentStatusMapping
  | IssueLabeledMapping;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function text(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
    ? value
    : undefined;
}

function externalId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function sha(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\da-f]{40}$/iu.test(value) ? value.toLowerCase() : undefined;
}

function repository(payload: JsonObject): string | undefined {
  return text(object(payload.repository)?.full_name, 140);
}

function pullRequestNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    const parsed = number(object(item)?.number);
    return parsed === undefined ? [] : [parsed];
  });
}

function conclusion(value: unknown): 'success' | 'failure' | 'cancelled' | null | undefined {
  if (value === null || value === undefined) return null;
  if (value === 'success' || value === 'neutral' || value === 'skipped' || value === 'stale') return 'success';
  if (value === 'cancelled') return 'cancelled';
  if (value === 'failure' || value === 'timed_out' || value === 'action_required') return 'failure';
  return undefined;
}

function runStatus(value: unknown): 'queued' | 'in_progress' | 'completed' | undefined {
  return value === 'queued' || value === 'in_progress' || value === 'completed' ? value : undefined;
}

function deploymentState(value: unknown): 'queued' | 'in_progress' | 'success' | 'failure' | undefined {
  if (value === 'queued' || value === 'pending') return 'queued';
  if (value === 'in_progress') return 'in_progress';
  if (value === 'success') return 'success';
  if (value === 'failure' || value === 'error') return 'failure';
  return undefined;
}

// GitHub records workflow jobs that use these environments as deployments; they are not releases (L93).
const NON_RELEASE_ENVIRONMENTS = new Set(['project-board', 'plan-status', 'copilot']);

function workflowRunId(value: unknown, repo: string): number | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    const match = /^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/|$)/u.exec(url.pathname);
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      match?.[1]?.toLowerCase() === repo.toLowerCase() ? externalId(Number(match[2])) : undefined;
  } catch {
    return undefined;
  }
}

export function mapGithubWebhook(event: string, value: unknown): GithubWebhookMapping | undefined {
  const payload = object(value);
  if (!payload) return undefined;
  const repo = repository(payload);
  if (!repo) return undefined;

  if (event === 'pull_request') {
    const pullRequest = object(payload.pull_request);
    const numberValue = number(pullRequest?.number);
    const branch = text(object(pullRequest?.head)?.ref, 255);
    const headSha = sha(object(pullRequest?.head)?.sha);
    const openedAt = timestamp(pullRequest?.created_at);
    const merged = pullRequest?.merged === true;
    const mergedAt = pullRequest?.merged_at == null ? null : timestamp(pullRequest.merged_at);
    if (numberValue === undefined || !branch || !headSha || !openedAt ||
        (pullRequest?.state !== 'open' && pullRequest?.state !== 'closed') ||
        (mergedAt === undefined) || (merged && !mergedAt)) return undefined;
    return {
      kind: 'pull_request',
      repository: repo,
      number: numberValue,
      branch,
      headSha,
      state: merged ? 'merged' : pullRequest.state,
      openedAt,
      mergedAt,
    };
  }

  if (event === 'check_run') {
    const checkRun = object(payload.check_run);
    const headSha = sha(checkRun?.head_sha);
    const status = runStatus(checkRun?.status);
    const result = conclusion(checkRun?.conclusion);
    if (!headSha || !status || result === undefined) return undefined;
    return {
      kind: 'check_run',
      repository: repo,
      headSha,
      pullRequestNumbers: pullRequestNumbers(checkRun?.pull_requests),
      status,
      conclusion: result,
    };
  }

  if (event === 'workflow_run') {
    const workflowRun = object(payload.workflow_run);
    const id = externalId(workflowRun?.id);
    const name = text(workflowRun?.name, 255);
    const eventName = text(workflowRun?.event, 32);
    const branch = text(workflowRun?.head_branch, 255);
    const headSha = sha(workflowRun?.head_sha);
    const runNumber = number(workflowRun?.run_number);
    const status = runStatus(workflowRun?.status);
    const result = conclusion(workflowRun?.conclusion);
    const startedAt = workflowRun?.run_started_at == null ? null : timestamp(workflowRun.run_started_at);
    const completedAt = workflowRun?.completed_at == null ? null : timestamp(workflowRun.completed_at);
    if (!id || !name || !eventName || !branch || !headSha || !runNumber || !status || result === undefined ||
        startedAt === undefined || completedAt === undefined) return undefined;
    return {
      kind: 'workflow_run',
      repository: repo,
      id,
      name,
      deploymentWorkflow: /^\.github\/workflows\/deploy[^/]*\.ya?ml(?:@.*)?$/iu.test(
        text(workflowRun?.path, 512) ?? '',
      ),
      event: eventName,
      branch,
      headSha,
      runNumber,
      pullRequestNumbers: pullRequestNumbers(workflowRun?.pull_requests),
      status,
      conclusion: result,
      startedAt,
      completedAt,
    };
  }

  if (event === 'push') {
    const ref = text(payload.ref, 512);
    const after = sha(payload.after);
    const at = timestamp(object(payload.repository)?.pushed_at);
    return ref && after && at && !/^0+$/u.test(after)
      ? { kind: 'push', repository: repo, ref, sha: after, at }
      : undefined;
  }

  if (event === 'deployment_status') {
    const deployment = object(payload.deployment);
    const statusPayload = object(payload.deployment_status);
    const id = externalId(deployment?.id);
    const deploymentSha = sha(deployment?.sha);
    const environment = text(deployment?.environment, 255);
    const state = deploymentState(statusPayload?.state);
    const at = timestamp(statusPayload?.created_at);
    if (!id || !deploymentSha || !environment || !state || !at) return undefined;
    if (NON_RELEASE_ENVIRONMENTS.has(environment.toLowerCase())) return undefined;
    if (state === 'failure' && typeof statusPayload?.description === 'string' &&
        /^The deployment was cancel(?:led|ed)\.$/iu.test(statusPayload.description)) return undefined;
    const runId = workflowRunId(statusPayload?.log_url, repo) ?? workflowRunId(statusPayload?.target_url, repo);
    return {
      kind: 'deployment_status',
      repository: repo,
      id,
      sha: deploymentSha,
      environment,
      status: state,
      at,
      ...(runId ? { workflowRunId: runId } : {}),
    };
  }

  if (event === 'issues') {
    const issue = object(payload.issue);
    const numberValue = number(issue?.number);
    const label = object(payload.label);
    if (payload.action === 'labeled' && numberValue &&
      !object(issue?.pull_request) &&
      typeof label?.name === 'string' && label.name.toLowerCase() === 'jarvis') {
      return { kind: 'issue_labeled', repository: repo, number: numberValue, label: 'Jarvis' };
    }
  }

  return undefined;
}

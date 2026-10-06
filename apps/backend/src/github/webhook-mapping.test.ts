import { describe, expect, it } from 'vitest';
import { mapGithubWebhook } from './webhook-mapping.js';

const sha = 'a'.repeat(40);
const repository = { full_name: 'DanAakesen/jarvis-test-target' };
const timestamp = '2026-10-04T12:00:00.000Z';

describe('GitHub webhook mapping', () => {
  it('copies only the allowlisted pull request fields', () => {
    expect(mapGithubWebhook('pull_request', {
      repository,
      action: 'opened',
      pull_request: {
        number: 42,
        state: 'open',
        merged: false,
        merged_at: null,
        created_at: timestamp,
        head: { ref: 'feature/change', sha },
        base: { ref: 'main' },
        title: 'not persisted',
        body: 'not persisted',
      },
      installation: { token: 'not persisted' },
    })).toEqual({
      kind: 'pull_request',
      repository: repository.full_name,
      number: 42,
      branch: 'feature/change',
      headSha: sha,
      state: 'open',
      openedAt: timestamp,
      mergedAt: null,
    });
  });

  it('maps check, workflow, push and deployment fields without retaining the payload', () => {
    expect(mapGithubWebhook('check_run', {
      repository,
      check_run: { head_sha: sha, status: 'completed', conclusion: 'success', pull_requests: [{ number: 42 }] },
    })).toMatchObject({ kind: 'check_run', repository: repository.full_name, headSha: sha, status: 'completed' });

    expect(mapGithubWebhook('workflow_run', {
      repository,
      workflow_run: {
        id: 1_900_000_000_001,
        name: 'CI',
        event: 'pull_request',
        head_branch: 'feature/change',
        head_sha: sha,
        run_number: 7,
        status: 'completed',
        conclusion: 'success',
        run_started_at: timestamp,
        completed_at: timestamp,
        pull_requests: [{ number: 42 }],
      },
    })).toMatchObject({
      kind: 'workflow_run', id: 1_900_000_000_001, name: 'CI', headSha: sha, runNumber: 7, pullRequestNumbers: [42],
    });

    expect(mapGithubWebhook('push', {
      repository: { ...repository, pushed_at: timestamp },
      ref: 'refs/heads/main',
      after: sha,
    })).toMatchObject({ kind: 'push', repository: repository.full_name, ref: 'refs/heads/main', sha });

    expect(mapGithubWebhook('deployment_status', {
      repository,
      deployment: { id: 1_900_000_000_002, sha, environment: 'production' },
      deployment_status: { state: 'success', created_at: timestamp },
    })).toMatchObject({
      kind: 'deployment_status', id: 1_900_000_000_002, sha, environment: 'production', status: 'success', at: timestamp,
    });
  });

  it('ignores deployment statuses from non-release workflow environments', () => {
    for (const environment of ['project-board', 'Project-Board', 'plan-status', 'copilot', 'Copilot']) {
      expect(mapGithubWebhook('deployment_status', {
        repository,
        deployment: { id: 1_900_000_000_003, sha, environment },
        deployment_status: { state: 'failure', created_at: timestamp },
      })).toBeUndefined();
    }
  });

  it.each([
    ['deploy.yml', true],
    ['deploy-production.yml', true],
    ['deploy.yaml', true],
    ['project-board.yml', false],
    ['plan-status.yml', false],
    ['ci.yml', false],
    ['runner-deploy.yml', false],
  ])('classifies deployments by workflow file, not display name: %s', (file, deploymentWorkflow) => {
    expect(mapGithubWebhook('workflow_run', {
      repository,
      workflow_run: {
        id: 123, name: 'Deploy', path: `.github/workflows/${file}`, event: 'push',
        head_branch: 'main', head_sha: sha, run_number: 1, status: 'completed', conclusion: 'failure',
      },
    })).toMatchObject({ kind: 'workflow_run', deploymentWorkflow });
  });

  it('keeps cancelled deploy workflow runs non-failing', () => {
    expect(mapGithubWebhook('workflow_run', {
      repository,
      workflow_run: {
        id: 123, name: 'Deploy', path: '.github/workflows/deploy.yml', event: 'push',
        head_branch: 'main', head_sha: sha, run_number: 1, status: 'completed', conclusion: 'cancelled',
      },
    })).toMatchObject({ kind: 'workflow_run', deploymentWorkflow: true, conclusion: 'cancelled' });
  });

  it.each(['cancelled', 'canceled'])('ignores GitHub deployment errors caused by %s jobs', (word) => {
    expect(mapGithubWebhook('deployment_status', {
      repository,
      deployment: { id: 123, sha, environment: 'production' },
      deployment_status: { state: 'error', description: `The deployment was ${word}.`, created_at: timestamp },
    })).toBeUndefined();
  });

  it.each([
    [`https://github.com/${repository.full_name}/actions/runs/123/job/456`, 123],
    ['https://github.com/another/repo/actions/runs/123/job/456', undefined],
    [`https://example.com/${repository.full_name}/actions/runs/123`, undefined],
    ['not a URL', undefined],
  ])('links real deployment failures to repository-scoped workflow runs: %s', (logUrl, runId) => {
    const mapping = mapGithubWebhook('deployment_status', {
      repository,
      deployment: { id: 123, sha, environment: 'production' },
      deployment_status: { state: 'error', created_at: timestamp, log_url: logUrl },
    });
    expect(mapping).toMatchObject({ kind: 'deployment_status', status: 'failure' });
    expect(mapping && 'workflowRunId' in mapping ? mapping.workflowRunId : undefined).toBe(runId);
  });

  it('ignores malformed, deleted-branch and unconfigured release event payloads', () => {
    expect(mapGithubWebhook('pull_request', { repository, pull_request: {} })).toBeUndefined();
    expect(mapGithubWebhook('push', {
      repository: { ...repository, pushed_at: timestamp },
      ref: 'refs/heads/main',
      after: '0'.repeat(40),
    })).toBeUndefined();
    expect(mapGithubWebhook('release', { repository, release: { id: 1 } })).toBeUndefined();
  });
});

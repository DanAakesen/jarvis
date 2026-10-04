import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type {
  DeploymentRecord, PullRequestRecord, ReleaseRecord, ReleaseViewStore, WorkflowRunRecord,
} from '../factory/release-view.js';

interface ReleaseRow extends Omit<ReleaseRecord, 'createdAt' | 'releasedAt'> {
  createdAt: Date;
  releasedAt: Date | null;
}

interface PullRequestRow extends PullRequestRecord {
  taskId: string | null;
}

interface WorkflowRunRow extends Omit<WorkflowRunRecord, 'startedAt' | 'completedAt'> {
  startedAt: Date | null;
  completedAt: Date | null;
}

interface DeploymentRow extends Omit<DeploymentRecord, 'at'> {
  at: Date;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function createReleaseViewStore(pool: sql.ConnectionPool): ReleaseViewStore {
  return {
    async read(projectId) {
      const requests = () => databaseReadRequest(pool).input('projectId', sql.BigInt, BigInt(projectId));
      const [releases, pullRequests, workflowRuns, deployments] = await Promise.all([
        requests().query<ReleaseRow>(`SELECT TOP (50) CONVERT(varchar(19), id) AS id, version, sha, status,
          created_at AS createdAt, released_at AS releasedAt
          FROM dbo.releases WHERE project_id = @projectId ORDER BY created_at DESC, id DESC;`),
        requests().query<PullRequestRow>(`SELECT TOP (100) CONVERT(varchar(19), pr.id) AS id, pr.number,
          pr.branch, pr.head_sha AS headSha, pr.state, pr.checks,
          CONVERT(varchar(19), pr.task_id) AS taskId
          FROM dbo.pull_requests AS pr
          WHERE pr.project_id = @projectId ORDER BY pr.opened_at DESC, pr.id DESC;`),
        requests().query<WorkflowRunRow>(`SELECT TOP (100) CONVERT(varchar(19), wr.github_run_id) AS id,
          wr.workflow, wr.[trigger] AS [trigger], wr.head_sha AS headSha, wr.status, wr.conclusion,
          wr.started_at AS startedAt, wr.completed_at AS completedAt,
          CONVERT(varchar(19), wr.release_id) AS releaseId, pr.number AS pullRequestNumber,
          CONVERT(varchar(19), pr.task_id) AS taskId
          FROM dbo.workflow_runs AS wr
          LEFT JOIN dbo.pull_requests AS pr ON pr.id = wr.pull_request_id
          WHERE wr.project_id = @projectId
          ORDER BY COALESCE(wr.started_at, wr.completed_at) DESC, wr.github_run_id DESC;`),
        requests().query<DeploymentRow>(`SELECT TOP (100) CONVERT(varchar(19), d.github_deployment_id) AS id,
          CONVERT(varchar(19), d.release_id) AS releaseId, d.environment, d.status, d.at
          FROM dbo.deployments AS d
          INNER JOIN dbo.releases AS r ON r.id = d.release_id
          WHERE r.project_id = @projectId ORDER BY d.at DESC, d.github_deployment_id DESC;`),
      ]);

      return {
        releases: releases.recordset.map((release) => ({
          ...release,
          createdAt: release.createdAt.toISOString(),
          releasedAt: iso(release.releasedAt),
        })),
        pullRequests: pullRequests.recordset,
        workflowRuns: workflowRuns.recordset.map((run) => ({
          ...run,
          startedAt: iso(run.startedAt),
          completedAt: iso(run.completedAt),
        })),
        deployments: deployments.recordset.map((deployment) => ({
          ...deployment,
          at: deployment.at.toISOString(),
        })),
      };
    },
  };
}

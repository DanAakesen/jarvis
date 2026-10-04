import sql from 'mssql';

export interface FailedCheckRun {
  readonly repository: string;
  readonly runId: number;
  readonly workflow: string;
  readonly pullRequestNumber: number;
  readonly taskId: string;
  readonly taskState: string;
  readonly failedRunCount: number;
  readonly logArtifact: string | null;
}

export type ChecksLoopEventType =
  | 'checks_retry_started'
  | 'checks_retry_failed'
  | 'checks_attempts_exhausted'
  | 'steered';

export interface ChecksLoopStore {
  getFailedRun(repository: string, runId: number): Promise<FailedCheckRun | null>;
  listPendingFailedRuns(limit: number): Promise<FailedCheckRun[]>;
  hasEvent(taskId: string, runId: number, type: ChecksLoopEventType): Promise<boolean>;
  setLogArtifact(repository: string, runId: number, name: string): Promise<void>;
}

interface FailedCheckRunRow {
  repository: string;
  runId: string;
  workflow: string;
  pullRequestNumber: number;
  taskId: string;
  taskState: string;
  failedRunCount: number;
  logArtifact: string | null;
}

const candidateQuery = `SELECT TOP (@limit)
    project.repo AS repository,
    CAST(run.github_run_id AS varchar(20)) AS runId,
    run.workflow,
    pullRequest.number AS pullRequestNumber,
    CAST(task.id AS varchar(19)) AS taskId,
    task.state AS taskState,
    CAST((
      SELECT COUNT(DISTINCT failedRun.id)
      FROM dbo.workflow_runs AS failedRun
      INNER JOIN dbo.pull_requests AS failedPullRequest
        ON failedPullRequest.id = failedRun.pull_request_id
      WHERE failedPullRequest.task_id = task.id
        AND failedPullRequest.state = N'open'
        AND failedRun.[trigger] = N'pull_request'
        AND failedRun.status = N'completed'
        AND failedRun.conclusion = N'failure'
    ) AS int) AS failedRunCount,
    run.log_artifact AS logArtifact
  FROM dbo.workflow_runs AS run
  INNER JOIN dbo.projects AS project ON project.id = run.project_id
  INNER JOIN dbo.pull_requests AS pullRequest ON pullRequest.id = run.pull_request_id
  INNER JOIN dbo.tasks AS task ON task.id = pullRequest.task_id
  WHERE run.[trigger] = N'pull_request'
    AND run.status = N'completed'
    AND run.conclusion = N'failure'
    AND pullRequest.state = N'open'
    AND (@runId IS NULL OR run.github_run_id = @runId)
    AND (@repository IS NULL OR project.repo = @repository)
    AND (@pendingOnly = 0 OR (
      run.log_artifact IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM dbo.task_events AS failedEvent
        WHERE failedEvent.task_id = task.id
          AND failedEvent.type = N'checks_retry_failed'
          AND JSON_VALUE(failedEvent.payload, '$.checkRunId') = CONVERT(nvarchar(20), run.github_run_id)
      )
    ))
  ORDER BY run.completed_at, run.id;`;

const validEventTypes = new Set<ChecksLoopEventType>([
  'checks_retry_started',
  'checks_retry_failed',
  'checks_attempts_exhausted',
  'steered',
]);

function mapRun(row: FailedCheckRunRow): FailedCheckRun {
  const runId = Number(row.runId);
  if (!Number.isSafeInteger(runId) || runId <= 0 ||
    !Number.isSafeInteger(row.failedRunCount) || row.failedRunCount < 1) {
    throw new Error('Failed workflow run record is invalid');
  }
  return {
    repository: row.repository,
    runId,
    workflow: row.workflow,
    pullRequestNumber: row.pullRequestNumber,
    taskId: row.taskId,
    taskState: row.taskState,
    failedRunCount: row.failedRunCount,
    logArtifact: row.logArtifact,
  };
}

async function selectRuns(
  pool: sql.ConnectionPool,
  options: { limit: number; repository?: string; runId?: number; pendingOnly: boolean },
): Promise<FailedCheckRun[]> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('Failed workflow run limit is invalid');
  }
  const request = pool.request()
    .input('limit', sql.Int, options.limit)
    .input('repository', sql.NVarChar(140), options.repository ?? null)
    .input('runId', sql.BigInt, options.runId ?? null)
    .input('pendingOnly', sql.Bit, options.pendingOnly);
  const result = await request.query<FailedCheckRunRow>(candidateQuery);
  return result.recordset.map(mapRun);
}

export function createChecksLoopStore(pool: sql.ConnectionPool): ChecksLoopStore {
  return {
    async getFailedRun(repository, runId) {
      return (await selectRuns(pool, { limit: 1, repository, runId, pendingOnly: false }))[0] ?? null;
    },
    async listPendingFailedRuns(limit) {
      return selectRuns(pool, { limit, pendingOnly: true });
    },
    async hasEvent(taskId, runId, type) {
      if (!validEventTypes.has(type)) throw new Error('Checks loop event type is invalid');
      const marker = `JARVIS_CHECK_RUN_ID=${runId}`;
      const result = await pool.request()
        .input('taskId', sql.BigInt, BigInt(taskId))
        .input('runId', sql.NVarChar(20), String(runId))
        .input('eventType', sql.NVarChar(64), type)
        .input('marker', sql.NVarChar(64), marker)
        .query<{ found: boolean }>(`SELECT CAST(CASE WHEN EXISTS (
          SELECT 1 FROM dbo.task_events
          WHERE task_id = @taskId AND type = @eventType
            AND ((@eventType = N'steered' AND CHARINDEX(@marker, CONVERT(nvarchar(max), payload)) > 0)
              OR (@eventType <> N'steered' AND JSON_VALUE(payload, '$.checkRunId') = @runId))
        ) THEN 1 ELSE 0 END AS bit) AS found;`);
      return result.recordset[0]?.found === true;
    },
    async setLogArtifact(repository, runId, name) {
      if (name.length === 0 || name.length > 1024) throw new Error('Check log artifact name is invalid');
      const result = await pool.request()
        .input('repository', sql.NVarChar(140), repository)
        .input('runId', sql.BigInt, runId)
        .input('name', sql.NVarChar(1024), name)
        .query(`UPDATE run SET log_artifact = @name
          FROM dbo.workflow_runs AS run
          INNER JOIN dbo.projects AS project ON project.id = run.project_id
          WHERE project.repo = @repository AND run.github_run_id = @runId
            AND (run.log_artifact IS NULL OR run.log_artifact = @name);`);
      if ((result.rowsAffected[0] ?? 0) !== 1) throw new Error('Check log reference could not be saved');
    },
  };
}

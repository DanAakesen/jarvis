import { createHash } from 'node:crypto';
import sql from 'mssql';
import type { AlertNotifier, ActivityAlert } from '../alerts.js';
import { notifyAlert } from '../alerts.js';
import { insertActivityAlert } from './alert-store.js';
import type { WebhookDeliveryStore } from '../github/webhook-delivery.js';
import type { GithubWebhookMapping } from '../github/webhook-mapping.js';

function bindNumbers(request: sql.Request, values: readonly number[]): string {
  return values.map((value, index) => {
    const name = `number${index}`;
    request.input(name, sql.Int, value);
    return `@${name}`;
  }).join(', ');
}

async function applyMapping(transaction: sql.Transaction, mapping: GithubWebhookMapping): Promise<ActivityAlert | undefined> {
  const request = new sql.Request(transaction).input('repository', sql.NVarChar(140), mapping.repository);

  if (mapping.kind === 'issue_labeled') return undefined;

  if (mapping.kind === 'pull_request') {
    request
      .input('number', sql.Int, mapping.number)
      .input('branch', sql.NVarChar(255), mapping.branch)
      .input('headSha', sql.Char(40), mapping.headSha)
      .input('state', sql.NVarChar(8), mapping.state)
      .input('openedAt', sql.DateTime2, new Date(mapping.openedAt))
      .input('mergedAt', sql.DateTime2, mapping.mergedAt ? new Date(mapping.mergedAt) : null);
    await request.query(`DECLARE @projectId bigint = (SELECT id FROM dbo.projects WHERE repo = @repository);
      IF @projectId IS NOT NULL
      BEGIN
        DECLARE @taskId bigint = (
          SELECT TOP (1) id FROM dbo.tasks
          WHERE project_id = @projectId AND branch = @branch ORDER BY created_at DESC, id DESC);
        UPDATE dbo.pull_requests SET
          task_id = COALESCE(@taskId, task_id), branch = @branch, head_sha = @headSha,
          state = @state, opened_at = @openedAt, merged_at = @mergedAt
        WHERE project_id = @projectId AND number = @number;
        IF @@ROWCOUNT = 0
          INSERT INTO dbo.pull_requests
            (task_id, project_id, number, branch, head_sha, state, opened_at, merged_at)
          VALUES (@taskId, @projectId, @number, @branch, @headSha, @state, @openedAt, @mergedAt);
      END;`);
    return undefined;
  }

  if (mapping.kind === 'check_run') {
    request
      .input('headSha', sql.Char(40), mapping.headSha)
      .input('checks', sql.NVarChar(8), mapping.status !== 'completed'
        ? 'pending'
        : mapping.conclusion === 'failure' ? 'failed' : mapping.conclusion === 'success' ? 'passed' : 'pending');
    const numbers = bindNumbers(request, mapping.pullRequestNumbers);
    const numberFilter = numbers ? `number IN (${numbers}) OR ` : '';
    await request.query(`DECLARE @projectId bigint = (SELECT id FROM dbo.projects WHERE repo = @repository);
      IF @projectId IS NOT NULL
        UPDATE dbo.pull_requests SET checks = @checks
        WHERE project_id = @projectId AND (${numberFilter}head_sha = @headSha);`);
    return undefined;
  }

  if (mapping.kind === 'push') {
    request
      .input('ref', sql.NVarChar(512), mapping.ref)
      .input('sha', sql.Char(40), mapping.sha)
      .input('at', sql.DateTime2, new Date(mapping.at));
    await request.query(`DECLARE @projectId bigint = (
        SELECT id FROM dbo.projects
        WHERE repo = @repository AND CONCAT(N'refs/heads/', default_branch) = @ref);
      IF @projectId IS NOT NULL
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.releases WITH (UPDLOCK, HOLDLOCK)
          WHERE project_id = @projectId AND sha = @sha)
          INSERT INTO dbo.releases (project_id, version, sha, status, created_at)
          VALUES (@projectId, @sha, @sha, N'building', @at);
      DECLARE @releaseId bigint = (
        SELECT id FROM dbo.releases WHERE project_id = @projectId AND sha = @sha);
      UPDATE dbo.workflow_runs SET release_id = @releaseId
      WHERE project_id = @projectId AND head_sha = @sha AND release_id IS NULL;
    END;`);
    return undefined;
  }

  if (mapping.kind === 'workflow_run') {
    request
      .input('runId', sql.BigInt, mapping.id)
      .input('workflow', sql.NVarChar(255), mapping.name)
      .input('deploymentWorkflow', sql.Bit, mapping.deploymentWorkflow ?? false)
      .input('trigger', sql.NVarChar(32), mapping.event)
      .input('branch', sql.NVarChar(255), mapping.branch)
      .input('headSha', sql.Char(40), mapping.headSha)
      .input('runNumber', sql.Int, mapping.runNumber)
      .input('status', sql.NVarChar(16), mapping.status)
      .input('conclusion', sql.NVarChar(16), mapping.conclusion)
      .input('startedAt', sql.DateTime2, mapping.startedAt ? new Date(mapping.startedAt) : null)
      .input('completedAt', sql.DateTime2, mapping.completedAt ? new Date(mapping.completedAt) : null);
    const numbers = bindNumbers(request, mapping.pullRequestNumbers);
    const numberFilter = numbers ? `number IN (${numbers}) OR ` : '';
    await request.query(`DECLARE @projectId bigint = (SELECT id FROM dbo.projects WHERE repo = @repository);
      IF @projectId IS NOT NULL
      BEGIN
        DECLARE @pullRequestId bigint = (
          SELECT TOP (1) id FROM dbo.pull_requests
          WHERE project_id = @projectId AND (${numberFilter}head_sha = @headSha)
          ORDER BY id DESC);
        DECLARE @releaseId bigint = (
          SELECT id FROM dbo.releases WITH (UPDLOCK, HOLDLOCK)
          WHERE project_id = @projectId AND sha = @headSha);
        IF @releaseId IS NULL AND @workflow = N'Release' AND @trigger = N'push'
          AND EXISTS (SELECT 1 FROM dbo.projects WHERE id = @projectId AND default_branch = @branch)
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM dbo.releases WITH (UPDLOCK, HOLDLOCK)
            WHERE project_id = @projectId AND sha = @headSha)
            INSERT INTO dbo.releases (project_id, version, sha, status, created_at)
            VALUES (@projectId, CONVERT(nvarchar(100), @runNumber), @headSha, N'building',
              COALESCE(@startedAt, SYSUTCDATETIME()));
          SET @releaseId = (
            SELECT id FROM dbo.releases WHERE project_id = @projectId AND sha = @headSha);
        END;
        DECLARE @runChanged bit = 0;
        UPDATE dbo.workflow_runs SET
          workflow = @workflow, [trigger] = @trigger, head_sha = @headSha,
          pull_request_id = COALESCE(@pullRequestId, pull_request_id),
          release_id = COALESCE(@releaseId, release_id),
          status = CASE WHEN status = N'completed' AND @status <> N'completed' THEN status ELSE @status END,
          conclusion = CASE WHEN @status = N'completed' THEN @conclusion ELSE conclusion END,
          started_at = COALESCE(started_at, @startedAt),
          completed_at = COALESCE(@completedAt, completed_at)
        WHERE project_id = @projectId AND github_run_id = @runId
          AND (status <> N'completed' OR @status = N'completed')
          AND (status <> N'completed' OR @status <> N'completed' OR @completedAt IS NULL
            OR completed_at IS NULL OR @completedAt >= completed_at);
        DECLARE @affected int = @@ROWCOUNT;
        IF @affected > 0 SET @runChanged = 1;
        IF @runChanged = 0 AND NOT EXISTS (
          SELECT 1 FROM dbo.workflow_runs WHERE project_id = @projectId AND github_run_id = @runId)
        BEGIN
          INSERT INTO dbo.workflow_runs
            (project_id, github_run_id, workflow, [trigger], head_sha, pull_request_id, release_id,
             status, conclusion, started_at, completed_at)
          VALUES (@projectId, @runId, @workflow, @trigger, @headSha, @pullRequestId, @releaseId,
            @status, @conclusion, @startedAt, @completedAt);
          SET @runChanged = 1;
        END;
        IF @releaseId IS NOT NULL AND @status = N'completed' AND @runChanged = 1
          AND @workflow = N'Release' AND @trigger = N'push'
          AND EXISTS (SELECT 1 FROM dbo.projects WHERE id = @projectId AND default_branch = @branch)
          UPDATE dbo.releases SET version = CONVERT(nvarchar(100), @runNumber) WHERE id = @releaseId;
        IF @releaseId IS NOT NULL AND @status = N'completed' AND @runChanged = 1
          AND @conclusion <> N'cancelled' AND @deploymentWorkflow = 1
          UPDATE dbo.releases SET
            status = CASE WHEN status = N'released' THEN status
              WHEN @conclusion = N'failure' THEN N'failed' ELSE N'building' END
          WHERE id = @releaseId;
      END;`);
    return undefined;
  }

  request
    .input('deploymentId', sql.BigInt, mapping.id)
    .input('sha', sql.Char(40), mapping.sha)
    .input('environment', sql.NVarChar(255), mapping.environment)
    .input('status', sql.NVarChar(16), mapping.status)
    .input('workflowRunId', sql.BigInt, mapping.workflowRunId ?? null)
    .input('at', sql.DateTime2, new Date(mapping.at));
  const previous = await request.query<{ alreadyFailed: boolean }>(
    `DECLARE @alreadyFailed bit = CASE WHEN EXISTS (
      SELECT 1 FROM dbo.deployments WITH (UPDLOCK, HOLDLOCK)
      WHERE github_deployment_id = @deploymentId AND status = N'failure'
    ) OR EXISTS (
      SELECT 1 FROM dbo.deployment_failure_receipts WITH (UPDLOCK, HOLDLOCK)
      WHERE github_deployment_id = @deploymentId
    ) THEN 1 ELSE 0 END;
    DECLARE @projectId bigint = (SELECT id FROM dbo.projects WHERE repo = @repository);
    IF @projectId IS NOT NULL AND @status = N'failure' AND @alreadyFailed = 0 AND NOT EXISTS (
      SELECT 1 FROM dbo.workflow_runs
      WHERE project_id = @projectId AND github_run_id = @workflowRunId AND conclusion = N'cancelled'
    )
      INSERT dbo.deployment_failure_receipts (github_deployment_id) VALUES (@deploymentId);
    DECLARE @releaseId bigint = (
      SELECT id FROM dbo.releases WHERE project_id = @projectId AND sha = @sha);
    IF @releaseId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM dbo.workflow_runs
      WHERE project_id = @projectId AND github_run_id = @workflowRunId AND conclusion = N'cancelled'
    )
    BEGIN
    DECLARE @changed bit = 0;
    UPDATE dbo.deployments SET
      release_id = @releaseId, environment = @environment, status = @status, at = @at
    WHERE github_deployment_id = @deploymentId AND at <= @at;
    DECLARE @affected int = @@ROWCOUNT;
    IF @affected > 0 SET @changed = 1;
    IF @affected = 0 AND NOT EXISTS (
      SELECT 1 FROM dbo.deployments WHERE github_deployment_id = @deploymentId)
    BEGIN
      INSERT INTO dbo.deployments (release_id, github_deployment_id, environment, status, at)
      VALUES (@releaseId, @deploymentId, @environment, @status, @at);
      SET @changed = 1;
    END;
    IF @changed = 1
      UPDATE dbo.releases SET
        status = CASE WHEN @status = N'success' THEN N'released'
          WHEN @status = N'failure' THEN N'failed' ELSE N'deploying' END,
        released_at = CASE WHEN @status = N'success' THEN @at ELSE released_at END
      WHERE id = @releaseId;
  END;
  SELECT @alreadyFailed AS alreadyFailed;`);
  if (mapping.status !== 'failure' || previous.recordset?.[0]?.alreadyFailed) return undefined;
  const project = await new sql.Request(transaction)
    .input('repository', sql.NVarChar(140), mapping.repository)
    .input('deploymentId', sql.BigInt, mapping.id)
    .input('workflowRunId', sql.BigInt, mapping.workflowRunId ?? null)
    .query<{
      projectId: string; releaseId: string | null; workflow: string | null; conclusion: string | null; alerted: boolean;
    }>(
      `DECLARE @projectId bigint = (
        SELECT id FROM dbo.projects WHERE repo = @repository);
      SELECT CAST(@projectId AS varchar(19)) AS projectId,
        CAST((SELECT release_id FROM dbo.deployments WHERE github_deployment_id = @deploymentId)
          AS varchar(19)) AS releaseId,
        workflow, conclusion,
        CAST(CASE WHEN EXISTS (
          SELECT 1 FROM dbo.activity WITH (UPDLOCK, HOLDLOCK)
          WHERE alert_key = CONCAT(N'deployment:', @deploymentId)
            OR alert_key LIKE CONCAT(N'deployment:%:', @deploymentId)
        ) THEN 1 ELSE 0 END AS bit) AS alerted
      FROM (VALUES (1)) AS seed(id)
      LEFT JOIN dbo.workflow_runs ON project_id = @projectId AND github_run_id = @workflowRunId;`);
  const projectId = project.recordset[0]?.projectId;
  if (!projectId || project.recordset[0]?.conclusion === 'cancelled' || project.recordset[0]?.alerted) return undefined;
  const workflow = mapping.workflowId ? `workflow:${mapping.workflowId}` : `environment:${mapping.environment}`;
  const dedupePrefix = `deployment:${projectId}:${createHash('sha256').update(workflow).digest('hex')}:`;
  const alert: ActivityAlert = {
    type: 'deployment_failure',
    dedupeKey: `${dedupePrefix}${mapping.id}`,
    title: `Deployment failed: ${mapping.environment}`,
    link: project.recordset[0]?.releaseId
      ? `release:${project.recordset[0].releaseId}`
      : `project:${projectId}`,
  };
  return await insertActivityAlert(transaction, alert, dedupePrefix) ? alert : undefined;
}

export function createWebhookDeliveryStore(
  pool: sql.ConnectionPool,
  alertNotifier?: AlertNotifier,
): WebhookDeliveryStore {
  return {
    async recordPullRequest(mapping) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        await applyMapping(transaction, mapping);
        await transaction.commit();
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        throw error;
      }
    },
    async record({ deliveryId, event, outcome, mapping }) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      let recordingDelivery = true;
      try {
        await new sql.Request(transaction)
          .input('deliveryId', sql.NVarChar(100), deliveryId)
          .input('event', sql.NVarChar(64), event)
          .input('outcome', sql.NVarChar(8), outcome)
          .query(`DECLARE @receivedAt datetime2(7) = SYSUTCDATETIME();
            INSERT INTO dbo.webhook_deliveries (delivery_id, event, received_at, processed_at, outcome)
            VALUES (@deliveryId, @event, @receivedAt, @receivedAt, @outcome);`);
        recordingDelivery = false;
        const alert = mapping ? await applyMapping(transaction, mapping) : undefined;
        await transaction.commit();
        if (alert) notifyAlert(alertNotifier, alert);
        return true;
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        const number = (error as { number?: unknown }).number;
        if (recordingDelivery && (number === 2601 || number === 2627)) return false;
        throw error;
      }
    },
  };
}

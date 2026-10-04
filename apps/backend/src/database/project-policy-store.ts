import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { ProjectPolicyStore, PolicyPullRequest } from '../github/project-policy.js';

export function createProjectPolicyStore(pool: sql.ConnectionPool): ProjectPolicyStore {
  return {
    async getPullRequest(repository, number) {
      const { recordset } = await databaseReadRequest(pool)
        .input('repository', sql.NVarChar(140), repository)
        .input('number', sql.Int, number)
        .query<PolicyPullRequest>(`SELECT CONVERT(varchar(19), t.id) AS taskId, t.state AS taskState,
          p.repo AS repository, p.policy, pr.number, pr.state, pr.checks, pr.head_sha AS headSha
          FROM dbo.pull_requests AS pr
          INNER JOIN dbo.projects AS p ON p.id = pr.project_id
          INNER JOIN dbo.tasks AS t ON t.id = pr.task_id
          WHERE p.repo = @repository AND pr.number = @number;`);
      return recordset[0] ?? null;
    },
  };
}

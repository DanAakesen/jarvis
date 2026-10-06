import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import { ProjectConflictError, type CreateProject, type Project, type ProjectStore, type UpdateProject } from '../factory/projects.js';

type ProjectRow = Omit<Project, 'id'> & { id: string };

const columns = `CONVERT(varchar(20), id) AS id, name, repo, default_branch, default_agent, policy,
  merge_rules, sandbox_size, tech, max_parallel_tasks, active`;
const insertedColumns = `CONVERT(varchar(20), INSERTED.id) AS id, INSERTED.name, INSERTED.repo,
  INSERTED.default_branch, INSERTED.default_agent, INSERTED.policy, INSERTED.merge_rules,
  INSERTED.sandbox_size, INSERTED.tech, INSERTED.max_parallel_tasks, INSERTED.active`;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'number' in error && ((error as { number?: unknown }).number === 2601 || (error as { number?: unknown }).number === 2627);
}

export function createProjectStore(pool: sql.ConnectionPool, trackedRepositories?: Set<string>): ProjectStore {
  const repositoryKey = (repository: string) => repository.toLowerCase();
  return {
    async list() {
      const { recordset } = await databaseReadRequest(pool).query<ProjectRow>(
        `SELECT ${columns} FROM dbo.projects WHERE active = 1 ORDER BY name, id;`,
      );
      return recordset;
    },
    async create(project: CreateProject) {
      const request = pool.request()
        .input('name', sql.NVarChar(100), project.name)
        .input('repo', sql.NVarChar(140), project.repo)
        .input('defaultBranch', sql.NVarChar(255), project.default_branch)
        .input('defaultAgent', sql.NVarChar(16), project.default_agent)
        .input('policy', sql.NVarChar(32), project.policy)
        .input('mergeRules', sql.NVarChar(4000), project.merge_rules ?? null)
        .input('sandboxSize', sql.NVarChar(8), project.sandbox_size)
        .input('tech', sql.NVarChar(32), project.tech)
        .input('maxParallelTasks', sql.Int, project.max_parallel_tasks ?? 1);
      try {
        const { recordset } = await request.query<ProjectRow>(`INSERT INTO dbo.projects
          (name, repo, default_branch, default_agent, policy, merge_rules, sandbox_size, tech, max_parallel_tasks)
          OUTPUT ${insertedColumns}
          VALUES (@name, @repo, @defaultBranch, @defaultAgent, @policy, @mergeRules,
            @sandboxSize, @tech, @maxParallelTasks);`);
        const project = recordset[0]!;
        trackedRepositories?.add(repositoryKey(project.repo));
        return project;
      } catch (error) {
        if (isUniqueViolation(error)) throw new ProjectConflictError();
        throw error;
      }
    },
    async update(id: string, project: UpdateProject) {
      const request = pool.request().input('id', sql.BigInt, BigInt(id));
      const assignments: string[] = [];
      if (project.name !== undefined) { request.input('name', sql.NVarChar(100), project.name); assignments.push('name = @name'); }
      if (project.repo !== undefined) { request.input('repo', sql.NVarChar(140), project.repo); assignments.push('repo = @repo'); }
      if (project.default_branch !== undefined) { request.input('defaultBranch', sql.NVarChar(255), project.default_branch); assignments.push('default_branch = @defaultBranch'); }
      if (project.default_agent !== undefined) { request.input('defaultAgent', sql.NVarChar(16), project.default_agent); assignments.push('default_agent = @defaultAgent'); }
      if (project.policy !== undefined) { request.input('policy', sql.NVarChar(32), project.policy); assignments.push('policy = @policy'); }
      if (project.merge_rules !== undefined) { request.input('mergeRules', sql.NVarChar(4000), project.merge_rules); assignments.push('merge_rules = @mergeRules'); }
      if (project.sandbox_size !== undefined) { request.input('sandboxSize', sql.NVarChar(8), project.sandbox_size); assignments.push('sandbox_size = @sandboxSize'); }
      if (project.tech !== undefined) { request.input('tech', sql.NVarChar(32), project.tech); assignments.push('tech = @tech'); }
      if (project.max_parallel_tasks !== undefined) { request.input('maxParallelTasks', sql.Int, project.max_parallel_tasks); assignments.push('max_parallel_tasks = @maxParallelTasks'); }
      try {
        const { recordset } = await request        .query<ProjectRow & { previousRepo?: string }>(`UPDATE dbo.projects
          SET ${assignments.join(', ')}
          OUTPUT ${insertedColumns}, DELETED.repo AS previousRepo
          WHERE id = @id AND active = 1;`);
        const row = recordset[0];
        if (!row) return null;
        const previousRepo = row.previousRepo;
        if (previousRepo) trackedRepositories?.delete(repositoryKey(previousRepo));
        trackedRepositories?.add(repositoryKey(row.repo));
        const project = { ...row };
        delete project.previousRepo;
        return project;
      } catch (error) {
        if (isUniqueViolation(error)) throw new ProjectConflictError();
        throw error;
      }
    },
    async archive(id: string) {
      const result = await pool.request().input('id', sql.BigInt, BigInt(id))
        .query<{ repo: string }>('UPDATE dbo.projects OUTPUT DELETED.repo AS repo SET active = 0 WHERE id = @id;');
      const { rowsAffected, recordset } = result;
      const archivedRepository = recordset[0]?.repo;
      if (archivedRepository) trackedRepositories?.delete(repositoryKey(archivedRepository));
      return (rowsAffected[0] ?? 0) > 0;
    },
  };
}

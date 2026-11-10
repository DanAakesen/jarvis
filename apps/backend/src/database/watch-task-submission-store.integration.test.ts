import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readDownMigration, readMigrations, revertMigration } from './migrations.js';
import { createWatchTaskSubmissionStore } from './watch-task-submission-store.js';
import { createWatchTaskCapture, type WatchTaskReceipt } from '../vault/watch-task-capture.js';
import { createTaskWriter, type TaskWriteResult } from '../vault/task-writes.js';
import { taskWriteHelpers } from '../vault/index.js';
import { VaultWriteConflictError, type VaultFile } from '../vault/github-client.js';
import { parseTodosWithContext } from '../proactive/todo-file.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const migrationName = '0078_watch_task_submissions.sql';
const database = `jarvis_watch_tasks_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const signal = () => AbortSignal.timeout(30_000);
beforeAll(async () => {
  await administrator.connect();
  await administrator.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  await applyMigrations(pool, (await readMigrations()).filter(item => item.name === migrationName));
});
afterAll(async () => {
  await pool.close();
  if (administrator.connected) {
    await administrator.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN
      ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${database}]; END;`);
  }
  await administrator.close();
});

describe('durable Watch task submission receipts', () => {
  const receipt: WatchTaskReceipt = {
    requestHash: 'a'.repeat(64), result: null,
    resolved: {
      text: 'Review launch', scope: 'personal', due: '2026-11-10', time: '14:15',
      dueAt: '2026-11-10T13:15:27.000Z', timeZone: 'Europe/Copenhagen', priority: 'normal', notes: 'Stored notes',
    },
  };
  it('serializes competing resolutions and persists the winner across new store instances/connections', async () => {
    const owner = randomUUID();
    const id = randomUUID();
    const other = { ...receipt, requestHash: 'b'.repeat(64), resolved: { ...receipt.resolved, text: 'Other resolution' } };
    const values = await Promise.all([
      createWatchTaskSubmissionStore(pool).reserve(owner, id, receipt, signal()),
      createWatchTaskSubmissionStore(pool).reserve(owner, id, other, signal()),
    ]);
    expect(values[0]).toEqual(values[1]);
    expect([receipt.requestHash, other.requestHash]).toContain(values[0]!.requestHash);
    expect(await createWatchTaskSubmissionStore(pool).get(owner, id, signal())).toEqual(values[0]);
    expect(await createWatchTaskSubmissionStore(pool).get(randomUUID(), id, signal())).toBeNull();
    const count = await pool.request().query<{ count: number }>('SELECT COUNT(*) AS count FROM dbo.watch_task_submissions;');
    expect(count.recordset[0]?.count).toBe(1);
    const winner = values[0]!;
    const result: TaskWriteResult = {
      id: 'a'.repeat(64), path: 'Personal/Inbox.md', line: 3, text: winner.resolved.text, done: false,
      dueDate: winner.resolved.due!, dueTime: winner.resolved.time!, dueAt: winner.resolved.dueAt!,
      priority: winner.resolved.priority!, version: 'b'.repeat(64), commit: 'c'.repeat(40),
      notes: winner.resolved.notes!, timeZone: winner.resolved.timeZone!, remindAtDue: false,
    };
    const store = createWatchTaskSubmissionStore(pool);
    await expect(store.complete(owner, id, 'c'.repeat(64), result, signal())).rejects.toThrow('not saved');
    await store.complete(owner, id, winner.requestHash, result, signal());
    await store.complete(owner, id, winner.requestHash, { ...result, commit: null }, signal());
    expect((await createWatchTaskSubmissionStore(pool).get(owner, id, signal()))?.result).toEqual(result);
  });

  it('guards nonempty rollback, then permits explicit empty rollback/reapplication', async () => {
    const migrations = (await readMigrations()).filter(item => item.name === migrationName);
    expect(await applyMigrations(pool, migrations)).toEqual([]);
    const down = await readDownMigration(migrationName);
    await expect(revertMigration(pool, migrations, down)).rejects.toThrow('retained');
    await pool.request().query('DELETE FROM dbo.watch_task_submissions;');
    expect(await revertMigration(pool, migrations, down)).toBe(migrationName);
    expect(await applyMigrations(pool, migrations)).toEqual([migrationName]);
  });

  it('reconciles an unknown GitHub commit after restart using real SQL resolution and the existing CAS writer', async () => {
    const owner = randomUUID();
    const submission = {
      submissionId: randomUUID(), submittedAt: '2026-10-25T00:30:12.000Z',
      timeZone: 'Europe/Copenhagen', mode: 'auto', input: 'Køb mælk',
    };
    const files = new Map<string, VaultFile>();
    let responseLost = true;
    const client = {
      read: vi.fn(async (path: string) => files.get(path) ?? null),
      write: vi.fn(async (path: string, content: string, _message: string, expectedSha?: string) => {
        if (files.get(path)?.sha !== expectedSha) throw new VaultWriteConflictError();
        const sha = createHash('sha1').update(content).digest('hex');
        files.set(path, { path, content, sha });
        if (responseLost) { responseLost = false; throw new Error('Simulated lost GitHub acknowledgement'); }
        return sha;
      }),
    };
    const model = vi.fn(async () => JSON.stringify({ text: 'Køb mælk', due: null, time: null, priority: null }));
    const start = () => createWatchTaskCapture({
      writer: createTaskWriter({ ...taskWriteHelpers, client, onWrite: () => {}, log: () => {} }),
      store: createWatchTaskSubmissionStore(pool), model, shouldRedact: taskWriteHelpers.shouldRedact,
    });
    await expect(start()(owner, submission, signal())).rejects.toMatchObject({ statusCode: 503 });
    expect(client.write).toHaveBeenCalledOnce();
    const pending = await createWatchTaskSubmissionStore(pool).get(owner, submission.submissionId, signal());
    expect(pending).toMatchObject({ result: null, resolved: { dueAt: '2026-10-25T01:30:12.000Z', priority: 'normal' } });
    const recovered = await start()(owner, submission, signal());
    expect(recovered).toMatchObject({ text: 'Køb mælk', dueAt: '2026-10-25T01:30:12.000Z', commit: null });
    expect(model).toHaveBeenCalledOnce();
    expect(client.write).toHaveBeenCalledOnce();
    expect(parseTodosWithContext(files.get(recovered.path)!.content, recovered.path)).toHaveLength(1);
    expect(await start()(owner, submission, signal())).toEqual(recovered);
    await expect(start()(owner, { ...submission, timeZone: 'UTC' }, signal())).rejects.toMatchObject({ statusCode: 409 });
    const manualId = randomUUID();
    const manualText = 'æ🙂'.repeat(200);
    const manual = await start()(owner, {
      ...submission, submissionId: manualId, mode: 'manual', input: undefined, fields: { text: manualText },
    }, signal());
    expect(manual).toMatchObject({ text: manualText, dueDate: null, dueTime: null, dueAt: null });
    expect((await createWatchTaskSubmissionStore(pool).get(owner, manualId, signal()))?.resolved).not.toHaveProperty('due');
    expect(model).toHaveBeenCalledOnce();
  });
});

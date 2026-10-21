import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations, type Migration } from './migrations.js';
import { createProactiveReminderStore } from './proactive-reminder-store.js';
import type { PlannedReminder } from '../proactive/reminder-store.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Proactive reminder integration tests require isolated loopback SQL Server');
}
const database = `jarvis_reminders_ci_${randomUUID().replaceAll('-', '')}`;
const admin = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const migrationName = '0059_proactive_reminders.sql';
let migrations: Migration[];
const store = createProactiveReminderStore(pool, owner);

function candidate(index: number, dueAt = new Date('2026-10-20T10:00:00.000Z')): PlannedReminder {
  return {
    reminderKey: index.toString(16).padStart(32, '0'),
    deadlineAlertKey: (index + 1000).toString(16).padStart(32, '0'),
    fireAt: new Date(dueAt.getTime() - 60 * 60_000),
    dueAt,
    title: `Synthetic SQL reminder ${index}`,
    plannedRunId: randomUUID(),
  };
}

beforeAll(async () => {
  await admin.connect();
  await admin.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  migrations = (await readMigrations()).filter(({ name }) => name === migrationName);
  await applyMigrations(pool, migrations);
});

beforeEach(async () => {
  await pool.request().query('DELETE dbo.proactive_reminders;');
});

afterAll(async () => {
  await pool.close();
  if (admin.connected) {
    await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN
      ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${database}]; END;`);
  }
  await admin.close();
});

describe('owner-scoped proactive reminder SQL store', () => {
  it('inserts idempotently without reopening terminal reminders and isolates owners', async () => {
    const planned = candidate(1);
    const first = await store.plan([planned], new Date('2026-10-20T08:00:00.000Z'));
    expect(first.inserted).toHaveLength(1);
    expect((await createProactiveReminderStore(pool, owner).plan([
      { ...planned, title: 'Synthetic edited title' },
    ], new Date('2026-10-20T08:01:00.000Z'))).inserted).toEqual([]);
    await store.updatePending(first.inserted[0]!.id, { state: 'cancelled', reason: 'todo_changed' });
    expect((await store.plan([planned], new Date('2026-10-20T08:02:00.000Z'))).inserted).toEqual([]);
    expect(await store.listDue(new Date('2026-10-20T12:00:00.000Z'), 20)).toEqual([]);
    expect(await createProactiveReminderStore(pool, otherOwner).earliestPendingFireAt()).toBeNull();
  });

  it('orders due rows, caps each plan at 20 and pending rows at 100', async () => {
    const firstBatch = await store.plan(Array.from({ length: 25 }, (_, index) =>
      candidate(index + 10, new Date(Date.parse('2026-10-20T10:00:00.000Z') + index * 60_000))),
    new Date('2026-10-20T08:00:00.000Z'));
    expect(firstBatch.inserted).toHaveLength(20);
    expect(firstBatch.capSkipped).toBe(5);
    for (let batch = 0; batch < 4; batch += 1) {
      await store.plan(Array.from({ length: 20 }, (_, index) => candidate(100 + batch * 20 + index)),
        new Date('2026-10-20T08:00:00.000Z'));
    }
    const pendingCap = await store.plan([candidate(999)], new Date('2026-10-20T08:00:00.000Z'));
    expect(pendingCap.capSkipped).toBe(1);
    expect(pendingCap.inserted).toEqual([]);
    const due = await store.listDue(new Date('2026-10-20T12:00:00.000Z'), 20);
    expect(due).toHaveLength(20);
    expect(due[0]!.dueAt.getTime()).toBeLessThanOrEqual(due.at(-1)!.dueAt.getTime());
    expect(await store.earliestPendingFireAt()).toEqual(new Date('2026-10-20T09:00:00.000Z'));
  });

  it('counts sent reminders by Copenhagen day and purges old terminal rows during planning', async () => {
    const planNow = new Date('2026-10-20T08:00:00.000Z');
    const [row] = (await store.plan([candidate(2000)], planNow)).inserted;
    await store.updatePending(row!.id, { state: 'sent', sentDayKey: '2026-10-20' });
    expect(await store.countSent('2026-10-20')).toBe(1);
    // Age the row against the planning clock, not the CI clock, so the test does not expire.
    await pool.request().input('id', sql.UniqueIdentifier, row!.id)
      .input('createdAt', sql.DateTime2, new Date(planNow.getTime() - 31 * 24 * 60 * 60_000))
      .query('UPDATE dbo.proactive_reminders SET created_at = @createdAt WHERE id = @id;');
    const purged = await store.plan([], planNow);
    expect(purged.purged).toBe(1);
    expect(await store.countSent('2026-10-20')).toBe(0);
  });
});

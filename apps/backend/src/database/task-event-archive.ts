import sql from 'mssql';
import type { TaskEventRecord } from '../factory/task-store.js';

export const taskEventArchiveLock = 'jarvis.task-event-archive';
export const taskEventArchiveAgeDays = 90;
const archiveBatchSize = 250;
const archiveBatchCount = 10;
export const taskEventArchiveBlobSizeLimit = 8 * 1024 * 1024;
const maxPayloadBytes = 4096;
const maxSqlBigInt = 9_223_372_036_854_775_807n;

interface ArchiveRow {
  id: string;
  taskId: string;
  type: string;
  summary: string | null;
  payload: string | null;
  source: TaskEventRecord['source'];
  at: string;
  archiveAt: string;
}

type ArchivedEventRow = Omit<ArchiveRow, 'taskId' | 'archiveAt'>;

export interface TaskEventArchiveBlob {
  name: string;
  count: number;
}

export interface TaskEventArchiveSegment extends TaskEventArchiveBlob {
  firstOffset: number;
}

export interface TaskEventArchiveBlobStore {
  upload(name: string, body: Buffer, signal?: AbortSignal): Promise<void>;
  download(name: string, signal?: AbortSignal): Promise<Buffer>;
}

export interface ArchivedTaskEventSlice {
  name: string;
  count: number;
  skip: number;
  take: number;
}

export interface ArchivedTaskEventPagePlan {
  taskId: string;
  slices: ArchivedTaskEventSlice[];
  total: number;
  eventCount: number;
  complete: boolean;
}

export interface TaskEventArchive {
  prepareArchivedEvents(
    transaction: sql.Transaction,
    taskId: string,
    offset: number,
    limit: number,
  ): Promise<ArchivedTaskEventPagePlan>;
  restoreArchivedEvents(plan: ArchivedTaskEventPagePlan): Promise<TaskEventRecord[]>;
  archiveExpiredEvents(cutoff?: Date, signal?: AbortSignal): Promise<number>;
}

export function planArchivedTaskEvents(
  taskId: string,
  total: number,
  segments: readonly TaskEventArchiveSegment[],
  offset: number,
  limit: number,
): ArchivedTaskEventPagePlan {
  if (!/^[1-9][0-9]{0,18}$/.test(taskId) || BigInt(taskId) > maxSqlBigInt ||
    !Number.isSafeInteger(total) || total < 0 ||
    !Number.isSafeInteger(offset) || offset < 0 ||
    !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Invalid task event archive page');
  }
  const slices: ArchivedTaskEventPagePlan['slices'] = [];
  let eventCount = 0;
  for (const segment of segments) {
    if (!segment.name.startsWith(`task-events/${taskId}/`) ||
      !Number.isSafeInteger(segment.count) || segment.count < 1 ||
      !Number.isSafeInteger(segment.firstOffset) || segment.firstOffset < 0) {
      throw new Error('Task event archive index is invalid');
    }
    const skip = Math.max(offset - segment.firstOffset, 0);
    if (skip >= segment.count) continue;
    const take = Math.min(segment.count - skip, limit - eventCount);
    slices.push({ name: segment.name, count: segment.count, skip, take });
    eventCount += take;
    if (eventCount === limit) break;
  }
  return { taskId, slices, total, eventCount, complete: eventCount < limit };
}

function aborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function query<T>(request: sql.Request, text: string, signal?: AbortSignal): Promise<sql.IResult<T>> {
  aborted(signal);
  const cancel = () => { request.cancel(); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await request.query<T>(text);
    aborted(signal);
    return result;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export async function acquireTaskEventArchiveLock(
  transaction: sql.Transaction,
  mode: 'Shared' | 'Exclusive',
  signal?: AbortSignal,
): Promise<void> {
  const request = new sql.Request(transaction)
    .input('resource', sql.NVarChar(255), taskEventArchiveLock)
    .input('mode', sql.NVarChar(16), mode);
  const result = await query<{ result: number }>(request, `DECLARE @result int;
      EXEC @result = sys.sp_getapplock
        @Resource = @resource, @LockMode = @mode, @LockOwner = N'Transaction', @LockTimeout = 10000;
      SELECT @result AS result;`, signal);
  if ((result.recordset[0]?.result ?? -1) < 0) throw new Error('Task event archive lock unavailable');
}

async function rollback(transaction: sql.Transaction): Promise<void> {
  try { await transaction.rollback(); }
  catch { /* The transaction may already have rolled back. */ }
}

function archiveName(row: ArchiveRow): string {
  const sortableAt = row.archiveAt.replace(/[^0-9]/g, '');
  return `task-events/${row.taskId}/${sortableAt}-${row.id.padStart(19, '0')}.json`;
}

function toArchivedRecord(row: ArchiveRow): ArchivedEventRow {
  return {
    id: row.id,
    type: row.type,
    summary: row.summary,
    payload: row.payload,
    source: row.source,
    at: row.at,
  };
}

function splitRows(rows: ArchiveRow[]): ArchiveRow[][] {
  const groups = new Map<string, ArchiveRow[]>();
  for (const row of rows) {
    const group = groups.get(row.taskId) ?? [];
    group.push(row);
    groups.set(row.taskId, group);
  }

  const chunks: ArchiveRow[][] = [];
  for (const group of groups.values()) {
    let chunk: ArchiveRow[] = [];
    for (const row of group) {
      const candidate = [...chunk, row];
      const size = Buffer.byteLength(JSON.stringify(candidate.map(toArchivedRecord)));
      if (chunk.length > 0 && size > taskEventArchiveBlobSizeLimit) {
        chunks.push(chunk);
        chunk = [row];
      } else {
        chunk = candidate;
      }
      if (Buffer.byteLength(JSON.stringify(chunk.map(toArchivedRecord))) > taskEventArchiveBlobSizeLimit) {
        throw new Error('Task event exceeds archive blob size limit');
      }
    }
    if (chunk.length > 0) chunks.push(chunk);
  }
  return chunks;
}

function parsePayload(payload: string | null): unknown {
  if (payload === null) return null;
  try { return JSON.parse(payload) as unknown; }
  catch { return null; }
}

function decodeArchive(body: Buffer, count: number, taskId: string): ArchivedEventRow[] {
  if (body.length > taskEventArchiveBlobSizeLimit) throw new Error('Task event archive blob exceeds size limit');
  let decoded: unknown;
  try { decoded = JSON.parse(body.toString('utf8')) as unknown; }
  catch { throw new Error('Task event archive blob is invalid'); }
  if (!Array.isArray(decoded) || decoded.length !== count) {
    throw new Error('Task event archive blob count is invalid');
  }
  for (const row of decoded) {
    if (row === null || typeof row !== 'object' ||
      !('id' in row) || typeof row.id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(row.id) ||
      BigInt(row.id) > maxSqlBigInt ||
      !('type' in row) || typeof row.type !== 'string' || !/^[a-z][a-z_]{0,63}$/.test(row.type) ||
      !('summary' in row) || (row.summary !== null && typeof row.summary !== 'string') ||
      !('payload' in row) || (row.payload !== null && typeof row.payload !== 'string') ||
      !('source' in row) || !['runner', 'backend', 'github', 'dan'].includes(String(row.source)) ||
      !('at' in row) || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) {
      throw new Error(`Task event archive for ${taskId} contains an invalid event`);
    }
  }
  return decoded as ArchivedEventRow[];
}

function toTaskEvent(row: ArchivedEventRow): TaskEventRecord {
  const payloadTruncated = row.payload !== null && row.payload.length * 2 > maxPayloadBytes;
  return {
    id: row.id,
    type: row.type,
    summary: row.summary,
    payload: payloadTruncated ? null : parsePayload(row.payload),
    payloadTruncated,
    source: row.source,
    at: new Date(row.at).toISOString(),
  };
}

export function createTaskEventArchive(
  pool: sql.ConnectionPool,
  blobs: TaskEventArchiveBlobStore,
): TaskEventArchive {
  async function archiveBatch(cutoff: Date, signal?: AbortSignal): Promise<number> {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await acquireTaskEventArchiveLock(transaction, 'Exclusive', signal);
      const { recordset } = await query<ArchiveRow>(new sql.Request(transaction)
        .input('cutoff', sql.DateTime2(7), cutoff)
        .input('batchSize', sql.Int, archiveBatchSize), `SELECT TOP (@batchSize)
          CAST(id AS varchar(19)) AS id, CAST(task_id AS varchar(19)) AS taskId, type, summary, payload, source,
          CONVERT(varchar(23), at, 126) + 'Z' AS at, CONVERT(varchar(27), at, 126) AS archiveAt
          FROM dbo.task_events AS e WITH (UPDLOCK, ROWLOCK)
          WHERE e.at < @cutoff
          ORDER BY e.at ASC, e.id ASC;`, signal);
      if (recordset.length === 0) {
        aborted(signal);
        await transaction.commit();
        return 0;
      }

      const rows = recordset;
      const chunks = splitRows(rows);
      for (const chunk of chunks) {
        const body = Buffer.from(JSON.stringify(chunk.map(toArchivedRecord)));
        await blobs.upload(archiveName(chunk[0]!), body, signal);
      }

      const deletion = new sql.Request(transaction);
      rows.forEach((row, index) => deletion.input(`id${index}`, sql.BigInt, BigInt(row.id)));
      const ids = rows.map((_row, index) => `@id${index}`).join(', ');
      const deleted = await query<{ id: string }>(deletion,
        `DELETE FROM dbo.task_events OUTPUT CAST(deleted.id AS varchar(19)) AS id WHERE id IN (${ids});`, signal);
      if (deleted.recordset.length !== rows.length) throw new Error('Task event archive delete count changed');

      const metadata = new sql.Request(transaction);
      const values = chunks.map((chunk, index) => {
        const first = chunk[0]!;
        metadata
          .input(`taskId${index}`, sql.BigInt, BigInt(first.taskId))
          .input(`firstAt${index}`, sql.VarChar(27), first.archiveAt)
          .input(`firstEventId${index}`, sql.BigInt, BigInt(first.id))
          .input(`blobName${index}`, sql.NVarChar(512), archiveName(first))
          .input(`eventCount${index}`, sql.Int, chunk.length);
        return `(@taskId${index}, CONVERT(datetime2(7), @firstAt${index}, 126), @firstEventId${index},
          @blobName${index}, @eventCount${index})`;
      }).join(', ');
      await query(metadata, `INSERT dbo.task_event_archives
        (task_id, first_at, first_event_id, blob_name, event_count)
        VALUES ${values};`, signal);
      aborted(signal);
      await transaction.commit();
      return rows.length;
    } catch (error) {
      await rollback(transaction);
      throw error;
    }
  }

  return {
    async prepareArchivedEvents(transaction, taskId, offset, limit) {
      if (!/^[1-9][0-9]{0,18}$/.test(taskId) || BigInt(taskId) > maxSqlBigInt ||
        !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 ||
        !Number.isSafeInteger(offset + limit)) {
        throw new Error('Invalid task event archive page');
      }
      const totalResult = await new sql.Request(transaction)
        .input('taskId', sql.BigInt, BigInt(taskId))
        .query<{ total: string }>(`SELECT CAST(COALESCE(SUM(CONVERT(bigint, event_count)), 0) AS varchar(19)) AS total
          FROM dbo.task_event_archives WHERE task_id = @taskId;`);
      const total = Number(totalResult.recordset[0]?.total ?? '0');
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('Task event archive index is invalid');

      const segmentsResult = await new sql.Request(transaction)
        .input('taskId', sql.BigInt, BigInt(taskId))
        .input('offset', sql.BigInt, BigInt(offset))
        .input('endOffset', sql.BigInt, BigInt(offset + limit))
        .query<{ name: string; count: number; firstOffset: string }>(`WITH ordered AS (
            SELECT blob_name, event_count,
              SUM(CONVERT(bigint, event_count)) OVER (
                ORDER BY first_at, first_event_id ROWS UNBOUNDED PRECEDING
              ) - CONVERT(bigint, event_count) AS first_offset
            FROM dbo.task_event_archives
            WHERE task_id = @taskId
          )
          SELECT blob_name AS name, event_count AS count,
            CAST(first_offset AS varchar(19)) AS firstOffset
          FROM ordered
          WHERE first_offset < @endOffset AND first_offset + CONVERT(bigint, event_count) > @offset
          ORDER BY first_offset;`);
      const segments = segmentsResult.recordset.map((segment) => ({
        name: segment.name,
        count: segment.count,
        firstOffset: Number(segment.firstOffset),
      }));
      return planArchivedTaskEvents(taskId, total, segments, offset, limit);
    },
    async restoreArchivedEvents(plan) {
      const events: TaskEventRecord[] = [];
      for (const slice of plan.slices) {
        const body = await blobs.download(slice.name);
        const rows = decodeArchive(body, slice.count, plan.taskId);
        events.push(...rows.slice(slice.skip, slice.skip + slice.take).map(toTaskEvent));
      }
      if (events.length !== plan.eventCount) throw new Error('Task event archive page count is invalid');
      return events;
    },
    async archiveExpiredEvents(cutoff = new Date(Date.now() - taskEventArchiveAgeDays * 24 * 60 * 60 * 1000), signal) {
      let total = 0;
      for (let batch = 0; batch < archiveBatchCount; batch += 1) {
        aborted(signal);
        const count = await archiveBatch(cutoff, signal);
        total += count;
        if (count < archiveBatchSize) break;
      }
      return total;
    },
  };
}

export function createTaskEventArchiveJob(
  archive: TaskEventArchive,
  onError: (error: unknown) => void,
  hasActiveWork: () => boolean = () => true,
  intervalMs = 60 * 60 * 1000,
) {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;

  const run = async () => {
    if (running || !hasActiveWork()) return;
    controller = new AbortController();
    running = archive.archiveExpiredEvents(undefined, controller.signal)
      .then(() => undefined)
      .catch((error: unknown) => { onError(error); })
      .finally(() => {
        running = undefined;
        controller = undefined;
      });
    await running;
  };

  return {
    start() {
      if (timer) return;
      void run();
      timer = setInterval(() => { void run(); }, intervalMs);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      controller?.abort();
      await running;
    },
  };
}

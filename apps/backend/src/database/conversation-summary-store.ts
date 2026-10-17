import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';

const ownerIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const messageIdPattern = /^[1-9][0-9]{0,18}$/u;
const maxSqlBigInt = 9_223_372_036_854_775_807n;
const maxSqlInt = 2_147_483_646;
const retainedVersions = 200;
const defaultWindowHours = 24;

export interface ConversationSummaryRecord {
  version: number;
  fromMessageId: string;
  throughMessageId: string;
  messageCount: number;
  summary: string;
  openItems: string;
  model: string;
  createdAt: string;
}

export interface AppendConversationSummaryInput {
  ownerObjectId: string;
  baseVersion: number;
  fromMessageId: string;
  throughMessageId: string;
  messageCount: number;
  summary: string;
  openItems: string;
  model: string;
  dailyLimit: number;
}

export type AppendConversationSummaryResult =
  | { status: 'saved'; record: ConversationSummaryRecord; usedLast24h: number }
  | { status: 'conflict'; latestVersion: number }
  | { status: 'invalid_range' }
  | { status: 'limit'; used: number };

export interface ConversationSummaryStore {
  latest(ownerObjectId: string): Promise<ConversationSummaryRecord | null>;
  usedSince(ownerObjectId: string, hours?: number): Promise<number>;
  append(input: AppendConversationSummaryInput): Promise<AppendConversationSummaryResult>;
}

interface ConversationSummaryRow {
  version: number;
  from_message_id: string;
  through_message_id: string;
  message_count: number;
  summary: string;
  open_items: string;
  model: string;
  created_at: Date | string;
}

function latestSql(locked: boolean): string {
  return `SELECT TOP (1) version, CONVERT(varchar(20), from_message_id) AS from_message_id,
      CONVERT(varchar(20), through_message_id) AS through_message_id, message_count, summary, open_items, model, created_at
    FROM dbo.conversation_summaries${locked ? ' WITH (UPDLOCK, HOLDLOCK)' : ''}
    WHERE owner_object_id = @owner
    ORDER BY version DESC;`;
}

const usedSql = `SELECT COUNT(*) AS used FROM dbo.conversation_summaries
  WHERE owner_object_id = @owner AND created_at >= DATEADD(hour, -@hours, SYSUTCDATETIME());`;

const insertSql = `INSERT dbo.conversation_summaries
  (owner_object_id, version, from_message_id, through_message_id, message_count, summary, open_items, model)
  OUTPUT INSERTED.version, CONVERT(varchar(20), INSERTED.from_message_id) AS from_message_id,
    CONVERT(varchar(20), INSERTED.through_message_id) AS through_message_id, INSERTED.message_count,
    INSERTED.summary, INSERTED.open_items, INSERTED.model, INSERTED.created_at
  VALUES (@owner, @version, @fromId, @throughId, @messageCount, @summary, @openItems, @model);`;

const pruneSql = `DELETE dbo.conversation_summaries WHERE owner_object_id = @owner AND version < @oldest;`;

function mapRow(row: ConversationSummaryRow): ConversationSummaryRecord {
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  if (!Number.isFinite(createdAt.getTime())) throw new Error('Stored conversation summary is invalid');
  return {
    version: row.version,
    fromMessageId: row.from_message_id,
    throughMessageId: row.through_message_id,
    messageCount: row.message_count,
    summary: row.summary,
    openItems: row.open_items,
    model: row.model,
    createdAt: createdAt.toISOString(),
  };
}

function ownerId(value: string): string {
  if (!ownerIdPattern.test(value)) throw new TypeError('Invalid conversation summary owner');
  return value.toLowerCase();
}

function messageId(value: string): bigint {
  if (!messageIdPattern.test(value) || BigInt(value) > maxSqlBigInt) {
    throw new TypeError('Invalid conversation summary message id');
  }
  return BigInt(value);
}

function integer(value: number, minimum: number, name: string, maximum = maxSqlInt): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`Invalid conversation summary ${name}`);
  }
  return value;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'number' in error && (error.number === 2601 || error.number === 2627);
}

async function readLatest(pool: sql.ConnectionPool, owner: string): Promise<ConversationSummaryRecord | null> {
  const { recordset } = await databaseReadRequest(pool)
    .input('owner', sql.UniqueIdentifier, owner)
    .query<ConversationSummaryRow>(latestSql(false));
  const row = recordset[0];
  return row ? mapRow(row) : null;
}

async function appendInTransaction(
  transaction: sql.Transaction,
  owner: string,
  input: AppendConversationSummaryInput,
  fromId: bigint,
  throughId: bigint,
): Promise<AppendConversationSummaryResult> {
  const { recordset: latestRows } = await transaction.request()
    .input('owner', sql.UniqueIdentifier, owner)
    .query<ConversationSummaryRow>(latestSql(true));
  const latest = latestRows[0];
  const latestVersion = latest?.version ?? 0;
  if (latestVersion !== input.baseVersion) return { status: 'conflict', latestVersion };
  if (latest && (throughId <= BigInt(latest.through_message_id) || fromId !== BigInt(latest.from_message_id))) {
    return { status: 'invalid_range' };
  }
  const { recordset: usedRows } = await transaction.request()
    .input('owner', sql.UniqueIdentifier, owner)
    .input('hours', sql.Int, defaultWindowHours)
    .query<{ used: number }>(usedSql);
  const used = usedRows[0]?.used ?? 0;
  if (used >= input.dailyLimit) return { status: 'limit', used };
  const version = latestVersion + 1;
  const { recordset: saved } = await transaction.request()
    .input('owner', sql.UniqueIdentifier, owner)
    .input('version', sql.Int, version)
    .input('fromId', sql.BigInt, fromId)
    .input('throughId', sql.BigInt, throughId)
    .input('messageCount', sql.Int, input.messageCount)
    .input('summary', sql.NVarChar(sql.MAX), input.summary)
    .input('openItems', sql.NVarChar(3000), input.openItems)
    .input('model', sql.NVarChar(128), input.model)
    .query<ConversationSummaryRow>(insertSql);
  const row = saved[0];
  if (!row) throw new Error('Conversation summary was not saved');
  await transaction.request()
    .input('owner', sql.UniqueIdentifier, owner)
    .input('oldest', sql.Int, version - retainedVersions + 1)
    .query(pruneSql);
  return { status: 'saved', record: mapRow(row), usedLast24h: used + 1 };
}

export function createConversationSummaryStore(pool: sql.ConnectionPool): ConversationSummaryStore {
  return {
    async latest(ownerObjectId) {
      return readLatest(pool, ownerId(ownerObjectId));
    },

    async usedSince(ownerObjectId, hours = defaultWindowHours) {
      const owner = ownerId(ownerObjectId);
      const { recordset } = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('hours', sql.Int, integer(hours, 1, 'window', 24 * 31))
        .query<{ used: number }>(usedSql);
      return recordset[0]?.used ?? 0;
    },

    async append(input) {
      const owner = ownerId(input.ownerObjectId);
      const fromId = messageId(input.fromMessageId);
      const throughId = messageId(input.throughMessageId);
      integer(input.baseVersion, 0, 'base version');
      integer(input.messageCount, 1, 'message count');
      integer(input.dailyLimit, 0, 'daily limit');
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        const outcome = await appendInTransaction(transaction, owner, input, fromId, throughId);
        if (outcome.status === 'saved') await transaction.commit();
        else await transaction.rollback();
        return outcome;
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the store error. */ }
        if (!isDuplicateKey(error)) throw error;
        const current = await readLatest(pool, owner);
        return { status: 'conflict', latestVersion: current?.version ?? input.baseVersion + 1 };
      }
    },
  };
}

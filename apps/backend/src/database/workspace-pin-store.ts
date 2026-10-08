import sql from 'mssql';
import type { GeneratedView, WorkspacePin } from '@jarvis/contracts';
import { databaseReadRequest } from './wake-retry.js';

const viewIdPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const ownerIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const maxPins = 20;

interface WorkspacePinRow {
  view_id: string;
  view_json: string;
  pinned_at: Date | string;
}

interface PinResultRow extends WorkspacePinRow {
  outcome: 'saved' | 'limit';
}

export class WorkspacePinLimitExceeded extends Error {
  constructor() {
    super('Workspace pin limit reached');
    this.name = 'WorkspacePinLimitExceeded';
  }
}

function mapPin(row: WorkspacePinRow): WorkspacePin {
  let view: unknown;
  try {
    view = JSON.parse(row.view_json);
  } catch {
    throw new Error('Stored workspace pin is invalid');
  }
  const date = row.pinned_at instanceof Date ? row.pinned_at : new Date(row.pinned_at);
  if (!viewIdPattern.test(row.view_id) || !Number.isFinite(date.getTime())) {
    throw new Error('Stored workspace pin is invalid');
  }
  return { viewId: row.view_id, view: view as GeneratedView, pinnedAt: date.toISOString() };
}

function cancelOnAbort(request: sql.Request, signal: AbortSignal): () => void {
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  return () => signal.removeEventListener('abort', cancel);
}

export class WorkspacePinStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async list(ownerObjectId: string, signal: AbortSignal): Promise<WorkspacePin[]> {
    if (!ownerIdPattern.test(ownerObjectId)) throw new TypeError('Invalid workspace pin owner');
    const request = databaseReadRequest(this.pool)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase());
    const dispose = cancelOnAbort(request, signal);
    try {
      signal.throwIfAborted();
      const { recordset } = await request.query<WorkspacePinRow>(`SELECT TOP (${maxPins}) view_id, view_json, pinned_at
        FROM dbo.workspace_pins
        WHERE owner_object_id = @owner
        ORDER BY pinned_at, view_id;`);
      signal.throwIfAborted();
      return recordset.map(mapPin);
    } finally {
      dispose();
    }
  }

  async pin(ownerObjectId: string, viewId: string, view: GeneratedView, signal: AbortSignal): Promise<WorkspacePin> {
    if (!ownerIdPattern.test(ownerObjectId) || !viewIdPattern.test(viewId)) {
      throw new TypeError('Invalid workspace pin');
    }
    const transaction = new sql.Transaction(this.pool);
    try {
      signal.throwIfAborted();
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const request = transaction.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
        .input('viewId', sql.NVarChar(64), viewId)
        .input('view', sql.NVarChar(sql.MAX), JSON.stringify(view))
        .input('lockResource', sql.NVarChar(255), `jarvis.workspace-pins:${ownerObjectId.toLowerCase()}`);
      const dispose = cancelOnAbort(request, signal);
      let result: PinResultRow | undefined;
      try {
        signal.throwIfAborted();
        const { recordset } = await request.query<PinResultRow>(`DECLARE @lock_result int;
          EXEC @lock_result = sys.sp_getapplock
            @Resource = @lockResource,
            @LockMode = 'Exclusive',
            @LockOwner = 'Transaction',
            @LockTimeout = 5000;
          IF @lock_result < 0 THROW 51000, 'Workspace pin lock unavailable', 1;

          IF EXISTS (SELECT 1 FROM dbo.workspace_pins WHERE owner_object_id = @owner AND view_id = @viewId)
          BEGIN
            UPDATE dbo.workspace_pins SET view_json = @view
              WHERE owner_object_id = @owner AND view_id = @viewId;
            SELECT N'saved' AS outcome, view_id, view_json, pinned_at
              FROM dbo.workspace_pins WHERE owner_object_id = @owner AND view_id = @viewId;
          END
          ELSE IF (SELECT COUNT_BIG(*) FROM dbo.workspace_pins WHERE owner_object_id = @owner) >= ${maxPins}
          BEGIN
            SELECT N'limit' AS outcome, CAST(NULL AS nvarchar(64)) AS view_id,
              CAST(NULL AS nvarchar(max)) AS view_json, CAST(NULL AS datetime2(7)) AS pinned_at;
          END
          ELSE
          BEGIN
            INSERT dbo.workspace_pins (owner_object_id, view_id, view_json)
              VALUES (@owner, @viewId, @view);
            SELECT N'saved' AS outcome, view_id, view_json, pinned_at
              FROM dbo.workspace_pins WHERE owner_object_id = @owner AND view_id = @viewId;
          END;`);
        signal.throwIfAborted();
        result = recordset[0];
        if (result?.outcome === 'limit') throw new WorkspacePinLimitExceeded();
        if (!result) throw new Error('Workspace pin was not saved');
        await transaction.commit();
      } finally {
        dispose();
      }
      return mapPin(result);
    } catch (error) {
      try { await transaction.rollback(); } catch { /* Preserve the store error. */ }
      if (error instanceof WorkspacePinLimitExceeded) throw error;
      if (signal.aborted) throw error;
      throw new Error('Workspace pin could not be saved', { cause: error });
    }
  }

  async unpin(ownerObjectId: string, viewId: string, signal: AbortSignal): Promise<boolean> {
    if (!ownerIdPattern.test(ownerObjectId) || !viewIdPattern.test(viewId)) return false;
    const request = this.pool.request()
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
      .input('viewId', sql.NVarChar(64), viewId);
    const dispose = cancelOnAbort(request, signal);
    try {
      signal.throwIfAborted();
      const { rowsAffected } = await request.query(`DELETE dbo.workspace_pins
        WHERE owner_object_id = @owner AND view_id = @viewId;`);
      signal.throwIfAborted();
      return rowsAffected[0] === 1;
    } finally {
      dispose();
    }
  }
}

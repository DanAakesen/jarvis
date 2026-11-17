import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { NotesFolderOrder, NotesFolderOrderStore } from '../vault/folder-order.js';

const ownerIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

function cancelOnAbort(request: sql.Request, signal: AbortSignal): () => void {
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  return () => signal.removeEventListener('abort', cancel);
}

export function createNotesFolderOrderStore(pool: sql.ConnectionPool): NotesFolderOrderStore {
  return {
    async read(ownerObjectId, signal): Promise<NotesFolderOrder[]> {
      if (!ownerIdPattern.test(ownerObjectId)) throw new TypeError('Invalid folder order owner');
      const request = databaseReadRequest(pool).input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase());
      const dispose = cancelOnAbort(request, signal);
      try {
        signal.throwIfAborted();
        const { recordset } = await request.query<{ parent_path: string; folder_path: string }>(
          `SELECT parent_path, folder_path FROM dbo.notes_folder_order
            WHERE owner_object_id = @owner ORDER BY parent_path, position;`,
        );
        signal.throwIfAborted();
        const byParent = new Map<string, string[]>();
        for (const row of recordset) {
          const folders = byParent.get(row.parent_path) ?? [];
          folders.push(row.folder_path);
          byParent.set(row.parent_path, folders);
        }
        return [...byParent].map(([parent, folders]) => ({ parent, folders }));
      } finally {
        dispose();
      }
    },

    // Replaces one parent's whole order, so folders that no longer exist drop out the next time the owner reorders.
    async replace(ownerObjectId, parent, folders, signal): Promise<void> {
      if (!ownerIdPattern.test(ownerObjectId)) throw new TypeError('Invalid folder order owner');
      const transaction = new sql.Transaction(pool);
      try {
        signal.throwIfAborted();
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        const request = transaction.request()
          .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
          .input('parent', sql.NVarChar(180), parent)
          .input('folders', sql.NVarChar(sql.MAX), JSON.stringify(folders))
          .input('lockResource', sql.NVarChar(255), `jarvis.notes-folder-order:${ownerObjectId.toLowerCase()}`);
        const dispose = cancelOnAbort(request, signal);
        try {
          signal.throwIfAborted();
          await request.query(`DECLARE @lock_result int;
            EXEC @lock_result = sys.sp_getapplock
              @Resource = @lockResource,
              @LockMode = 'Exclusive',
              @LockOwner = 'Transaction',
              @LockTimeout = 5000;
            IF @lock_result < 0 THROW 51000, 'Folder order lock unavailable', 1;
            DELETE dbo.notes_folder_order WHERE owner_object_id = @owner AND parent_path = @parent;
            INSERT dbo.notes_folder_order (owner_object_id, parent_path, folder_path, position)
              SELECT @owner, @parent, [value], CAST([key] AS int)
              FROM OPENJSON(@folders);`);
          signal.throwIfAborted();
          await transaction.commit();
        } finally {
          dispose();
        }
      } catch (error) {
        try { await transaction.rollback(); } catch { /* Preserve the store error. */ }
        if (signal.aborted) throw error;
        throw new Error('Folder order could not be saved', { cause: error });
      }
    },
  };
}

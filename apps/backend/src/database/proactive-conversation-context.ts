import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { ConversationSelectionStore } from '../proactive/conversation-context.js';

export function createSqlConversationSelectionStore(
  pool: sql.ConnectionPool, ownerObjectId: string,
): ConversationSelectionStore {
  return {
    async read() {
      const result = await databaseReadRequest(pool)
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .query<{ item_id: string; selected_at: Date }>(
          'SELECT item_id, selected_at FROM dbo.proactive_conversation_context WHERE owner_object_id = @owner;',
        );
      const row = result.recordset[0];
      return row ? { itemId: row.item_id, selectedAt: row.selected_at } : undefined;
    },
    async select(selection) {
      await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('item', sql.UniqueIdentifier, selection.itemId)
        .input('at', sql.DateTime2, selection.selectedAt)
        .query(`MERGE dbo.proactive_conversation_context WITH (HOLDLOCK) AS target
          USING (SELECT @owner AS owner_object_id) AS source
          ON target.owner_object_id = source.owner_object_id
          WHEN MATCHED THEN UPDATE SET item_id = @item, selected_at = @at
          WHEN NOT MATCHED THEN INSERT (owner_object_id, item_id, selected_at)
            VALUES (@owner, @item, @at);`);
    },
  };
}

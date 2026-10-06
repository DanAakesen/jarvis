import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import { recipeId, validRecipe, type RecipeStore, type TaskRecipe } from '../core/task-recipes.js';

const prefix = 'recipe.';

export function createRecipeStore(pool: sql.ConnectionPool): RecipeStore {
  return {
    async list(filter) {
      const request = databaseReadRequest(pool)
        .input('prefix', sql.NVarChar(128), `${prefix}%`)
        .input('kind', sql.NVarChar(16), filter?.kind ?? null)
        .input('appKey', sql.NVarChar(256), filter?.key ?? null);
      const { recordset } = await request.query<{ value: string }>(`
        SELECT TOP (100) value FROM dbo.settings
        WHERE scope = N'global' AND [key] LIKE @prefix
          AND (@kind IS NULL OR JSON_VALUE(value, '$.kind') = @kind)
          AND (@appKey IS NULL OR JSON_VALUE(value, '$.key') COLLATE Latin1_General_100_BIN2 = @appKey)
        ORDER BY updated_at DESC, [key];`);
      const recipes: TaskRecipe[] = [];
      for (const row of recordset) {
        if (Buffer.byteLength(row.value) > 32_768) continue;
        try {
          const recipe: unknown = JSON.parse(row.value);
          if (validRecipe(recipe)) recipes.push(recipe);
        } catch {
          continue;
        }
      }
      return recipes;
    },
    async save(draft, signal) {
      const recipe = { ...draft, id: recipeId(draft) };
      if (!validRecipe(recipe)) throw new Error('Invalid task recipe');
      const value = JSON.stringify(recipe);
      if (Buffer.byteLength(value) > 32_768) throw new Error('Task recipe is too large');
      signal?.throwIfAborted();
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();
        const request = transaction.request()
          .input('key', sql.NVarChar(128), prefix + recipe.id)
          .input('prefix', sql.NVarChar(128), `${prefix}%`)
          .input('value', sql.NVarChar(sql.MAX), value);
        const abort = () => { request.cancel(); };
        signal?.addEventListener('abort', abort, { once: true });
        try {
          signal?.throwIfAborted();
          await request.query(`
            DECLARE @lock int;
            EXEC @lock = sys.sp_getapplock @Resource=N'jarvis.task-recipes',
              @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=5000;
            IF @lock < 0 THROW 51000, 'Recipe lock unavailable', 1;
            IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE scope=N'global' AND [key]=@key)
              AND (SELECT COUNT(*) FROM dbo.settings WHERE scope=N'global' AND [key] LIKE @prefix) >= 100
              THROW 51001, 'Recipe capacity reached', 1;
            MERGE dbo.settings WITH (HOLDLOCK) AS target
            USING (SELECT N'global' AS scope, @key AS [key], @value AS value) AS source
            ON target.scope=source.scope AND target.[key]=source.[key]
            WHEN MATCHED THEN UPDATE SET value=source.value, updated_at=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (scope, [key], value) VALUES (source.scope, source.[key], source.value);`);
          signal?.throwIfAborted();
          await transaction.commit();
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
        throw new Error('Task recipe could not be saved');
      }
    },
    async delete(id) {
      if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('Invalid task recipe ID');
      const result = await pool.request().input('key', sql.NVarChar(128), prefix + id)
        .query("DELETE FROM dbo.settings WHERE scope=N'global' AND [key]=@key;");
      return result.rowsAffected[0] === 1;
    },
  };
}

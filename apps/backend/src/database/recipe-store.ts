import sql from 'mssql';
import { routineNameMaxLength } from '@jarvis/contracts';
import { databaseReadRequest } from './wake-retry.js';
import {
  normalizeRoutineName, recipeId, validRecipe, type RecipeStore, type TaskRecipe,
} from '../core/task-recipes.js';

const prefix = 'routine.';
const legacyPrefix = 'recipe.';

export function createRecipeStore(pool: sql.ConnectionPool): RecipeStore {
  return {
    async list(filter) {
      const request = databaseReadRequest(pool)
        .input('prefix', sql.NVarChar(128), `${prefix}%`)
        .input('legacyPrefix', sql.NVarChar(128), `${legacyPrefix}%`)
        .input('kind', sql.NVarChar(16), filter?.kind ?? null)
        .input('appKey', sql.NVarChar(256), filter?.key ?? null);
      const { recordset } = await request.query<{ value: string }>(`
        SELECT TOP (100) value FROM dbo.settings
        WHERE scope = N'global' AND ([key] LIKE @prefix OR [key] LIKE @legacyPrefix)
          AND (@kind IS NULL OR JSON_VALUE(value, '$.kind') = @kind)
          AND (@appKey IS NULL OR JSON_VALUE(value, '$.key') COLLATE Latin1_General_100_BIN2 = @appKey)
        ORDER BY CASE WHEN [key] LIKE @prefix THEN 0 ELSE 1 END, updated_at DESC, [key];`);
      const recipes: TaskRecipe[] = [];
      const ids = new Set<string>();
      for (const row of recordset) {
        if (Buffer.byteLength(row.value) > 32_768) continue;
        try {
          const recipe: unknown = JSON.parse(row.value);
          if (validRecipe(recipe) && !ids.has(recipe.id)) {
            ids.add(recipe.id);
            recipes.push(recipe);
          }
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
          .input('legacyKey', sql.NVarChar(128), legacyPrefix + recipe.id)
          .input('prefix', sql.NVarChar(128), `${prefix}%`)
          .input('legacyPrefix', sql.NVarChar(128), `${legacyPrefix}%`)
          .input('id', sql.NVarChar(64), recipe.id)
          .input('value', sql.NVarChar(sql.MAX), value);
        const abort = () => { request.cancel(); };
        signal?.addEventListener('abort', abort, { once: true });
        try {
          signal?.throwIfAborted();
          await request.query(`
            DECLARE @lock int;
            EXEC @lock = sys.sp_getapplock @Resource=N'jarvis.task-recipes',
              @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=5000;
            IF @lock < 0 THROW 51000, 'Routine lock unavailable', 1;
            DECLARE @existingValue nvarchar(max);
            SELECT TOP (1) @existingValue=value FROM dbo.settings
              WHERE scope=N'global' AND [key] IN (@key, @legacyKey)
              ORDER BY CASE WHEN [key]=@key THEN 0 ELSE 1 END;
            IF ISJSON(@existingValue)=1
            BEGIN
              IF JSON_VALUE(@existingValue, '$.id')=@id AND JSON_VALUE(@existingValue, '$.name') IS NOT NULL
                SET @value=JSON_MODIFY(@value, '$.name', JSON_VALUE(@existingValue, '$.name'));
            END;
            IF @existingValue IS NULL
              AND (SELECT COUNT(DISTINCT JSON_VALUE(value, '$.id')) FROM dbo.settings
                WHERE scope=N'global' AND ([key] LIKE @prefix OR [key] LIKE @legacyPrefix)) >= 100
              THROW 51001, 'Routine capacity reached', 1;
            MERGE dbo.settings WITH (HOLDLOCK) AS target
            USING (SELECT N'global' AS scope, @key AS [key], @value AS value) AS source
            ON target.scope=source.scope AND target.[key]=source.[key]
            WHEN MATCHED THEN UPDATE SET value=source.value, updated_at=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (scope, [key], value) VALUES (source.scope, source.[key], source.value);
            DELETE FROM dbo.settings WHERE scope=N'global' AND [key]=@legacyKey;`);
          signal?.throwIfAborted();
          await transaction.commit();
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
        throw new Error('Task routine could not be saved');
      }
    },
    async rename(id, name) {
      if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('Invalid task routine ID');
      const normalizedName = normalizeRoutineName(name);
      if (!normalizedName) throw new Error('Invalid task routine name');
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();
        const { recordset } = await transaction.request()
          .input('id', sql.NVarChar(64), id)
          .input('key', sql.NVarChar(128), prefix + id)
          .input('legacyKey', sql.NVarChar(128), legacyPrefix + id)
          .input('name', sql.NVarChar(routineNameMaxLength * 2), normalizedName)
          .query(`
            DECLARE @lock int;
            EXEC @lock = sys.sp_getapplock @Resource=N'jarvis.task-recipes',
              @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=5000;
            IF @lock < 0 THROW 51000, 'Routine lock unavailable', 1;
            DECLARE @value nvarchar(max);
            SELECT TOP (1) @value=value FROM dbo.settings
              WHERE scope=N'global' AND [key] IN (@key, @legacyKey)
              ORDER BY CASE WHEN [key]=@key THEN 0 ELSE 1 END;
            IF @value IS NULL OR ISJSON(@value)<>1 OR JSON_VALUE(@value, '$.id')<>@id
            BEGIN
              SELECT CAST(0 AS bit) AS updated;
              RETURN;
            END;
            SET @value=JSON_MODIFY(@value, '$.name', @name);
            IF DATALENGTH(@value)>65536
            BEGIN
              SELECT CAST(0 AS bit) AS updated;
              RETURN;
            END;
            MERGE dbo.settings WITH (HOLDLOCK) AS target
            USING (SELECT N'global' AS scope, @key AS [key], @value AS value) AS source
            ON target.scope=source.scope AND target.[key]=source.[key]
            WHEN MATCHED THEN UPDATE SET value=source.value, updated_at=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (scope, [key], value) VALUES (source.scope, source.[key], source.value);
            DELETE FROM dbo.settings WHERE scope=N'global' AND [key]=@legacyKey;
            SELECT CAST(1 AS bit) AS updated;`);
        await transaction.commit();
        return recordset[0]?.updated === true;
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
        throw new Error('Task routine could not be updated');
      }
    },
    async delete(id) {
      if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('Invalid task routine ID');
      const result = await pool.request()
        .input('key', sql.NVarChar(128), prefix + id)
        .input('legacyKey', sql.NVarChar(128), legacyPrefix + id)
        .query("DELETE FROM dbo.settings WHERE scope=N'global' AND [key] IN (@key, @legacyKey);");
      return result.rowsAffected[0]! > 0;
    },
  };
}

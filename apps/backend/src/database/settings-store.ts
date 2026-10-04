import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import { defaultSettings, flattenSettings, type SettingsPatch, type SettingsStore } from '../core/settings.js';

export function createSettingsStore(pool: sql.ConnectionPool): SettingsStore {
  const keys = flattenSettings(defaultSettings).map(({ key }) => key);
  const keyParameters = keys.map((_key, index) => `@key${index}`);
  return {
    async read() {
      const request = databaseReadRequest(pool).input('scope', sql.NVarChar(64), 'global');
      keys.forEach((key, index) => { request.input(`key${index}`, sql.NVarChar(128), key); });
      const result = await request.query<{ key: string; value: string }>(
        `SELECT [key], value FROM dbo.settings WHERE scope = @scope AND [key] IN (${keyParameters.join(', ')});`,
      );
      return Object.fromEntries(result.recordset.map(({ key, value }) => [key, value]));
    },
    async write(settings: SettingsPatch) {
      const entries = flattenSettings(settings);
      if (entries.length === 0) return;

      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();
        for (const { key, value } of entries) {
          await transaction.request()
            .input('scope', sql.NVarChar(64), 'global')
            .input('key', sql.NVarChar(128), key)
            .input('value', sql.NVarChar(sql.MAX), value)
            .query(`MERGE dbo.settings WITH (HOLDLOCK) AS target
              USING (SELECT @scope AS scope, @key AS [key], @value AS value) AS source
              ON target.scope = source.scope AND target.[key] = source.[key]
              WHEN MATCHED THEN UPDATE SET value = source.value, updated_at = SYSUTCDATETIME()
              WHEN NOT MATCHED THEN INSERT (scope, [key], value) VALUES (source.scope, source.[key], source.value);`);
        }
        await transaction.commit();
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
        throw new Error('Settings could not be saved');
      }
    },
  };
}

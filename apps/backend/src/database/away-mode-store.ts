import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import {
  defaultAwayModeState,
  observeAwayPresence,
  parseAwayModeState,
  setAwayMode,
  type AwayModeState,
  type AwayModeStore,
} from '../core/away-mode.js';

const settingKey = 'away.mode.state';

interface StoredStateRow {
  value: string;
}

export function createAwayModeStore(
  pool: sql.ConnectionPool,
  onModeChanged: () => void = () => {},
): AwayModeStore {
  async function read(request: sql.Request | sql.Transaction): Promise<AwayModeState> {
    const result = await (request instanceof sql.Transaction ? new sql.Request(request) : request)
      .input('scope', sql.NVarChar(64), 'global')
      .input('key', sql.NVarChar(128), settingKey)
      .query<StoredStateRow>('SELECT value FROM dbo.settings WHERE scope = @scope AND [key] = @key;');
    if (!result.recordset[0]) return { ...defaultAwayModeState };
    let value: unknown;
    try { value = JSON.parse(result.recordset[0].value) as unknown; }
    catch { throw new Error('Away mode state is invalid'); }
    const state = parseAwayModeState(value);
    if (JSON.stringify(value) !== JSON.stringify(state)) throw new Error('Away mode state is invalid');
    return state;
  }

  async function update(
    transition: (state: AwayModeState) => AwayModeState,
  ): Promise<AwayModeState> {
    const transaction = new sql.Transaction(pool);
    let modeChanged: boolean;
    let next: AwayModeState;
    try {
      await transaction.begin();
      const request = new sql.Request(transaction);
      const lock = await request
        .input('resource', sql.NVarChar(255), 'jarvis.away-mode')
        .query<{ result: number }>(`DECLARE @result int;
          EXEC @result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
            @LockOwner='Transaction', @LockTimeout=10000;
          SELECT @result AS result;`);
      if ((lock.recordset[0]?.result ?? -999) < 0) throw new Error('Away mode lock unavailable');

      const previous = await read(transaction);
      next = transition(previous);
      modeChanged = previous.away !== next.away;
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        await new sql.Request(transaction)
          .input('scope', sql.NVarChar(64), 'global')
          .input('key', sql.NVarChar(128), settingKey)
          .input('value', sql.NVarChar(sql.MAX), JSON.stringify(next))
          .query(`MERGE dbo.settings WITH (HOLDLOCK) AS target
            USING (SELECT @scope AS scope, @key AS [key], @value AS value) AS source
            ON target.scope = source.scope AND target.[key] = source.[key]
            WHEN MATCHED THEN UPDATE SET value = source.value, updated_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (scope, [key], value) VALUES (source.scope, source.[key], source.value);`);
      }
      if (modeChanged) {
        await new sql.Request(transaction)
          .input('area', sql.NVarChar(32), 'core')
          .input('kind', sql.NVarChar(64), 'away_mode')
          .input('title', sql.NVarChar(400), next.away ? 'Away mode is on' : 'Away mode is off')
          .query(`INSERT dbo.activity (area, kind, title) VALUES (@area, @kind, @title);`);
      }
      await transaction.commit();
    } catch {
      try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
      throw new Error('Away mode could not be saved');
    }
    if (modeChanged) onModeChanged();
    return next;
  }

  return {
    async read() {
      try {
        const request = databaseReadRequest(pool);
        return await read(request);
      } catch {
        throw new Error('Away mode is unavailable');
      }
    },
    set(away, at = new Date()) {
      if (typeof away !== 'boolean') throw new TypeError('Away mode must be a boolean');
      return update((state) => setAwayMode(state, away, 'manual', at));
    },
    markPresent(at = new Date()) {
      return update((state) => setAwayMode(state, false, 'browser', at));
    },
    observePresence(away, at = new Date()) {
      if (away !== null && typeof away !== 'boolean') throw new TypeError('Presence state is invalid');
      return update((state) => observeAwayPresence(state, away, at));
    },
  };
}

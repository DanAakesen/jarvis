import sql from 'mssql';
import type { DailyWeatherStore } from '../proactive/sources/daily-weather.js';

export function createDailyWeatherStore(pool: sql.ConnectionPool, owner: string): DailyWeatherStore {
  const request = (day: string) => pool.request()
    .input('owner', sql.UniqueIdentifier, owner).input('day', sql.Char(10), day);
  return {
    async claim(day, eventRef) {
      const result = await request(day).input('ref', sql.NVarChar(512), eventRef).query(
        `INSERT INTO dbo.pi_daily_weather (owner_object_id, local_day, event_ref)
         SELECT @owner, @day, @ref WHERE NOT EXISTS (
           SELECT 1 FROM dbo.pi_daily_weather WITH (UPDLOCK, HOLDLOCK)
           WHERE owner_object_id=@owner AND local_day=@day);`);
      return result.rowsAffected[0] === 1;
    },
    async save(day, result) {
      await request(day).input('result', sql.NVarChar(sql.MAX), JSON.stringify(result)).query(
        'UPDATE dbo.pi_daily_weather SET result_json=@result WHERE owner_object_id=@owner AND local_day=@day AND result_json IS NULL;');
    },
    async read(day) {
      const result = await request(day).query<{ result_json: string | null; event_ref: string }>(
        'SELECT result_json, event_ref FROM dbo.pi_daily_weather WHERE owner_object_id=@owner AND local_day=@day;');
      const row = result.recordset[0];
      return row ? { eventRef: row.event_ref, result: row.result_json ? JSON.parse(row.result_json) : null } : null;
    },
  };
}

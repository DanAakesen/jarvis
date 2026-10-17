import sql from 'mssql';
import type { ToolCallStore } from '../core/tool-calls.js';

function serialize(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    if (result !== undefined) return result;
  } catch { /* Report a stable, sanitized persistence error. */ }
  throw new Error('Tool call data is not JSON serializable');
}

export function createToolCallStore(pool: sql.ConnectionPool): ToolCallStore {
  return {
    async recordDailyMcp(call) {
      if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(call.requestId) ||
          !['read_nutrition', 'lookup_food', 'log_food', 'correct_food', 'delete_food', 'read_food_preferences', 'manage_saved_food'].includes(call.tool) ||
          !['awaiting_confirmation', 'ok', 'refused', 'error'].includes(call.phase) ||
          !['ok', 'refused', 'error'].includes(call.outcome)) throw new TypeError('Invalid Daily connector audit metadata');
      const request = pool.request()
        .input('requestId', sql.UniqueIdentifier, call.requestId)
        .input('tool', sql.NVarChar(64), `daily_mcp_${call.tool}`)
        .input('arguments', sql.NVarChar(sql.MAX), '{"redacted":true}')
        .input('result', sql.NVarChar(sql.MAX), JSON.stringify({ redacted: true, phase: call.phase }))
        .input('outcome', sql.NVarChar(16), call.outcome);
      const signal = AbortSignal.timeout(5000);
      const cancel = () => request.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        signal.throwIfAborted();
        await request.query(`INSERT INTO dbo.tool_calls (message_id, connector_request_id, tool, [arguments], result, outcome, at)
          VALUES (NULL, @requestId, @tool, @arguments, @result, @outcome, SYSUTCDATETIME());`);
      } finally { signal.removeEventListener('abort', cancel); }
    },
    async record(call) {
      const argumentsJson = serialize(call.arguments);
      const resultJson = serialize(call.result);
      await pool.request()
        .input('messageId', sql.BigInt, BigInt(call.messageId))
        .input('tool', sql.NVarChar(64), call.tool)
        .input('arguments', sql.NVarChar(sql.MAX), argumentsJson)
        .input('result', sql.NVarChar(sql.MAX), resultJson)
        .input('outcome', sql.NVarChar(16), call.outcome)
        .query(`INSERT INTO dbo.tool_calls (message_id, tool, [arguments], result, outcome, at)
          VALUES (@messageId, @tool, @arguments, @result, @outcome, SYSUTCDATETIME());`);
    },
    async listCodexToolCalls(from, to) {
      const result = await pool.request()
        .input('from', sql.DateTime2(7), from)
        .input('to', sql.DateTime2(7), to)
        .query<{ tool: 'web_research'; count: string }>(`SELECT tool, CONVERT(varchar(20), COUNT_BIG(1)) AS count
          FROM dbo.tool_calls
          WHERE tool = N'web_research' AND [at] >= @from AND [at] < @to
          GROUP BY tool;`);
      return result.recordset;
    },
  };
}

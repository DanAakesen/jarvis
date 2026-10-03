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
  };
}

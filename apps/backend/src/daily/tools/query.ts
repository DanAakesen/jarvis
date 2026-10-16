import { dailyQuerySchema } from '@jarvis/contracts';
import type { JarvisTool } from '../../core/tool-registry.js';
import type { DailyQueryService } from '../query.js';

export function dailyQueryTool(service: Pick<DailyQueryService, 'query'>): JarvisTool {
  return {
    name: 'daily_query',
    description: 'Read retained Daily health, sleep, workouts, minute heart rate, meal history or sync evidence. Supply the exact source and period/cursor. Nullable values are unknown, not zero; completeness/staleness are not inferred. Read-only: never log food or claim live device sync.',
    inputSchema: dailyQuerySchema,
    sensitive: true,
    execute: (input, request, signal) => service.query(input, request, signal),
  };
}

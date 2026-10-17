import { dailyQuerySchema } from '@jarvis/contracts';
import type { JarvisTool } from '../../core/tool-registry.js';
import type { DailyQueryService } from '../query.js';

export function dailyQueryTool(service: Pick<DailyQueryService, 'query'>): JarvisTool {
  return {
    name: 'daily_query',
    description: 'Read retained Daily health, sleep, workouts, minute heart rate, meal history, favourites, meal plans or sync evidence. Supply the exact source and its period/cursor; favourites/plans use ID-only cursors without dates and are definitions, not logged intake. Nullable values are unknown, not zero; completeness/staleness are not inferred. Read-only: never log food or claim live device sync. For requested on-screen results, query first, then use workspace_command to create/update a text view, or a chart only when requested. Use only returned records and units; preserve duplicate-date observations, identify the loaded page/period and unknown coverage, never interpolate or turn null into zero. Do not claim a page filter was changed by navigation: navigate to daily only opens the page; present requested filtered results in the shared view and wait for its applied acknowledgement.',
    inputSchema: dailyQuerySchema,
    sensitive: true,
    execute: (input, request, signal) => service.query(input, request, signal),
  };
}

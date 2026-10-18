import { dailyTables, type DailyTable } from '../store/schema.js';

export type Decision = 'import' | 'import-after-ruling' | 'exclude';
export interface TableDecision {
  decision: Decision;
  reason: string;
  target: DailyTable | null;
  sourceKey: readonly string[];
  parents: readonly { table: DailyTable; column: string; key: string }[];
  excludedColumns: readonly string[];
  integerColumns: readonly string[];
}

const integers: Partial<Record<DailyTable, readonly string[]>> = {
  health_ingestions: ['content_bytes'],
  health_raw_objects: ['content_bytes'],
  health_daily_metrics: ['sample_count'],
  health_sleep_daily: ['segment_count'],
  health_workout_metrics: ['sample_count'],
  health_workout_heart_rate_minute: ['sample_count'],
  health_sync_state: ['id'],
  health_phone_sync_state: ['id'],
  nutrition_meals: ['revision'],
  nutrition_meal_plans: ['revision'],
  coach_profiles: ['steps_target', 'gym_target_weekly', 'run_target_weekly', 'revision'],
  readiness_checkins: ['feeling_rating'],
  attention_source_snapshots: ['item_count'],
  attention_items: ['priority'],
  coach_experiments: ['target_days', 'baseline_days'],
};

const parents: Partial<Record<DailyTable, TableDecision['parents']>> = {
  health_workout_metrics: [{ table: 'health_workouts', column: 'workout_id', key: 'id' }],
  health_workout_heart_rate_minute: [{ table: 'health_workouts', column: 'workout_id', key: 'id' }],
  attention_source_snapshots: [{ table: 'attention_runs', column: 'run_id', key: 'id' }],
  attention_items: [{ table: 'attention_source_snapshots', column: 'snapshot_id', key: 'id' }],
};

export const MIXED_TABLES = ['attention_runs', 'attention_source_snapshots', 'attention_items', 'briefing_runs', 'attention_rule_config'] as const;
export const EXCLUDED_TABLES = ['mcp_oauth_codes', 'mcp_oauth_tokens', 'mcp_oauth_refresh_tokens', 'widget_auth_attempts'] as const;

/** Source decisions, not a source-schema completeness assertion. No target-only columns. */
export const decisions: Readonly<Record<string, TableDecision>> = Object.freeze(Object.fromEntries([
  ...Object.entries(dailyTables).map(([name, definition]) => {
    const table = name as DailyTable;
    return [name, {
      decision: (MIXED_TABLES as readonly string[]).includes(name) ? 'import-after-ruling' : 'import',
      reason: (MIXED_TABLES as readonly string[]).includes(name) ? 'mixed-source-review' : 'mapped-source',
      target: table,
      sourceKey: table === 'coach_profiles' ? ['owner_email'] : definition.keys,
      parents: parents[table] ?? [],
      excludedColumns: table === 'nutrition_queue' ? ['owner_email', 'claim_token'] : ['owner_email'],
      integerColumns: integers[table] ?? [],
    } satisfies TableDecision];
  }),
  ...EXCLUDED_TABLES.map(name => [name, {
    decision: 'exclude', reason: 'legacy-credential', target: null,
    sourceKey: [], parents: [], excludedColumns: [], integerColumns: [],
  } satisfies TableDecision]),
]));

/** Registry order is already parent-before-child, and is pinned by a SQL cross-check. */
export const IMPORT_ORDER = Object.keys(dailyTables) as DailyTable[];

export const SOURCE_CHECKS = {
  attention_source_snapshots: { column: 'source', excludesCaseInsensitiveSubstring: 'ticktick', allowedValues: null },
  attention_items: { column: 'source', excludesCaseInsensitiveSubstring: 'ticktick', allowedValues: null },
  attention_rule_config: { column: 'source', excludesCaseInsensitiveSubstring: 'ticktick', allowedValues: null },
} as const;

/** 0050 revisions are target-only and intentionally absent from source registry metadata. */
export const TARGET_ONLY_COLUMNS = {
  nutrition_queue: ['source_revision', 'claim_token', 'claim_device_id', 'receipt_json', 'reconciliation_json'],
  nutrition_favorites: ['revision'],
  nutrition_recommendation_feedback: ['revision'],
} as const;

const nutrients = ['energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams'];
const measurements = ['value', 'min_value', 'avg_value', 'max_value'];
const floatColumns: Partial<Record<DailyTable, readonly string[]>> = {
  health_daily_metrics: measurements,
  health_sleep_daily: ['total_sleep_hours', 'asleep_hours', 'core_hours', 'deep_hours', 'rem_hours', 'awake_hours', 'in_bed_hours'],
  health_workouts: ['duration_seconds', 'active_energy_value', 'total_energy_value', 'distance_value', 'avg_heart_rate', 'max_heart_rate'],
  health_workout_metrics: measurements,
  health_workout_heart_rate_minute: ['min_value', 'avg_value', 'max_value'],
  nutrition_queue: nutrients, nutrition_meals: nutrients, nutrition_favorites: nutrients, nutrition_meal_plans: nutrients,
  coach_profiles: ['deficit_rate', 'protein_minimum_grams', 'protein_per_kg', 'sleep_target_hours'],
  coach_commitments: ['target_value', 'baseline_value'], coach_experiments: ['target_value', 'baseline_value'],
};
const dateColumns: Partial<Record<DailyTable, readonly string[]>> = {
  health_daily_metrics: ['metric_date'], health_sleep_daily: ['sleep_date'], health_workouts: ['workout_date'],
  nutrition_meals: ['meal_date'], coach_profiles: ['date_of_birth'], coach_commitments: ['commitment_date'],
  readiness_checkins: ['checkin_date'], recovery_days: ['recovery_date'],
  coach_experiments: ['starts_on', 'ends_on', 'review_start_date', 'review_end_date'],
};
const bitColumns: Partial<Record<DailyTable, readonly string[]>> = {
  health_workouts: ['is_indoor'], attention_items: ['is_all_day'],
};
export type SourceColumnType = 'nvarchar' | 'bigint' | 'float' | 'date' | 'bit';
/** Source-registry columns only; independently checked against 0041 and additive 0043. */
export const columnTypes: Readonly<Record<DailyTable, Readonly<Record<string, SourceColumnType>>>> = Object.fromEntries(
  Object.entries(dailyTables).map(([name, definition]) => {
    const table = name as DailyTable;
    return [name, Object.fromEntries(definition.columns.map(column => [column,
      decisions[table]!.integerColumns.includes(column) ? 'bigint'
        : floatColumns[table]?.includes(column) ? 'float'
          : dateColumns[table]?.includes(column) ? 'date'
            : bitColumns[table]?.includes(column) ? 'bit' : 'nvarchar',
    ]))];
  }),
) as Record<DailyTable, Record<string, SourceColumnType>>;

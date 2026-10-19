import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readMigrations } from '../database/migrations.js';

type ExpectedTable = { columns: number; fingerprint: string };
type UnmappedColumn = { reason: string };

const sourceSchemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/reference/daily-v182/daily-source-schema.sql');

const expectedTables: Record<string, ExpectedTable> = {
  attention_items: { columns: 13, fingerprint: 'd67105097173ad495747c6cbd284963e9bad8866038bd022adf96aae20256a49' },
  attention_rule_config: { columns: 4, fingerprint: '6b8020c21f42aee38072252a155d3166916d9c47d81c43e0c37f5e0b2f86d56a' },
  attention_runs: { columns: 9, fingerprint: 'd1598af0b37accc3672f12d2eb0b9fe29ff8cda73351bf9306eada4468f4747c' },
  attention_source_snapshots: { columns: 10, fingerprint: 'd27a275ba29a6a2cd767511ac46013dbf587acae9c5b95a717c73e2eee037ac7' },
  briefing_runs: { columns: 13, fingerprint: 'defc55b7710d6765c1c89c7c06939397b9792df4c21b08a122115fe22a06b428' },
  coach_commitments: { columns: 14, fingerprint: 'b0106c9bc8b09037b0158bd50a03a3a5dbea8b0f1362dbbb43daebb2b640be2d' },
  coach_experiments: { columns: 19, fingerprint: '821cb06fc7334f95262dd835ad510c87906ed9bff6d6af4d50cc7f9f0051fa99' },
  coach_profiles: { columns: 21, fingerprint: '15f5dd34f92d6a79e7debecd5ab725a453fbe0936a1550ef44eb0fca82f5dda9' },
  gmail_suppressions: { columns: 6, fingerprint: 'd09c99ddafd5258e666d98ddff24b515ec23488d439da00dacb9636ba34072c7' },
  health_daily_metrics: { columns: 13, fingerprint: '8e66063f76fa75a5ef58d1808f209b51066a5eb389834d47ed805bad844ac491' },
  health_ingestions: { columns: 12, fingerprint: '1eea560a9876f412ad28018084168f801664b15a4947bc0d2f520b3eada19fb2' },
  health_phone_sync_state: { columns: 5, fingerprint: '222230de0a7932004c760fa381a2da47b53025dac600c321f0e30f9c8814ecf7' },
  health_raw_objects: { columns: 11, fingerprint: '7f0336c22d9c285007ad3902a8b2e411514c74969413d611556d5558b33dc823' },
  health_sleep_daily: { columns: 14, fingerprint: 'cb7ac49ab19861363467cc3a0924a74c49dbcca4688d54910a59660d2abe1e6a' },
  health_sync_feeds: { columns: 7, fingerprint: '9a2fcdd9ef255ec592340e8a5100392916ea22f8e76c85796d98ce59ec5a1a78' },
  health_sync_state: { columns: 11, fingerprint: '7d58bf8e1629b11417966a58e9552b28dc40db59de4d52ff6feb66fac5282679' },
  health_workout_heart_rate_minute: { columns: 11, fingerprint: '07be8c471da64d63c68c3077491ea06ed1964c084a93d7494a0e15fad002f7b5' },
  health_workout_metrics: { columns: 11, fingerprint: 'd22568304c80c43a4034c1be8f0349ee2f5723dea0d963d16e3f284ebcd84760' },
  health_workouts: { columns: 20, fingerprint: 'f6521727e426fec2a00b7309d3814405ea8b5163958ac06c32c032f2b848dc2d' },
  mcp_oauth_codes: { columns: 10, fingerprint: '94d2ad7e2afe4ec6be408d70abf7d6f02d82477d8dbc2994471431f461bccb71' },
  mcp_oauth_refresh_tokens: { columns: 8, fingerprint: '16e4974741f7528bcc5acd9e96e9a720f12be4741d4d0c6c1a1931747cb39aad' },
  mcp_oauth_tokens: { columns: 8, fingerprint: '16e4974741f7528bcc5acd9e96e9a720f12be4741d4d0c6c1a1931747cb39aad' },
  nutrition_favorites: { columns: 18, fingerprint: '101343bf164f8344b57a6f4f431c904be76134ab52cd3bb515cac6711e254c1c' },
  nutrition_meal_plans: { columns: 15, fingerprint: '0e6e4a753804c362323f1cfcc80f114a4a053bea868e69b13fa18c8d50626c22' },
  nutrition_meals: { columns: 26, fingerprint: '1b4dd38f008894d049b1cad31ab3a5a34075a47b26275748ecca14c1c85328f9' },
  nutrition_queue: { columns: 24, fingerprint: 'e251eda6b997e0d4df0b89b62772a69dc1a420dafb6cc8feba2982c88ff33005' },
  nutrition_recommendation_feedback: { columns: 5, fingerprint: 'a68233772647398b9827643227f18a3d36890629243129a23c9a7c97a0458e25' },
  order_suppressions: { columns: 6, fingerprint: '865fa13616ac8338305968c8ea43be9f49f0537a36066e8fde798a915b2cf298' },
  readiness_checkins: { columns: 7, fingerprint: 'd88f9e0304e9760ef1e49b5a2a2b100d5787f0040ef79ca7111710a8b5c6cec6' },
  recovery_days: { columns: 5, fingerprint: '88cc6ad305fc274c74b2ccf5f3b445a3bb0ddb9e6fd7a2fe0b2ce4e6186b4185' },
  widget_auth_attempts: { columns: 4, fingerprint: '0998a8f88f971a6228f8e098095decec15f0eeff03ecba9e3f19fa65a76a6709' },
};

const sourceTargets: Record<string, string> = {
  coach_commitments: 'daily.coach_commitments',
  coach_experiments: 'daily.coach_experiments',
  coach_profiles: 'daily.coach_profiles',
  health_daily_metrics: 'daily.health_daily_metrics',
  health_ingestions: 'daily.health_ingestions',
  health_phone_sync_state: 'daily.health_phone_sync_state',
  health_raw_objects: 'daily.health_upload_inbox',
  health_sleep_daily: 'daily.health_sleep_daily',
  health_sync_feeds: 'daily.health_sync_feeds',
  health_sync_state: 'daily.health_sync_state',
  health_workout_heart_rate_minute: 'daily.health_workout_heart_rate_minute',
  health_workout_metrics: 'daily.health_workout_metrics',
  health_workouts: 'daily.health_workouts',
  nutrition_favorites: 'daily.nutrition_favorites',
  nutrition_meal_plans: 'daily.nutrition_meal_plans',
  nutrition_meals: 'daily.nutrition_meals',
  nutrition_queue: 'daily.nutrition_queue',
  nutrition_recommendation_feedback: 'daily.nutrition_recommendation_feedback',
  readiness_checkins: 'daily.readiness_checkins',
  recovery_days: 'daily.recovery_days',
};

const excludedColumns: Record<string, { columns: string[]; reason: string }> = {
  attention_items: {
    columns: ['snapshot_id', 'source', 'item_type', 'stable_id', 'parent_id', 'title', 'starts_at', 'ends_at', 'due_at', 'priority', 'is_all_day', 'state', 'content_json'],
    reason: 'The selected Jarvis scope excludes source attention snapshots and derived attention items.',
  },
  attention_rule_config: {
    columns: ['key', 'value_json', 'source', 'updated_at'],
    reason: 'The selected Jarvis scope excludes the source attention rule engine.',
  },
  attention_runs: {
    columns: ['id', 'idempotency_key', 'mode', 'captured_at', 'received_at', 'checksum', 'status', 'source_status_json', 'completed_at'],
    reason: 'The selected Jarvis scope excludes the source attention snapshot pipeline.',
  },
  attention_source_snapshots: {
    columns: ['id', 'run_id', 'source', 'status', 'captured_at', 'received_at', 'item_count', 'checksum', 'error_code', 'error_message'],
    reason: 'The selected Jarvis scope excludes the source attention snapshot pipeline.',
  },
  briefing_runs: {
    columns: ['id', 'trigger', 'started_at', 'completed_at', 'status', 'preview_text', 'body_json', 'source_snapshots_json', 'health_status', 'delivery_status', 'delivered_at', 'delivery_evidence_json', 'updated_at'],
    reason: 'The fixed and scheduled source brief renderer is excluded from the selected Jarvis scope.',
  },
  gmail_suppressions: {
    columns: ['thread_id', 'suppressed_message_id', 'suppressed_incoming_at', 'suppressed_at', 'revived_at', 'updated_at'],
    reason: 'Source-specific Gmail suppression state is excluded from the selected Jarvis scope.',
  },
  mcp_oauth_codes: {
    columns: ['code_hash', 'client_id', 'redirect_uri', 'resource', 'scope', 'code_challenge', 'email', 'created_at', 'expires_at', 'consumed_at'],
    reason: 'A parallel Daily MCP authentication runtime is excluded from the selected Jarvis scope.',
  },
  mcp_oauth_refresh_tokens: {
    columns: ['token_hash', 'email', 'client_id', 'resource', 'scope', 'issued_at', 'expires_at', 'revoked_at'],
    reason: 'A parallel Daily MCP authentication runtime is excluded from the selected Jarvis scope.',
  },
  mcp_oauth_tokens: {
    columns: ['token_hash', 'email', 'client_id', 'resource', 'scope', 'issued_at', 'expires_at', 'revoked_at'],
    reason: 'A parallel Daily MCP authentication runtime is excluded from the selected Jarvis scope.',
  },
  order_suppressions: {
    columns: ['owner_email', 'order_key', 'suppressed_order_updated_at', 'suppressed_at', 'revived_at', 'updated_at'],
    reason: 'Source coach-order suppression state is excluded from the selected Jarvis scope.',
  },
  widget_auth_attempts: {
    columns: ['fingerprint_hash', 'window_started_at', 'attempts', 'updated_at'],
    reason: 'The legacy widget authentication and renderer are excluded from the selected Jarvis scope.',
  },
};

const notMappedColumns: Record<string, UnmappedColumn> = {
  'coach_commitments.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'coach_experiments.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'coach_profiles.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.ingestion_id': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.object_key': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.sanitized_checksum': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.content_bytes': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.content_type': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.stored_at': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.expires_at': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.storage_status': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.last_error': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'health_raw_objects.deleted_at': {
    reason: 'The source raw-object lifecycle has no verified field mapping to the per-request SQL upload inbox. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'nutrition_favorites.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'nutrition_meal_plans.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'nutrition_meals.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'nutrition_queue.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'nutrition_queue.claim_token': {
    reason: 'The source claim_token has no exact-name target column and no verified mapping to the Jarvis queue lease fields. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'nutrition_recommendation_feedback.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'readiness_checkins.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
  'recovery_days.owner_email': {
    reason: 'The source owner_email has no exact-name target column; no verified rename evidence establishes its correspondence to Jarvis owner_object_id. See the proposed schema field-mapping question in docs/decisions.md.',
  },
};

const renamedColumns: Record<string, { targetColumn: string; evidence: string }> = {};

function splitSqlList(definition: string): string[] {
  const clauses: string[] = [];
  let clause = '';
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < definition.length; index++) {
    const character = definition[index]!;
    if (quote) {
      clause += character;
      if (character === quote) {
        if (definition[index + 1] === quote) {
          clause += definition[++index]!;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      clause += character;
    } else if (character === '(') {
      depth++;
      clause += character;
    } else if (character === ')') {
      depth--;
      clause += character;
    } else if (character === ',' && depth === 0) {
      clauses.push(clause);
      clause = '';
    } else {
      clause += character;
    }
  }
  clauses.push(clause);
  return clauses;
}

function readDefinitionEnd(sql: string, opening: number): number {
  let depth = 1;
  let quote: string | null = null;
  for (let index = opening + 1; index < sql.length; index++) {
    const character = sql[index]!;
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) index++;
        else quote = null;
      }
    } else if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '(') {
      depth++;
    } else if (character === ')' && --depth === 0) {
      return index;
    }
  }
  throw new Error('Unclosed Jarvis migration table definition');
}

function parseSourceTables(ddl: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  const declaration = /CREATE TABLE\s+(?:`([^`]+)`|"([^"]+)")\s*\(/giu;
  for (const match of ddl.matchAll(declaration)) {
    const name = match[1] ?? match[2]!;
    const opening = match.index + match[0].lastIndexOf('(');
    const closing = readDefinitionEnd(ddl, opening);
    const columns = splitSqlList(ddl.slice(opening + 1, closing)).flatMap(clause => {
      const column = clause.trim().match(/^(?:`([^`]+)`|"([^"]+)")\s+\S+/u);
      return column ? [column[1] ?? column[2]!] : [];
    });
    tables.set(name, columns);
  }
  return tables;
}

function parseMigrationTables(migrations: readonly { sql: string }[]): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const create = /CREATE TABLE\s+(?:\[?daily\]?)\.(?:\[([^\]]+)\]|([A-Za-z_][\w$]*))\s*\(/giu;
  const addColumn = /ALTER TABLE\s+(?:\[?daily\]?)\.(?:\[([^\]]+)\]|([A-Za-z_][\w$]*))\s+ADD\s+(?!CONSTRAINT\b|CHECK\b|PRIMARY\b|UNIQUE\b|FOREIGN\b)(?:\[([^\]]+)\]|([A-Za-z_][\w$]*))\s+/giu;

  for (const { sql } of migrations) {
    for (const match of sql.matchAll(create)) {
      const name = match[1] ?? match[2]!;
      const opening = match.index + match[0].lastIndexOf('(');
      const closing = readDefinitionEnd(sql, opening);
      const columns = splitSqlList(sql.slice(opening + 1, closing)).flatMap(clause => {
        const column = clause.trim().match(/^(?:\[([^\]]+)\]|([A-Za-z_][\w$]*))\s+\S+/u);
        if (!column) return [];
        const name = column[1] ?? column[2]!;
        return /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)$/iu.test(name) ? [] : [name];
      });
      const target = tables.get(name) ?? new Set<string>();
      for (const column of columns) target.add(column);
      tables.set(name, target);
    }
    for (const match of sql.matchAll(addColumn)) {
      const table = match[1] ?? match[2]!;
      const column = match[3] ?? match[4]!;
      tables.get(table)?.add(column);
    }
  }
  return tables;
}

function fingerprint(columns: string[]): string {
  return createHash('sha256').update(columns.join('\n')).digest('hex');
}

describe('pinned Daily v182 source schema inventory', () => {
  it('classifies every source column against columns created by Jarvis SQL migrations', async () => {
    const sourceTables = parseSourceTables(readFileSync(sourceSchemaPath, 'utf8'));
    const jarvisTables = parseMigrationTables(await readMigrations());
    expect(sourceTables.size).toBe(31);
    expect(Object.keys(expectedTables).sort()).toEqual([...sourceTables.keys()].sort());

    for (const [table, columns] of sourceTables) {
      expect(columns).toHaveLength(expectedTables[table]!.columns);
      expect(fingerprint(columns)).toBe(expectedTables[table]!.fingerprint);
    }

    const excludedByColumn = new Map<string, string>();
    for (const [table, disposition] of Object.entries(excludedColumns)) {
      expect(disposition.reason.trim().length).toBeGreaterThan(0);
      for (const column of disposition.columns) {
        const key = `${table}.${column}`;
        expect(excludedByColumn.has(key), `duplicate exclusion for ${key}`).toBe(false);
        excludedByColumn.set(key, disposition.reason);
      }
    }

    const explicitColumnKeys = [
      ...excludedByColumn.keys(),
      ...Object.keys(renamedColumns),
      ...Object.keys(notMappedColumns),
    ];
    expect(new Set(explicitColumnKeys).size).toBe(explicitColumnKeys.length);

    const sourceColumnKeys = new Set([...sourceTables].flatMap(([table, columns]) => columns.map(column => `${table}.${column}`)));
    for (const key of explicitColumnKeys) {
      expect(sourceColumnKeys.has(key), `classification names an unknown source column: ${key}`).toBe(true);
    }
    for (const table of Object.keys(sourceTargets)) {
      expect(sourceTables.has(table), `target mapping names an unknown source table: ${table}`).toBe(true);
    }

    let mappedColumns = 0;
    let renamedColumnCount = 0;
    let excludedColumnCount = 0;
    let notMappedColumnCount = 0;
    for (const [table, columns] of sourceTables) {
      const target = sourceTargets[table];
      const targetTable = target?.replace(/^daily\./u, '');
      if (target) {
        expect(target.startsWith('daily.'), `target must be a Daily migration table: ${target}`).toBe(true);
        expect(jarvisTables.has(targetTable!), `mapped table does not exist in migrations: ${target}`).toBe(true);
      }

      for (const column of columns) {
        const key = `${table}.${column}`;
        if (excludedByColumn.has(key)) {
          excludedColumnCount++;
          continue;
        }
        expect(target, `unclassified source column has no target or disposition: ${key}`).toBeDefined();
        const targetColumns = jarvisTables.get(targetTable!)!;
        if (targetColumns.has(column)) {
          mappedColumns++;
          continue;
        }
        const renamed = renamedColumns[key];
        if (renamed) {
          expect(renamed.evidence.trim().length, `rename evidence is required for ${key}`).toBeGreaterThan(0);
          expect(targetColumns.has(renamed.targetColumn), `renamed target column does not exist: ${target}.${renamed.targetColumn}`).toBe(true);
          renamedColumnCount++;
          continue;
        }
        const notMapped = notMappedColumns[key];
        expect(notMapped?.reason.trim().length, `unclassified source column: ${key}`).toBeGreaterThan(0);
        notMappedColumnCount++;
      }
    }

    expect(mappedColumns).toBe(248);
    expect(renamedColumnCount).toBe(0);
    expect(excludedColumnCount).toBe(91);
    expect(notMappedColumnCount).toBe(21);
    expect(mappedColumns + renamedColumnCount + excludedColumnCount + notMappedColumnCount).toBe(360);
  });
});

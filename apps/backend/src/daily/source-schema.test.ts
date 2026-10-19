import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Classification = {
  kind: 'mapped' | 'reused' | 'intentionally excluded' | 'gap';
  target?: string;
  reason?: string;
  columns: number;
  fingerprint: string;
};

const sourceSchemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/reference/daily-v182/daily-source-schema.sql');
const columnGapReason = 'The source table target is inventoried, but this source column has no verified Jarvis-column correspondence.';

const classifications: Record<string, Classification> = {
  attention_items: { kind: 'intentionally excluded', reason: 'Daily attention snapshots are not selected.', columns: 13, fingerprint: 'd67105097173ad495747c6cbd284963e9bad8866038bd022adf96aae20256a49' },
  attention_rule_config: { kind: 'intentionally excluded', reason: 'The source attention rule engine is not selected.', columns: 4, fingerprint: '6b8020c21f42aee38072252a155d3166916d9c47d81c43e0c37f5e0b2f86d56a' },
  attention_runs: { kind: 'intentionally excluded', reason: 'The source attention snapshot pipeline is not selected.', columns: 9, fingerprint: 'd1598af0b37accc3672f12d2eb0b9fe29ff8cda73351bf9306eada4468f4747c' },
  attention_source_snapshots: { kind: 'intentionally excluded', reason: 'The source attention snapshot pipeline is not selected.', columns: 10, fingerprint: 'd27a275ba29a6a2cd767511ac46013dbf587acae9c5b95a717c73e2eee037ac7' },
  briefing_runs: { kind: 'intentionally excluded', reason: 'The fixed and scheduled source brief renderer is not selected.', columns: 13, fingerprint: 'defc55b7710d6765c1c89c7c06939397b9792df4c21b08a122115fe22a06b428' },
  coach_commitments: { kind: 'reused', target: 'daily.coach_commitments', reason: 'Existing rows and schema are preserved; source commitment tools are excluded.', columns: 14, fingerprint: 'b0106c9bc8b09037b0158bd50a03a3a5dbea8b0f1362dbbb43daebb2b640be2d' },
  coach_experiments: { kind: 'reused', target: 'daily.coach_experiments', reason: 'Existing rows and schema are preserved; source experiment tools are excluded.', columns: 19, fingerprint: '821cb06fc7334f95262dd835ad510c87906ed9bff6d6af4d50cc7f9f0051fa99' },
  coach_profiles: { kind: 'mapped', target: 'daily.coach_profiles', columns: 21, fingerprint: '15f5dd34f92d6a79e7debecd5ab725a453fbe0936a1550ef44eb0fca82f5dda9' },
  gmail_suppressions: { kind: 'intentionally excluded', reason: 'Source-specific Gmail suppression state is not selected.', columns: 6, fingerprint: 'd09c99ddafd5258e666d98ddff24b515ec23488d439da00dacb9636ba34072c7' },
  health_daily_metrics: { kind: 'mapped', target: 'daily.health_daily_metrics', columns: 13, fingerprint: '8e66063f76fa75a5ef58d1808f209b51066a5eb389834d47ed805bad844ac491' },
  health_ingestions: { kind: 'mapped', target: 'daily.health_ingestions', columns: 12, fingerprint: '1eea560a9876f412ad28018084168f801664b15a4947bc0d2f520b3eada19fb2' },
  health_phone_sync_state: { kind: 'mapped', target: 'daily.health_phone_sync_state', columns: 5, fingerprint: '222230de0a7932004c760fa381a2da47b53025dac600c321f0e30f9c8814ecf7' },
  health_raw_objects: { kind: 'mapped', target: 'daily.health_upload_inbox', columns: 11, fingerprint: '7f0336c22d9c285007ad3902a8b2e411514c74969413d611556d5558b33dc823' },
  health_sleep_daily: { kind: 'mapped', target: 'daily.health_sleep_daily', columns: 14, fingerprint: 'cb7ac49ab19861363467cc3a0924a74c49dbcca4688d54910a59660d2abe1e6a' },
  health_sync_feeds: { kind: 'mapped', target: 'daily.health_sync_feeds', columns: 7, fingerprint: '9a2fcdd9ef255ec592340e8a5100392916ea22f8e76c85796d98ce59ec5a1a78' },
  health_sync_state: { kind: 'mapped', target: 'daily.health_sync_state', columns: 11, fingerprint: '7d58bf8e1629b11417966a58e9552b28dc40db59de4d52ff6feb66fac5282679' },
  health_workout_heart_rate_minute: { kind: 'mapped', target: 'daily.health_workout_heart_rate_minute', columns: 11, fingerprint: '07be8c471da64d63c68c3077491ea06ed1964c084a93d7494a0e15fad002f7b5' },
  health_workout_metrics: { kind: 'mapped', target: 'daily.health_workout_metrics', columns: 11, fingerprint: 'd22568304c80c43a4034c1be8f0349ee2f5723dea0d963d16e3f284ebcd84760' },
  health_workouts: { kind: 'mapped', target: 'daily.health_workouts', columns: 20, fingerprint: 'f6521727e426fec2a00b7309d3814405ea8b5163958ac06c32c032f2b848dc2d' },
  mcp_oauth_codes: { kind: 'intentionally excluded', reason: 'A parallel Daily MCP authentication runtime is not selected.', columns: 10, fingerprint: '94d2ad7e2afe4ec6be408d70abf7d6f02d82477d8dbc2994471431f461bccb71' },
  mcp_oauth_refresh_tokens: { kind: 'intentionally excluded', reason: 'A parallel Daily MCP authentication runtime is not selected.', columns: 8, fingerprint: '16e4974741f7528bcc5acd9e96e9a720f12be4741d4d0c6c1a1931747cb39aad' },
  mcp_oauth_tokens: { kind: 'intentionally excluded', reason: 'A parallel Daily MCP authentication runtime is not selected.', columns: 8, fingerprint: '16e4974741f7528bcc5acd9e96e9a720f12be4741d4d0c6c1a1931747cb39aad' },
  nutrition_favorites: { kind: 'mapped', target: 'daily.nutrition_favorites', columns: 18, fingerprint: '101343bf164f8344b57a6f4f431c904be76134ab52cd3bb515cac6711e254c1c' },
  nutrition_meal_plans: { kind: 'reused', target: 'daily.nutrition_meal_plans', reason: 'Existing rows and schema are preserved; meal-plan tools are excluded.', columns: 15, fingerprint: '0e6e4a753804c362323f1cfcc80f114a4a053bea868e69b13fa18c8d50626c22' },
  nutrition_meals: { kind: 'mapped', target: 'daily.nutrition_meals', columns: 26, fingerprint: '1b4dd38f008894d049b1cad31ab3a5a34075a47b26275748ecca14c1c85328f9' },
  nutrition_queue: { kind: 'reused', target: 'daily.nutrition_queue', reason: 'Existing rows and schema are preserved; outbound meal write-back is excluded.', columns: 24, fingerprint: 'e251eda6b997e0d4df0b89b62772a69dc1a420dafb6cc8feba2982c88ff33005' },
  nutrition_recommendation_feedback: { kind: 'mapped', target: 'daily.nutrition_recommendation_feedback', columns: 5, fingerprint: 'a68233772647398b9827643227f18a3d36890629243129a23c9a7c97a0458e25' },
  order_suppressions: { kind: 'intentionally excluded', reason: 'Source coach-order suppression is not selected.', columns: 6, fingerprint: '865fa13616ac8338305968c8ea43be9f49f0537a36066e8fde798a915b2cf298' },
  readiness_checkins: { kind: 'reused', target: 'daily.readiness_checkins', reason: 'Existing rows and schema are preserved; the standalone Ready workflow is excluded.', columns: 7, fingerprint: 'd88f9e0304e9760ef1e49b5a2a2b100d5787f0040ef79ca7111710a8b5c6cec6' },
  recovery_days: { kind: 'mapped', target: 'daily.recovery_days', columns: 5, fingerprint: '88cc6ad305fc274c74b2ccf5f3b445a3bb0ddb9e6fd7a2fe0b2ce4e6186b4185' },
  widget_auth_attempts: { kind: 'intentionally excluded', reason: 'The legacy widget authentication and renderer are not selected.', columns: 4, fingerprint: '0998a8f88f971a6228f8e098095decec15f0eeff03ecba9e3f19fa65a76a6709' },
};

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

function parseSourceTables(ddl: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  const declaration = /CREATE TABLE\s+(?:`([^`]+)`|"([^"]+)")\s*\(/giu;
  for (const match of ddl.matchAll(declaration)) {
    const name = match[1] ?? match[2]!;
    const opening = match.index + match[0].lastIndexOf('(');
    let depth = 1;
    let quote: string | null = null;
    let closing = opening + 1;
    for (; closing < ddl.length && depth > 0; closing++) {
      const character = ddl[closing]!;
      if (quote) {
        if (character === quote) {
          if (ddl[closing + 1] === quote) closing++;
          else quote = null;
        }
      } else if (character === "'" || character === '"' || character === '`') {
        quote = character;
      } else if (character === '(') {
        depth++;
      } else if (character === ')') {
        depth--;
      }
    }
    if (depth !== 0) throw new Error(`Unclosed source table definition: ${name}`);
    const columns = splitSqlList(ddl.slice(opening + 1, closing - 1)).flatMap(clause => {
      const column = clause.trim().match(/^(?:`([^`]+)`|"([^"]+)")\s+\S+/u);
      return column ? [column[1] ?? column[2]!] : [];
    });
    tables.set(name, columns);
  }
  return tables;
}

function fingerprint(columns: string[]): string {
  return createHash('sha256').update(columns.join('\n')).digest('hex');
}

describe('pinned Daily v182 source schema inventory', () => {
  it('classifies every source table and all 360 columns, failing when the pinned schema drifts', () => {
    const tables = parseSourceTables(readFileSync(sourceSchemaPath, 'utf8'));
    expect(tables.size).toBe(31);
    expect(Object.keys(classifications).sort()).toEqual([...tables.keys()].sort());

    let classifiedColumns = 0;
    let excludedColumns = 0;
    let gapColumns = 0;
    for (const [table, columns] of tables) {
      const classification = classifications[table]!;
      expect(columns).toHaveLength(classification.columns);
      expect(fingerprint(columns)).toBe(classification.fingerprint);
      if (classification.kind === 'mapped' || classification.kind === 'reused') {
        expect(classification.target).toMatch(/^daily\./u);
      }
      if (classification.kind === 'intentionally excluded') {
        expect(classification.reason?.length).toBeGreaterThan(0);
      } else {
        expect(columnGapReason).toContain('no verified Jarvis-column correspondence');
      }

      for (const column of columns) {
        const disposition = classification.kind === 'intentionally excluded'
          ? { kind: classification.kind, reason: classification.reason }
          : { kind: 'gap', reason: columnGapReason, target: classification.target };
        expect(disposition.kind).toMatch(/^(?:intentionally excluded|gap)$/u);
        expect(disposition.reason?.length).toBeGreaterThan(0);
        if (disposition.kind === 'gap' && classification.target) {
          expect(classification.target).toMatch(/^daily\./u);
        }
        expect(column.length).toBeGreaterThan(0);
        classifiedColumns++;
        if (disposition.kind === 'intentionally excluded') excludedColumns++;
        else gapColumns++;
      }
    }

    expect(classifiedColumns).toBe(360);
    expect(excludedColumns + gapColumns).toBe(classifiedColumns);
    expect(excludedColumns).toBe(91);
    expect(gapColumns).toBe(269);
  });
});

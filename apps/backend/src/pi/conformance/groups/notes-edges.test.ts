import { afterAll, describe, expect, it } from 'vitest';
import { executeCase, turnKindFor } from '../callable.testkit.js';
import type { GroupFactory } from '../types.testkit.js';
import { buildConformanceWorld } from '../world.testkit.js';
import { coreGroup } from './core.testkit.js';
import { createNotesGroup } from './notes.testkit.js';

/**
 * What the group's cases cannot say. The suite reports a tool as `ok` only when every case of it is, so the calls that must be
 * refused or fail in plain English (a stale version, a made-up id, a rule between two fields) run here, in a world with the
 * core group (the dispatcher and the app options the notes tools read) and the notes group.
 */
let fixtures: ReturnType<typeof createNotesGroup>;
const notes: GroupFactory = (context) => { fixtures = createNotesGroup(context); return fixtures.group; };
const world = await buildConformanceWorld({ groups: [coreGroup, notes] });
afterAll(async () => { await world.close(); });

describe('notes calls that must be refused or fail in plain English', () => {
  const probes = Object.entries(fixtures.probes).flatMap(([name, list]) => list.map((probe) => [name, probe] as const));
  it.each(probes.map(([name, probe]) => [`${name}: ${probe.label}`, name, probe] as const))('%s', async (_title, name, probe) => {
    const done = await executeCase(world, world.app.jarvisTools.get(name)!, probe.turn ?? turnKindFor(name), probe);
    expect(done.outcome).toBe(probe.expect);
    probe.check?.(done.result);
  });
});

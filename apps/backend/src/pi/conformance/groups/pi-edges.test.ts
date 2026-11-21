import { afterAll, describe, expect, it } from 'vitest';
import { coreModule } from '../../../core/index.js';
import { executeCase, plainEnglishProblems, turnKindFor } from '../callable.testkit.js';
import { sampleArgumentSets } from '../schema.testkit.js';
import type { GroupFactory } from '../types.testkit.js';
import { buildConformanceWorld } from '../world.testkit.js';
import { vaultDown } from './pi-brain.testkit.js';
import { situationDown } from './pi-situation.testkit.js';
import { createPiGroup } from './pi.testkit.js';

/**
 * What the group's cases cannot say, because `executeCase` first finds the tool in the kind of turn it is called in:
 * a wake-only tool must not be reachable from chat, and the PI tools must fail in plain English when a store is down.
 * The world is the conformance world with only the dispatcher (core) and the PI tools.
 */
let fixtures: ReturnType<typeof createPiGroup>;
const core: GroupFactory = () => ({ id: 'core', covers: ['core'], modules: [coreModule] });
const pi: GroupFactory = (context) => { fixtures = createPiGroup(context); return fixtures.group; };
const world = await buildConformanceWorld({ groups: [core, pi] });
afterAll(async () => { await world.close(); });

const tool = (name: string) => world.app.jarvisTools.get(name)!;
const argumentsFor = (name: string) => sampleArgumentSets(tool(name).inputSchema as Record<string, unknown>)[0]!.arguments;
const firstCase = (name: string) => fixtures.group.cases![name]![0]!;

describe('a wake-only tool in a chat turn', () => {
  it.each(['message_dan', 'pi_note', 'inbox_trail', 'watch_look'])('%s is not offered, and the door refuses it even if the model names it', async (name) => {
    const chat = world.client.openTurn();
    try {
      const found = await world.client.find(chat, name);
      expect([...found.tools, ...found.otherMatches].map((entry) => entry.name)).not.toContain(name);
      chat.grant.discovered.add(name);
      const call = await world.client.call(chat, name, argumentsFor(name));
      expect(call.status).toBe(200);
      expect(call.outcome).toBe('refused');
      expect(plainEnglishProblems((call.result as { refused?: string }).refused)).toEqual([]);
      expect(world.recorded.filter((entry) => entry.tool === name), 'the tool must not have run').toEqual([]);
    } finally { chat.close(); }
    expect(fixtures.brain.pushes).toEqual([]);
    expect([...fixtures.brain.vault.files.keys()].filter((path) => path.startsWith('PI/Notes/'))).toEqual([]);
  });
});

describe('a situation tool in a wake turn', () => {
  it.each(['situation_read', 'situation_lookup', 'situation_patch', 'situation_commit'])('%s needs a live PI activation, which a wake does not have', async (name) => {
    const done = await executeCase(world, tool(name), 'wake', { label: 'a wake turn', arguments: argumentsFor(name) });
    expect(done.outcome).toBe('refused');
    expect(done.message).toBe('This tool needs a live PI activation. Nothing was done.');
  });
});

describe('a dependency is down: the tool fails in plain English, never with the generic failure', () => {
  // inbox_trail is not listed for the vault: the inbox store lets the vault client's plain errors through, so it answers with the
  // generic failure. That is reported for Dan's decision (see the report), not changed here.
  const cases: readonly (readonly [dependency: string, tools: readonly string[]])[] = [
    [situationDown, ['situation_read', 'situation_lookup', 'situation_patch', 'situation_commit', 'message_dan']],
    [vaultDown, ['pi_note', 'watch_create', 'watch_list', 'watch_update', 'watch_stop', 'watch_look']],
  ];
  for (const [dependency, names] of cases) {
    it.each(names)(`%s with ${dependency} down`, async (name) => {
      world.context.down.add(dependency);
      try {
        const done = await executeCase(world, tool(name), turnKindFor(name), firstCase(name));
        expect(done.outcome).toBe('error');
      } finally { world.context.down.delete(dependency); }
    });
  }
});

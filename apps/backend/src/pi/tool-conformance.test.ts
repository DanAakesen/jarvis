import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_CATALOGUE_BYTES, MAX_TOOL_DESCRIPTION_CHARACTERS, isCurrentAssistantTool, isSituationActivationTool, isWakeTool, type RegisteredTool } from '../core/tool-registry.js';
import { allGroups, buildConformanceWorld } from './conformance/world.testkit.js';
import { goldenIntents, phraseTable } from './conformance/phrases.testkit.js';
import { descriptionViolations, harnessManagedNames, nameViolations, schemaViolations, tokensOf } from './conformance/schema.testkit.js';
import type { ConformanceTurn } from './conformance/mcp-client.testkit.js';
import { executeCase, exerciseTool, openTurn, turnKindFor, type CallableStatus } from './conformance/callable.testkit.js';
import type { ConformanceGroup } from './conformance/types.testkit.js';

/**
 * Offline tool conformance: every tool the registry holds is checked against the harness contract (static), found by the
 * words Dan uses in English and Danish through the real `find_tools` (discoverable), and run through the real `call_tool` over
 * stubbed stores and services (callable). See docs/tool-conformance.md for the generated table and how to read it.
 */
const world = await buildConformanceWorld();
afterAll(async () => { await world.close(); });

type Visibility = 'chat' | 'activation' | 'wake' | 'legacy';
const visibilityOf = (name: string): Visibility => !isWakeTool(name) ? 'legacy'
  : isCurrentAssistantTool(name) ? 'chat'
    : isSituationActivationTool(name) ? 'activation' : 'wake';

const tools: readonly RegisteredTool[] = [...world.tools].sort((left, right) => left.name.localeCompare(right.name));
const names = tools.map((tool) => tool.name);
const visibleIn = (kind: 'chat' | 'wake') => tools.filter((tool) => kind === 'wake' ? visibilityOf(tool.name) !== 'legacy' : visibilityOf(tool.name) === 'chat' || visibilityOf(tool.name) === 'activation');

/** Largest schemas allowed above the default ceiling, with the reason. A new entry needs Dan's decision. */
const defaultSchemaTokens = 2_000;
const largeSchemas: Readonly<Record<string, { readonly ceiling: number; readonly reason: string }>> = {
  workspace_command: { ceiling: 13_000, reason: 'the inline generated-view schema (every renderer) is part of the tool schema' },
  show_in_chat: { ceiling: 13_500, reason: 'the inline generated-view schema (every renderer) is part of the tool schema' },
};
const defaultDefinitionTokens = 2_500;

const reports = new Map<string, {
  static: string[]; discover?: { phrase: string; language: string; rank: number; source: 'curated' | 'derived' } | undefined;
}>();
const reportFor = (name: string) => {
  let entry = reports.get(name);
  if (!entry) { entry = { static: [] }; reports.set(name, entry); }
  return entry;
};

describe('composition', () => {
  it('exposes exactly find_tools and call_tool to the harness, never the catalogue', async () => {
    expect(await world.client.listDoorTools()).toEqual(['call_tool', 'find_tools']);
  });

  it('composes every production module (a new key in production-modules.ts needs a conformance group)', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../production-modules.ts'), 'utf8');
    const interfaceBody = /export interface ProductionModules \{([\s\S]*?)\n\}/u.exec(source)?.[1] ?? '';
    const keys = [...interfaceBody.matchAll(/readonly (\w+)\??:/gu)].map((match) => match[1]!);
    expect(keys.length).toBeGreaterThan(20);
    const claimed = new Set(world.groups.flatMap((group) => group.covers));
    expect(keys.filter((key) => !claimed.has(key)), 'production modules no conformance group claims').toEqual([]);
    expect([...claimed].filter((key) => !keys.includes(key)), 'groups claim modules that do not exist').toEqual([]);
  });

  it('keeps every tool of every module in the registry (about 141 are visible to chat and voice)', () => {
    const counts = { chat: 0, activation: 0, wake: 0, legacy: 0 };
    for (const tool of tools) counts[visibilityOf(tool.name)] += 1;
    expect(counts.chat).toBeGreaterThanOrEqual(130);
    expect(tools.length).toBe(counts.chat + counts.activation + counts.wake + counts.legacy);
  });

  it('keeps the whole catalogue within the agent limits', () => {
    const bytes = Buffer.byteLength(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))));
    expect(bytes).toBeLessThanOrEqual(MAX_CATALOGUE_BYTES);
    expect(tools.every((tool) => tool.description.length <= MAX_TOOL_DESCRIPTION_CHARACTERS)).toBe(true);
  });
});

describe('static: the harness contract', () => {
  it.each(names)('%s', (name) => {
    const tool = world.app.jarvisTools.get(name)!;
    const problems = [
      ...nameViolations(name, names),
      ...descriptionViolations(tool),
      ...schemaViolations(tool.inputSchema),
    ];
    const schemaTokens = tokensOf(tool.inputSchema);
    const ceiling = largeSchemas[name]?.ceiling ?? defaultSchemaTokens;
    if (schemaTokens > ceiling) problems.push(`the schema is ${schemaTokens} tokens (ceiling ${ceiling}); every find_tools answer that returns it pays that`);
    const definitionTokens = tokensOf({ name, description: tool.description, parameters: tool.inputSchema });
    if (definitionTokens > (largeSchemas[name]?.ceiling ?? 0) + defaultDefinitionTokens && definitionTokens > defaultDefinitionTokens) {
      problems.push(`the definition is ${definitionTokens} tokens`);
    }
    reportFor(name).static = problems;
    expect(problems, `${name}: ${problems.join('; ')}`).toEqual([]);
  });

  it('keeps the harness-managed names out of the catalogue', () => {
    expect(names.filter((name) => harnessManagedNames.has(name))).toEqual([]);
  });

  it('prints the 15 largest schemas (the per-turn cost when a search returns them)', () => {
    const largest = tools
      .map((tool) => ({ name: tool.name, schema: tokensOf(tool.inputSchema), definition: tokensOf({ name: tool.name, description: tool.description, parameters: tool.inputSchema }) }))
      .sort((left, right) => right.schema - left.schema || left.name.localeCompare(right.name))
      .slice(0, 15);
    console.info(`Largest tool schemas (tokens = characters / 4):\n${largest.map((entry, index) => `${String(index + 1).padStart(2)}. ${entry.name.padEnd(26)} schema ${String(entry.schema).padStart(6)}   definition ${String(entry.definition).padStart(6)}`).join('\n')}`);
    expect(largest).toHaveLength(15);
  });
});

// ---- Discoverability ---------------------------------------------------------------------------------------------------------

const searches = new Map<string, Promise<readonly string[]>>();
const chatTurn: ConformanceTurn = world.client.openTurn();
const wakeTurn: ConformanceTurn = world.client.openTurn({ wake: true });
afterAll(() => { chatTurn.close(); wakeTurn.close(); });

/** The names find_tools returns in full, in rank order (the only ones the model reads schemas for). */
async function topThree(query: string, kind: 'chat' | 'wake' = 'chat'): Promise<readonly string[]> {
  const key = `${kind}:${query}`;
  let found = searches.get(key);
  if (!found) {
    found = world.client.find(kind === 'wake' ? wakeTurn : chatTurn, query).then((answer) => answer.tools.map((tool) => tool.name));
    searches.set(key, found);
  }
  return found;
}

const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'when', 'what', 'into', 'only', 'does', 'not', 'are', 'was', 'his', 'her', 'its', 'one', 'any', 'all', 'use', 'used', 'using', 'dan', 'dans']);

/** Queries a model could write from the tool's own description: its first sentence, then its key words. */
export function derivedQueries(tool: Pick<RegisteredTool, 'name' | 'description'>): readonly { readonly strategy: string; readonly query: string }[] {
  const text = tool.description.replace(/\s+/gu, ' ').trim();
  const sentence = (/^.*?[.!?](?=\s|$)/u.exec(text)?.[0] ?? text).replace(/[.!?]+$/u, '');
  const clip = (value: string) => value.length <= 100 ? value : value.slice(0, value.lastIndexOf(' ', 100) > 0 ? value.lastIndexOf(' ', 100) : 100);
  const words = [...new Set(sentence.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4 && !stopWords.has(word)))];
  const keywords = words.sort((left, right) => right.length - left.length).slice(0, 5);
  return [
    { strategy: 'first sentence', query: clip(sentence) },
    ...(keywords.length > 0 ? [{ strategy: 'key words', query: keywords.join(' ') }] : []),
  ];
}

const curated = phraseTable.flatMap((row) => [
  { ...row, language: 'en', phrase: row.en }, { ...row, language: 'da', phrase: row.da },
]);
const curatedHits = new Map<string, { phrase: string; language: string; rank: number }>();

describe('discoverable: Dan’s words find the right tool in the top 3 of the first search', () => {
  it.each(curated.map((entry) => [`${entry.intent} (${entry.language}): ${entry.phrase}`, entry] as const))('%s', async (_title, entry) => {
    const top = await topThree(entry.phrase);
    const rank = top.findIndex((name) => entry.tools.includes(name));
    expect(rank, `top 3 for "${entry.phrase}": ${top.join(', ')}; expected one of ${entry.tools.join(', ')}`).toBeGreaterThanOrEqual(0);
    for (const name of entry.tools.filter((candidate) => top.includes(candidate))) {
      if (!curatedHits.has(name)) curatedHits.set(name, { phrase: entry.phrase, language: entry.language, rank: top.indexOf(name) + 1 });
    }
  });

  it.each(visibleIn('wake').map((tool) => tool.name))('every tool is found by a phrase of its own: %s', async (name) => {
    const tool = world.app.jarvisTools.get(name)!;
    const kind = visibilityOf(name) === 'wake' ? 'wake' : 'chat';
    const curatedHit = curatedHits.get(name);
    if (curatedHit) { reportFor(name).discover = { ...curatedHit, source: 'curated' }; return; }
    const tried: string[] = [];
    for (const candidate of derivedQueries(tool)) {
      const top = await topThree(candidate.query, kind);
      tried.push(`${candidate.strategy} "${candidate.query}" -> ${top.join(', ') || 'nothing'}`);
      const rank = top.indexOf(name);
      if (rank >= 0) {
        reportFor(name).discover = { phrase: candidate.query, language: 'en', rank: rank + 1, source: 'derived' };
        return;
      }
    }
    expect.fail(`${name} was not in the top 3 of any query derived from its description:\n${tried.join('\n')}`);
  });

  it('never offers the legacy confirmation tools to chat or voice', async () => {
    const legacy = tools.filter((tool) => visibilityOf(tool.name) === 'legacy').map((tool) => tool.name);
    expect(legacy.length).toBeGreaterThan(0);
    for (const name of legacy) {
      const answer = await world.client.find(chatTurn, name.replace(/_/gu, ' '));
      expect([...answer.tools, ...answer.otherMatches].map((entry) => entry.name)).not.toContain(name);
    }
  });
});

describe('golden intents are pinned to tools that exist', () => {
  it.each(goldenIntents.map((entry) => [`${entry.scenario}: ${entry.step} -> ${entry.tool}`, entry] as const))('%s', (_title, entry) => {
    expect(names).toContain(entry.tool);
  });
});

// ---- Callable ----------------------------------------------------------------------------------------------------------------

const groupOfModule = new Map<string, ConformanceGroup>();
for (const group of world.groups) for (const module of group.modules) groupOfModule.set(module.id, group);
const groupOfTool = (name: string) => groupOfModule.get(world.app.jarvisTools.get(name)!.moduleId);
/** `CONFORMANCE_GROUP=google` runs only the callable checks of one group while its stubs are being built. */
const onlyGroup = process.env.CONFORMANCE_GROUP;
const callable = new Map<string, CallableStatus>();

describe('callable: every tool runs through the real call_tool over stubbed stores and services', () => {
  it.each(names)('%s', async (name, context) => {
    const group = groupOfTool(name);
    if (onlyGroup && group?.id !== onlyGroup) return context.skip();
    expect(group, `${name} belongs to a module no conformance group composes`).toBeDefined();
    callable.set(name, await exerciseTool(world, world.app.jarvisTools.get(name)!, group));
  });
});

// ---- Golden daily-core scenarios ----------------------------------------------------------------------------------------------

const confirmationMarkers = /confirmationCode|requiresConfirmation|needsApproval|awaitingApproval|"pending"\s*:\s*true|proposal/iu;
const scenarios = world.groups.flatMap((group) => (group.scenarios ?? []).map((scenario) => ({ group, scenario })));

describe('golden scenarios: one turn, no confirmation step, found on the first search', () => {
  it('covers every scenario step Dan named', () => {
    const missing = goldenIntents.filter((intent) => !scenarios.some(({ scenario }) => scenario.id === intent.scenario
      && scenario.steps.some((step) => step.tool === intent.tool)));
    expect(missing.map((intent) => `${intent.scenario}: ${intent.step} (${intent.tool})`)).toEqual([]);
  });

  for (const { scenario } of scenarios) {
    for (const language of ['en', 'da'] as const) {
      it(`${scenario.title} (${language})`, async (context) => {
        if (onlyGroup && !world.groups.some((group) => group.id === onlyGroup && group.scenarios?.includes(scenario))) return context.skip();
        for (const step of scenario.steps) {
          const phrase = step.say[language];
          const top = await topThree(phrase);
          expect(top, `"${phrase}" must find ${step.tool} in the top 3 of the first search, got ${top.join(', ')}`).toContain(step.tool);
          const tool = world.app.jarvisTools.get(step.tool)!;
          // Each spoken request is its own turn; the stored Dan message is exactly what he said.
          const done = await executeCase(world, tool, step.call.turn ?? turnKindFor(step.tool), {
            label: `${scenario.id}: ${phrase}`, arguments: step.call.arguments, ownerMessage: step.call.ownerMessage ?? phrase,
          });
          const wanted = step.call.expect ?? 'ok';
          expect(done.outcome, `"${phrase}" -> ${step.tool} answered ${done.outcome} ("${done.message ?? ''}"), expected ${wanted}`).toBe(wanted);
          expect(JSON.stringify(done.result ?? null), `"${phrase}" -> ${step.tool} asked for a confirmation step`).not.toMatch(confirmationMarkers);
          step.call.check?.(done.result);
        }
      });
    }
  }
});

// Keep the module referenced for the groups listed in the report.
void allGroups;
void openTurn;

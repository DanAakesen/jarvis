import type { RegisteredTool, ToolRegistry } from '../core/tool-registry.js';
import { toModelToolSchema, type RealtimeInstructionMode } from './realtime.js';

/** Tools every reduced rung that keeps any tools must offer; R3 adds the smallest others up to half of R0's bytes. */
export const TOOL_BUDGET_ALWAYS_KEPT_TOOLS = ['set_presence_mode', 'set_away_mode'] as const;

export type ToolBudgetRungName = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export const TOOL_BUDGET_HEALTH_RUNG = 1;
export const TOOL_BUDGET_COLD_START_RUNG = 2; // The previous R1 frame was ready in 1,341 ms after R0 stalled at 8,001 ms on 21 October 2026.

export const TOOL_BUDGET_PROBE_NAMES = [
  'full', 'no_proactive', 'no_daily', 'reduced_plus_copies',
] as const;
export type ToolBudgetProbeName = typeof TOOL_BUDGET_PROBE_NAMES[number];

export interface ToolBudgetRung {
  readonly name: ToolBudgetRungName;
  readonly tools: ToolRegistry;
  readonly instructions: RealtimeInstructionMode;
  /** Deadline from socket connect until `session.updated`. */
  readonly deadlineMs: number;
}

/** Worst case 8 s + 5 x 6 s = 38 s, inside the browser's 60 s warm-up limit. */
export const TOOL_BUDGET_FIRST_DEADLINE_MS = 8_000;
export const TOOL_BUDGET_FALLBACK_DEADLINE_MS = 6_000;

function registryOf(tools: readonly RegisteredTool[]): ToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const list = Object.freeze([...tools]);
  return Object.freeze({ list: () => list, get: (name: string) => byName.get(name) });
}

function definitionBytes({ name, description, inputSchema }: RegisteredTool): number {
  return Buffer.byteLength(JSON.stringify({
    type: 'function', name, description, parameters: toModelToolSchema(inputSchema),
  }));
}

function halfBytesSubset(tools: readonly RegisteredTool[]): RegisteredTool[] {
  const sizes = new Map(tools.map((tool) => [tool.name, definitionBytes(tool)]));
  const budget = Math.floor([...sizes.values()].reduce((sum, bytes) => sum + bytes, 0) / 2);
  const kept = new Set<string>(TOOL_BUDGET_ALWAYS_KEPT_TOOLS.filter((name) => sizes.has(name)));
  let used = [...kept].reduce((sum, name) => sum + sizes.get(name)!, 0);
  const rest = tools.filter((tool) => !kept.has(tool.name)).sort((left, right) =>
    sizes.get(left.name)! - sizes.get(right.name)! || (left.name < right.name ? -1 : 1));
  for (const tool of rest) {
    const bytes = sizes.get(tool.name)!;
    if (used + bytes > budget) break;
    kept.add(tool.name);
    used += bytes;
  }
  return tools.filter((tool) => kept.has(tool.name));
}

/** The deterministic English fallback ladder; only tools and instruction text differ between rungs. */
export function createToolBudgetRungs(registry: ToolRegistry): readonly ToolBudgetRung[] {
  const all = registry.list();
  const withoutProactive = all.filter(({ name }) => name !== 'proactive_recent_items');
  const knownGood = all.filter(({ name }) =>
    !name.startsWith('daily_') && name !== 'proactive_recent_items');
  const rung = (
    name: ToolBudgetRungName, tools: ToolRegistry, instructions: RealtimeInstructionMode,
  ): ToolBudgetRung => ({
    name, tools, instructions,
    deadlineMs: name === 'R0' ? TOOL_BUDGET_FIRST_DEADLINE_MS : TOOL_BUDGET_FALLBACK_DEADLINE_MS,
  });
  const none = registryOf([]);
  return Object.freeze([
    rung('R0', registry, 'full'),
    rung('R1', registryOf(withoutProactive), 'notice'),
    rung('R2', registryOf(knownGood), 'notice'),
    rung('R3', registryOf(halfBytesSubset(all)), 'notice'),
    rung('R4', none, 'notice'),
    rung('R5', none, 'compact'),
  ]);
}

/** Deterministic independent measurement frames; these do not change the live-session ladder. */
export function createToolBudgetProbeTools(
  probe: ToolBudgetProbeName, registry: ToolRegistry,
): ToolRegistry {
  const all = registry.list();
  if (probe === 'full') return registry;
  if (probe === 'no_proactive') {
    return registryOf(all.filter(({ name }) => name !== 'proactive_recent_items'));
  }
  if (probe === 'no_daily') {
    return registryOf(all.filter(({ name }) => !name.startsWith('daily_')));
  }

  const rungOne = all.filter(({ name }) =>
    !name.startsWith('daily_') && name !== 'proactive_recent_items');
  const copyCount = Math.max(0, all.length - rungOne.length);
  const targetBytes = all.reduce((sum, tool) => sum + definitionBytes(tool), 0);
  const baseBytes = rungOne.reduce((sum, tool) => sum + definitionBytes(tool), 0);
  const targetAddedBytes = targetBytes - baseBytes;
  const maximumAddedBytes = targetAddedBytes + Math.floor(targetBytes * 0.02);
  const copySources = [...rungOne].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  let choices = new Map<number, RegisteredTool[]>([[0, []]]);
  for (let index = 0; index < copyCount && rungOne.length > 0; index += 1) {
    const name = `probe_copy_${String(index + 1).padStart(2, '0')}`;
    const options = new Map<number, RegisteredTool>();
    for (const tool of copySources) {
      const copy = { ...tool, name };
      const bytes = definitionBytes(copy);
      if (!options.has(bytes)) options.set(bytes, copy);
    }
    const next = new Map<number, RegisteredTool[]>();
    for (const [usedBytes, selected] of choices) {
      for (const [copyBytes, copy] of options) {
        const total = usedBytes + copyBytes;
        if (total <= maximumAddedBytes && !next.has(total)) next.set(total, [...selected, copy]);
      }
    }
    if (next.size === 0) {
      choices.clear();
      break;
    }
    choices = next;
  }
  const copies = [...choices.entries()]
    .filter(([, selected]) => selected.length === copyCount)
    .sort((left, right) =>
      Math.abs(left[0] - targetAddedBytes) - Math.abs(right[0] - targetAddedBytes) ||
      left[0] - right[0])[0]?.[1] ?? [];
  if (copies.length !== copyCount) {
    let remainingBytes = targetAddedBytes;
    for (let index = 0; index < copyCount && rungOne.length > 0; index += 1) {
      const name = `probe_copy_${String(index + 1).padStart(2, '0')}`;
      const remainingCopies = copyCount - index;
      const desiredBytes = remainingBytes / remainingCopies;
      const selected = rungOne.map((tool) => {
        const copy = { ...tool, name };
        return { copy, sourceName: tool.name, bytes: definitionBytes(copy) };
      }).sort((left, right) =>
        Math.abs(left.bytes - desiredBytes) - Math.abs(right.bytes - desiredBytes) ||
        (left.sourceName < right.sourceName ? -1 : left.sourceName > right.sourceName ? 1 : 0))[0]!;
      copies.push(selected.copy);
      remainingBytes -= selected.bytes;
    }
  }
  return registryOf([...rungOne, ...copies]);
}

/** Last rung that reached `session.updated` in this backend process; a restart clears it. */
const TOOL_BUDGET_RUNG_COUNT = 6;

export interface ToolBudgetMemory {
  get(): number | undefined;
  set(index: number): void;
}

export function createToolBudgetMemory(): ToolBudgetMemory {
  let remembered: number | undefined;
  return { get: () => remembered, set: (index) => { remembered = Number.isInteger(index) && index >= 0 && index < TOOL_BUDGET_RUNG_COUNT ? index : undefined; } };
}

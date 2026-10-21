import type { RegisteredTool, ToolRegistry } from '../core/tool-registry.js';
import { toModelToolSchema, type RealtimeInstructionMode } from './realtime.js';

/** Tools every reduced rung that keeps any tools must offer; R2 adds the smallest others up to half of R0's bytes. */
export const TOOL_BUDGET_ALWAYS_KEPT_TOOLS = ['set_presence_mode', 'set_away_mode'] as const;

export type ToolBudgetRungName = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export interface ToolBudgetRung {
  readonly name: ToolBudgetRungName;
  readonly tools: ToolRegistry;
  readonly instructions: RealtimeInstructionMode;
  /** Deadline from socket connect until `session.updated`. */
  readonly deadlineMs: number;
}

/** Worst case 8 s + 4 x 6 s = 32 s, inside the browser's 60 s warm-up limit. */
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
  const rung = (
    name: ToolBudgetRungName, tools: ToolRegistry, instructions: RealtimeInstructionMode,
  ): ToolBudgetRung => ({
    name, tools, instructions,
    deadlineMs: name === 'R0' ? TOOL_BUDGET_FIRST_DEADLINE_MS : TOOL_BUDGET_FALLBACK_DEADLINE_MS,
  });
  const none = registryOf([]);
  return Object.freeze([
    rung('R0', registry, 'full'),
    rung('R1', registryOf(all.filter(({ name }) =>
      !name.startsWith('daily_') && name !== 'proactive_recent_items')), 'notice'),
    rung('R2', registryOf(halfBytesSubset(all)), 'notice'),
    rung('R3', none, 'notice'),
    rung('R4', none, 'compact'),
  ]);
}

/** Last rung that reached `session.updated` in this backend process; a restart clears it. */
const TOOL_BUDGET_RUNG_COUNT = 5;

export interface ToolBudgetMemory {
  get(): number | undefined;
  set(index: number): void;
}

export function createToolBudgetMemory(): ToolBudgetMemory {
  let remembered: number | undefined;
  return { get: () => remembered, set: (index) => { remembered = Number.isInteger(index) && index >= 0 && index < TOOL_BUDGET_RUNG_COUNT ? index : undefined; } };
}

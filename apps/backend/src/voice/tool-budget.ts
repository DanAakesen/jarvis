import type { ToolRegistry } from '../core/tool-registry.js';
import type { RealtimeInstructionMode } from './realtime.js';

export type ToolBudgetRungName = 'R1' | 'R2';

export interface ToolBudgetRung {
  readonly name: ToolBudgetRungName;
  readonly tools: ToolRegistry;
  readonly instructions: RealtimeInstructionMode;
  readonly capabilityMode: 'direct' | 'discovery';
  /** Deadline from socket connect until `session.updated`. */
  readonly deadlineMs: number;
}

export const TOOL_BUDGET_COLD_START_RUNG = 0;
export const TOOL_BUDGET_FIRST_DEADLINE_MS = 6_000;
export const TOOL_BUDGET_FALLBACK_DEADLINE_MS = 6_000;

/** The fallback preserves the canonical catalogue through bounded discovery and dispatch. */
export function createToolBudgetRungs(registry: ToolRegistry): readonly ToolBudgetRung[] {
  return Object.freeze([
    {
      name: 'R1', tools: registry, instructions: 'full', capabilityMode: 'direct',
      deadlineMs: TOOL_BUDGET_FIRST_DEADLINE_MS,
    },
    {
      name: 'R2', tools: registry, instructions: 'compact', capabilityMode: 'discovery',
      deadlineMs: TOOL_BUDGET_FALLBACK_DEADLINE_MS,
    },
  ]);
}

const TOOL_BUDGET_RUNG_COUNT = 2;

export interface ToolBudgetMemory {
  get(): number | undefined;
  set(index: number): void;
}

export function createToolBudgetMemory(): ToolBudgetMemory {
  let remembered: number | undefined;
  return {
    get: () => remembered,
    set: (index) => {
      remembered = Number.isInteger(index) && index >= 0 && index < TOOL_BUDGET_RUNG_COUNT
        ? index
        : undefined;
    },
  };
}

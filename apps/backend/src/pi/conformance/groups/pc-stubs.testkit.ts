import type { BrowserDecision, BrowserJevPlanner, BrowserTextModel } from '../../../core/browser-agent.js';
import type { WorkspaceCommandBroker } from '../../../core/workspace-commands.js';
import type { PcActDecision, PcActPlanner, PcActVisionModel } from '../../../pc-bridge/pc-act.js';
import type { ScreenFrameUsageStore, ScreenVisionModel } from '../../../vision/screen.js';
import type { VisionWatchUsageStore } from '../../../vision/watch.js';

/**
 * Deterministic stand-ins for every model and metered service behind the PC, browser and camera tools. They answer what a
 * healthy provider would answer, so the production agent loops run unchanged and offline. Nothing here calls a network.
 */

const confident = 0.99;

const quotedValue = (goal: string): string | undefined => {
  const match = /"(?:[^"\\]|\\.){1,4096}"/u.exec(goal);
  return match ? JSON.parse(match[0]) as string : undefined;
};

/** The element a goal names ("click the Run button"), else the first button, else the first element. */
function pickElement<T extends { readonly index: number; readonly role: string; readonly name: string }>(goal: string, elements: readonly T[]): T | undefined {
  const lowered = goal.toLowerCase();
  return elements.find((element) => element.name.length > 2 && lowered.includes(element.name.toLowerCase()))
    ?? elements.find((element) => element.role === 'button') ?? elements[0];
}

/** Jev for the browser: one click on the page, then "done". The text model confirms completion. */
export function createFakeBrowserPlanner(): BrowserJevPlanner {
  return {
    async decide(input): Promise<BrowserDecision> {
      const target = pickElement(input.goal, input.snapshot.elements);
      if (input.previousActions.length === 0 && target) return { operation: 'click', confidence: confident, targetIndex: target.index };
      return { operation: 'done', confidence: confident };
    },
  };
}

export const fakeBrowserTextModel: BrowserTextModel = {
  async generateText() { return 'conformance text'; },
  async verifyCompletion() { return true; },
};

/**
 * Jev for Windows apps. A goal that asks to enter a quoted prompt and submit it (what `codex_prompt` writes) types the prompt into
 * the first edit field and presses the control named like "send"; any other goal clicks the control it names. Then "done".
 */
export function createFakePcActPlanner(): PcActPlanner {
  return {
    async decide(input): Promise<PcActDecision> {
      const { goal, previousActions, snapshot } = input;
      const prompt = /enter the exact prompt/iu.test(goal) ? quotedValue(goal) : undefined;
      const edit = snapshot.elements.find((element) => element.role === 'edit');
      if (prompt !== undefined && edit) {
        if (previousActions.length === 0) return { operation: 'type', confidence: confident, targetIndex: edit.index, text: prompt };
        const submit = snapshot.elements.find((element) => /send|submit/iu.test(element.name));
        if (previousActions.length === 1 && submit) return { operation: 'click', confidence: confident, targetIndex: submit.index };
        return { operation: 'done', confidence: confident };
      }
      const target = pickElement(goal, snapshot.elements);
      if (previousActions.length === 0 && target) return { operation: 'click', confidence: confident, targetIndex: target.index };
      return { operation: 'done', confidence: confident };
    },
  };
}

/** Jev's eyes for apps UI Automation cannot read: one labelled control, in normalized window coordinates. */
export const fakePcActVisionModel: PcActVisionModel = {
  async locateElements() {
    return [{ index: 0, role: 'button', name: 'Brush', bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } }];
  },
};

/** The vision deployment: a watch frame gets the JSON observation the watch service expects, any other frame a caption. */
export function createFakeVisionModel(): ScreenVisionModel & { readonly calls: Parameters<ScreenVisionModel['describe']>[0][] } {
  const calls: Parameters<ScreenVisionModel['describe']>[0][] = [];
  return {
    calls,
    async describe(input) {
      calls.push(input);
      if (input.watch) {
        return {
          description: JSON.stringify({ summary: 'A parcel is lying on the doorstep.', noteworthy: true, speak: 'A parcel just arrived at the door.' }),
          inputTokens: 220, outputTokens: 40, costDkk: 0.02, costUsd: 0.003,
        };
      }
      return { description: 'A Chrome window showing the Jarvis home page.', inputTokens: 180, outputTokens: 20, costDkk: 0.01, costUsd: 0.0015 };
    },
  };
}

/** In-memory vision usage ledgers: every frame is reserved, tokens are recorded, the daily budget is never spent. */
export function createFakeVisionUsage(): { readonly screen: ScreenFrameUsageStore; readonly watch: VisionWatchUsageStore; readonly recorded: unknown[] } {
  const recorded: unknown[] = [];
  const screen: ScreenFrameUsageStore = {
    async reserveFrame() { return 'reserved'; },
    async recordTokens(input) { recorded.push(input); },
    async reserveImage() { return 'reserved'; },
    async recordImageTokens(input) { recorded.push(input); },
  };
  const watch: VisionWatchUsageStore = {
    async reserveWatchFrame() { return { outcome: 'reserved', usedDkk: 0 }; },
    async readWatchBudget() { return 0; },
    recordTokens: screen.recordTokens,
  };
  return { screen, watch, recorded };
}

/**
 * Dan's signed-in workspace tab: it applies every command the backend sends and acknowledges it. The browser agent shows its
 * progress in the workspace, so a browser task needs one tab open, as it does whenever Dan is chatting in the web app.
 */
export function ensureWorkspaceTab(broker: WorkspaceCommandBroker, owner: string): void {
  if (broker.isConnected(owner)) return;
  const tab = broker.connect(owner, (...event) => {
    if (event[0] === 'workspace-command') {
      const commandId = event[1].command.commandId;
      queueMicrotask(() => { broker.acknowledge(owner, tab.sessionId, commandId, true); });
    }
    return true;
  });
}

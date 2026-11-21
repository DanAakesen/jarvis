import { expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createBrowserAgent, createBrowserAgentModule } from '../../../core/browser-agent.js';
import type { JarvisTool } from '../../../core/tool-registry.js';
import type { BackendModule } from '../../../modules.js';
import { createPcBridgeModule } from '../../../pc-bridge/bridge.js';
import { FrameStore } from '../../../vision/frame-store.js';
import { createScreenVisionModule, ScreenVisionService } from '../../../vision/screen.js';
import { createVisionWatchModule, VisionWatchService } from '../../../vision/watch.js';
import { createVoiceRelayModule } from '../../../voice/relay.js';
import { createConformanceConversations } from '../shared.testkit.js';
import type { ConformanceContext, GroupFactory, ToolCase } from '../types.testkit.js';
import { FakePc, snapshotIdFor } from './pc-fake.testkit.js';
import {
  createFakeBrowserPlanner, createFakePcActPlanner, createFakeVisionModel, createFakeVisionUsage, ensureWorkspaceTab, fakeBrowserTextModel,
  fakePcActVisionModel,
} from './pc-stubs.testkit.js';

/**
 * Dan's PC (bridge), the browser agent, camera/screen watches, and the voice relay (which has no tools).
 *
 * The PC is a stateful in-process fake that speaks the real bridge protocol over a fake WebSocket (see pc-fake.testkit.ts), so the
 * production connection and every tool run unchanged. Dependency tokens in `context.down` make it fail the way a real PC does:
 *   pc-bridge          the PC is offline (no socket)         pc-bridge-drops    the socket drops mid-command
 *   pc-bridge-failing  it answers its generic "failed" error pc-bridge-garbled  it answers something unreadable
 *   pc-chrome          the Chrome extension is off in the bridge settings
 * Models (Jev's planners, the text and vision deployments) are deterministic fakes (pc-stubs.testkit.ts).
 */

/** The stored Dan message that makes a browser tool run as it does in a chat turn that carries a shared Chrome tab. */
export const sharedScreenMessage = 'Click the first button on the page I am sharing.';
const sharedScreen = {
  screenDescription: 'A Chrome window showing the DMI weather forecast for Vejret i Aarhus.',
  sharedWindowTitle: 'DMI – Vejret i Aarhus - Google Chrome',
};

export interface PcWorld {
  readonly pc: FakePc;
  readonly visionWatch: VisionWatchService;
  readonly vision: ReturnType<typeof createFakeVisionModel>;
}
const worlds = new WeakMap<ConformanceContext, PcWorld>();
/** The fakes of the PC group in a world, for tests that need to look inside them. */
export const pcWorldOf = (context: ConformanceContext): PcWorld => worlds.get(context)!;

/** Runs `before(request)` ahead of every tool of a module, inside the registry's own wrapper. */
function around<M extends BackendModule>(module: M, before: (request: FastifyRequest) => void): M {
  return {
    ...module,
    tools: module.tools.map((tool): JarvisTool => ({
      ...tool,
      execute: async (input, request, signal) => { before(request); return tool.execute(input, request, signal); },
    })),
  };
}

const done = (expected: Record<string, unknown>) => (result: unknown) => { expect(result).toMatchObject(expected); };
const noExtraStep = (result: unknown) => { expect(JSON.stringify(result)).not.toMatch(/confirmationRequired|requiresConfirmation|needsApproval/u); };

const tab = 'tab-101';
const tabSnapshot = snapshotIdFor('tab', tab);
const act = (label: string, extra: Record<string, unknown>, ownerMessage: string): ToolCase => ({
  label, ownerMessage, arguments: { tabId: tab, snapshotId: tabSnapshot, ...extra },
  check: (result) => { expect(result).toEqual({ acted: true, action: extra.action }); },
});

export const pcGroup: GroupFactory = (context) => {
  // The fake answers at once; a generous command timeout keeps a loaded machine from turning a slow tick into a "PC did not answer".
  const bridge = createPcBridgeModule({ timeoutMs: 10_000, pcActPlanner: createFakePcActPlanner(), pcActVisionModel: fakePcActVisionModel });
  const pc = new FakePc(bridge.connection);
  pc.attach();

  const agent = createBrowserAgent(createFakeBrowserPlanner(), fakeBrowserTextModel);
  const vision = createFakeVisionModel();
  const usage = createFakeVisionUsage();
  const screenVision = new ScreenVisionService(vision, usage.screen, Date.now, usage.watch);
  const visionWatch = new VisionWatchService(vision, usage.watch, createConformanceConversations(context));
  const frames = new FrameStore();
  worlds.set(context, { pc, visionWatch, vision });

  const onPc = (): void => pc.sync(context.down);
  const onBrowser = (request: FastifyRequest): void => {
    onPc();
    // The chat route copies the shared-screen context of a turn onto its request; the PI door does not (see the cases).
    if (context.ownerMessage.text === sharedScreenMessage) {
      request.requireSharedScreenContext = true;
      request.sharedScreenContext = sharedScreen;
    }
    ensureWorkspaceTab(request.server.workspaceCommands, request.server.ownerObjectId);
  };

  return {
    id: 'pc',
    covers: ['pcBridge', 'browserAgent', 'visionWatch', 'screenVision', 'voiceRelay', 'phoneCall'],
    modules: [
      around(bridge, onPc),
      around(createBrowserAgentModule(agent), onBrowser),
      createScreenVisionModule(screenVision, frames),
      createVisionWatchModule(visionWatch),
      createVoiceRelayModule({ getToken: async () => 'conformance-voice-token' }),
    ],
    appOptions: { browserAgent: agent },
    cases: {
      browser_do: [
        { label: 'goal on the focused tab', arguments: { goal: 'Click the search button on this page' },
          ownerMessage: 'Click the search button on the page in my Chrome.', check: done({ status: 'completed', steps: 2 }) },
        { label: 'open a URL first', arguments: { goal: 'Open the forecast and read tomorrow', url: 'https://www.dmi.dk/vejr/' },
          ownerMessage: 'Go to dmi.dk/vejr in Chrome and read tomorrow’s forecast.', check: done({ status: 'completed', tabId: 'tab-102' }) },
        { label: 'a listed tab', arguments: { goal: 'Open the Issues page', tabId: 'tab-103' },
          ownerMessage: 'On my GitHub tab, open the Issues page.', check: done({ status: 'completed', tabId: 'tab-103' }) },
      ],
      browser_do_shared: [
        // The PI door runs a tool in its own request, so the shared-screen context of a chat turn never reaches it.
        { label: 'through the PI door, with no shared-screen frame', arguments: { goal: 'Click the first button on the page I am sharing' },
          ownerMessage: 'Click the first button on the page I am sharing, please.', expect: 'refused' },
        { label: 'in a chat turn that shares a Chrome tab', arguments: { goal: 'Click the first button on the page I am sharing' },
          ownerMessage: sharedScreenMessage, check: done({ status: 'completed', tabId: 'tab-102' }) },
      ],
      codex_prompt: [
        { label: 'a prompt for the Codex app', arguments: { prompt: 'Summarise the open pull requests in this repo' },
          ownerMessage: 'Ask Codex to summarise the open pull requests in this repo.', check: done({ status: 'completed' }) },
      ],
      pc_act: [
        { label: 'click a named control', arguments: { goal: 'Click the Run button' },
          ownerMessage: 'Press the Run button on my screen.', check: done({ status: 'completed', steps: 2 }) },
        { label: 'a goal that names no control', arguments: { goal: 'Open the next item in the foreground app' },
          ownerMessage: 'Open the next item in the app I am using.', check: done({ status: 'completed' }) },
      ],
      pc_active_window: [
        { label: 'no arguments', arguments: {}, ownerMessage: 'Which window is active on my PC?',
          check: (result) => { expect((result as { title: string }).title.length).toBeGreaterThan(0); } },
      ],
      pc_browser_act: [
        act('click', { action: 'click', elementIndex: 2 }, 'Click Search on the Jarvis tab.'),
        act('type', { action: 'type', elementIndex: 1, text: 'weather Aarhus' }, 'Type weather Aarhus in the Jarvis search box.'),
        act('select', { action: 'select', elementIndex: 3, value: 'Danish' }, 'Switch the Jarvis page language to Danish.'),
        act('scroll', { action: 'scroll', elementIndex: 0, direction: 'down' }, 'Scroll down on the Jarvis tab.'),
        act('wait', { action: 'wait', elementIndex: 0, waitMs: 100 }, 'Wait a moment on the Jarvis tab.'),
        act('keys', { action: 'keys', keys: ['Ctrl+L'], closeIntent: false, requiresConfirmation: false }, 'Focus the address bar in Chrome.'),
        act('type_focused', { action: 'type_focused', text: 'hello world' }, 'Type hello world into the focused field in Chrome.'),
        {
          // The bridge asks for confirmation on a destructive-looking click; Dan's request already authorises it, so one call finishes it.
          ...act('click a delete control', { action: 'click', elementIndex: 4 }, 'Delete the draft on the Jarvis tab.'),
          check: (result) => { expect(result).toEqual({ acted: true, action: 'click' }); noExtraStep(result); },
        },
      ],
      pc_browser_snapshot: [
        { label: 'the focused tab', arguments: { tabId: 'tab-101' }, ownerMessage: 'What controls are on my Jarvis tab?',
          check: done({ tabId: 'tab-101', snapshotId: tabSnapshot }) },
        { label: 'another listed tab', arguments: { tabId: 'tab-102' }, ownerMessage: 'What can I click on the DMI tab?',
          check: done({ tabId: 'tab-102' }) },
      ],
      pc_browser_tabs: [
        { label: 'first page', arguments: {}, ownerMessage: 'Which tabs do I have open in Chrome?',
          check: (result) => { expect((result as { tabs: unknown[] }).tabs.length).toBeGreaterThanOrEqual(3); } },
        { label: 'a later page', arguments: { offset: 20 }, ownerMessage: 'Show the next page of my Chrome tabs.', check: done({ tabs: [], nextOffset: null }) },
      ],
      pc_clipboard_read: [
        { label: 'explicit request', arguments: {}, ownerMessage: 'Read what is on my clipboard.',
          check: (result) => { expect(typeof (result as { text: unknown }).text).toBe('string'); } },
      ],
      pc_clipboard_write: [
        { label: 'text Dan gave', arguments: { text: 'Meeting moved to Friday at 10:30' },
          ownerMessage: 'Put “Meeting moved to Friday at 10:30” on my clipboard.', check: done({ written: true }) },
        { label: 'clear the clipboard', arguments: { text: '' }, ownerMessage: 'Clear my clipboard.', check: done({ written: true }) },
      ],
      pc_close: [
        { label: 'an open app', arguments: { app: 'Notepad' }, ownerMessage: 'Close Notepad on my PC.', check: done({ closing: true, windows: 1 }) },
      ],
      pc_open: [
        { label: 'a website', arguments: { target: 'url', value: 'https://www.dmi.dk/vejr/' }, ownerMessage: 'Open dmi.dk/vejr on my PC.', check: done({ opened: true }) },
        { label: 'an installed app', arguments: { target: 'app', value: 'Spotify' }, ownerMessage: 'Open Spotify on my PC.', check: done({ opened: true, app: 'Spotify' }) },
        { label: 'a folder in the repo', arguments: { target: 'folder', value: 'jarvis/apps' }, ownerMessage: 'Open the apps folder in the repo.', check: done({ opened: true }) },
        { label: 'a file in the repo', arguments: { target: 'file', value: 'jarvis/README.md' }, ownerMessage: 'Open the repo README in VS Code.', check: done({ opened: true }) },
        { label: 'a window by title', arguments: { target: 'window', value: 'Spotify' }, ownerMessage: 'Bring the Spotify window to the front.', check: done({ activated: true }) },
      ],
      stop_watching_for: [
        { label: 'the camera only', arguments: { source: 'camera' }, ownerMessage: 'Stop watching the camera.', check: done({ stopped: 'camera' }) },
        { label: 'everything', arguments: {}, ownerMessage: 'Stop watching for anything.', check: done({ stopped: 'both' }) },
      ],
      watch_for: [
        { label: 'the camera', arguments: { source: 'camera', what: 'a parcel arriving at the front door' },
          ownerMessage: 'Watch my camera and tell me when a package arrives.', check: done({ instructionsSaved: true, source: 'camera' }) },
        { label: 'the shared screen', arguments: { source: 'screen', what: 'an error dialog on my screen' },
          ownerMessage: 'Tell me if an error dialog shows up on my screen.', check: done({ instructionsSaved: true, source: 'screen' }) },
        { label: 'a continuous description of both sources', arguments: { what: 'what you see', continuousDescription: true },
          ownerMessage: 'Keep describing what you see.', check: done({ instructionsSaved: true, source: 'both' }) },
      ],
    },
    async close() {
      await bridge.connection.close();
      visionWatch.close();
      frames.close();
    },
  };
};

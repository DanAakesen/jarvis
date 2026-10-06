import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket, { type RawData } from 'ws';
import { ToolRefusal } from '../core/tool-registry.js';
import type { BackendModule } from '../modules.js';
import {
  runPcAct,
  type PcActOptions,
  type PcActPlanner,
} from './pc-act.js';

const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
export const PC_BRIDGE_SUBPROTOCOL = 'jarvis.pc.v1';
const idPattern = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu;
const mediaActions = ['play_pause', 'next', 'previous', 'volume_up', 'volume_down', 'mute'] as const;

type PcCommand =
  | { name: 'open_url'; arguments: { url: string } }
  | { name: 'open_app'; arguments: { app: string } }
  | { name: 'media'; arguments: { action: typeof mediaActions[number] } }
  | { name: 'open_folder'; arguments: { relativePath: string } }
  | { name: 'active_window'; arguments: Record<string, never> }
  | { name: 'focus_window'; arguments: { title: string } }
  | { name: 'uia_snapshot'; arguments: Record<string, never> }
  | {
    name: 'uia_act';
    arguments: {
      snapshotId: string;
      elementIndex: number;
      action: 'click' | 'type' | 'scroll_up' | 'scroll_down';
      confirmed?: boolean;
      text?: string;
    };
  }

  | { name: 'browser_tabs'; arguments: { offset?: number } }
  | { name: 'browser_snapshot'; arguments: { tabId: string } }
  | {
    name: 'browser_act';
    arguments: {
      tabId: string;
      snapshotId: string;
      elementIndex: number;
      action: 'click' | 'type' | 'select' | 'scroll' | 'wait';
      confirmed?: boolean;
      text?: string;
      value?: string;
      direction?: 'up' | 'down';
      waitMs?: number;
    };
  };

interface PendingCommand {
  command: PcCommand['name'];
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal: AbortSignal;
  abort: () => void;
}

export interface PcBridgeConnectionOptions {
  readonly timeoutMs?: number;
  readonly onStatusChange?: (online: boolean) => void | Promise<void>;
  readonly onStatusError?: () => void;
}

export interface PcBridgeModuleOptions extends PcBridgeConnectionOptions {
  readonly pcActPlanner?: PcActPlanner;
  readonly onPcActStep?: PcActOptions['onStep'];
  readonly runConfirmed?: <T>(
    summary: string,
    action: () => Promise<T>,
    signal: AbortSignal,
  ) => Promise<T>;
}

export class PcBridgeConnection {
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, PendingCommand>();
  private status: boolean | undefined;
  private statusUpdate = Promise.resolve();
  private readonly timeoutMs: number;

  constructor(private readonly options: PcBridgeConnectionOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  initialize(): void {
    this.setStatus(false);
  }

  attach(socket: WebSocket): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      socket.close(1008, 'Bridge already connected');
      return;
    }

    this.socket = socket;
    socket.on('message', (data, isBinary) => this.receive(socket, data, isBinary));
    socket.once('close', () => this.detach(socket));
    socket.once('error', () => this.detach(socket));
    this.setStatus(true);
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState === WebSocket.OPEN) socket.close(1001, 'Backend shutting down');
    this.rejectPending(new Error('PC bridge disconnected'));
    this.setStatus(false);
    await this.statusUpdate;
  }

  execute(command: PcCommand, signal: AbortSignal): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new ToolRefusal('The local PC bridge is offline.');
    }
    if (signal.aborted) throw new Error('PC bridge command was cancelled');
    if (this.pending.size >= 16) throw new Error('PC bridge is busy');

    const id = randomUUID();
    const envelope = JSON.stringify({ id, type: 'command', command: command.name, arguments: command.arguments });
    if (Buffer.byteLength(envelope) > MAX_MESSAGE_BYTES) throw new ToolRefusal('The PC bridge command is too large.');

    return new Promise((resolve, reject) => {
      const pending: PendingCommand = {
        command: command.name,
        resolve,
        reject,
        signal,
        timer: setTimeout(() => this.finish(id, new Error('PC bridge command timed out')), this.timeoutMs),
        abort: () => this.finish(id, new Error('PC bridge command was cancelled')),
      };
      pending.timer.unref();
      this.pending.set(id, pending);
      signal.addEventListener('abort', pending.abort, { once: true });
      socket.send(envelope, (error) => {
        if (error) this.finish(id, new Error('PC bridge command failed'));
      });
    });
  }

  private receive(socket: WebSocket, data: RawData, isBinary: boolean): void {
    if (socket !== this.socket) return;
    const payload = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (isBinary || payload.byteLength > MAX_MESSAGE_BYTES) {
      socket.close(1009, 'Invalid bridge response');
      this.detach(socket);
      return;
    }

    let response: unknown;
    try {
      response = JSON.parse(payload.toString('utf8'));
    } catch {
      socket.close(1007, 'Invalid bridge response');
      this.detach(socket);
      return;
    }
    if (!isRecord(response) || typeof response.id !== 'string' || !idPattern.test(response.id)) {
      socket.close(1007, 'Invalid bridge response');
      this.detach(socket);
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (response.type === 'error') {
      const error = response.error;
      if (error === 'not_allowed') this.finish(response.id, new ToolRefusal('The PC bridge refused that action.'));
      else if (error === 'browser_off') this.finish(response.id, new ToolRefusal('Chrome browser automation is off in the PC bridge settings.'));
      else if (error === 'blocked') this.finish(response.id, new ToolRefusal(
        pending.command === 'uia_act'
          ? 'That Windows control is sensitive or unsupported; no action was performed.'
          : 'Typing into a password, payment-card, one-time-code, or other sensitive field is blocked.',
      ));
      else if (error === 'stale') this.finish(response.id, new ToolRefusal(
        pending.command.startsWith('uia_')
          ? 'That Windows control is stale. Take a new snapshot before acting.'
          : 'That browser element is stale. Take a new snapshot before acting.',
      ));
      else if (error === 'covered') this.finish(response.id, new ToolRefusal('That browser element is covered by another page element; it was not activated.'));
      else if (error === 'not_found' && pending.command.startsWith('browser_')) {
        this.finish(response.id, new ToolRefusal('Chrome or the requested local tab is unavailable.'));
      }
      else if (error === 'not_found' && pending.command === 'open_app') {
        this.finish(response.id, new ToolRefusal('No installed app matched that name; nothing was launched.'));
      }
      else if (error === 'not_found') this.finish(response.id, new ToolRefusal(
        pending.command.startsWith('uia_')
          ? 'The foreground Windows app or requested control was not found.'
          : 'The requested app, folder, or window was not found.',
      ));
      else this.finish(response.id, new Error('PC bridge command failed'));
      return;
    }
    if (response.type !== 'result' || !validResult(pending.command, response.result)) {
      this.finish(response.id, new Error('Invalid PC bridge result'));
      return;
    }
    this.finish(response.id, undefined, response.result);
  }

  private finish(
    id: string,
    error?: Error,
    result?: Record<string, unknown>,
  ): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.signal.removeEventListener('abort', pending.abort);
    if (error) pending.reject(error);
    else pending.resolve(result!);
  }

  private detach(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.rejectPending(new Error('PC bridge disconnected'));
    this.setStatus(false);
  }

  private rejectPending(error: Error): void {
    for (const id of this.pending.keys()) this.finish(id, error);
  }

  private setStatus(online: boolean): void {
    if (this.status === online) return;
    this.status = online;
    try {
      const update = this.options.onStatusChange?.(online);
      if (update) {
        this.statusUpdate = Promise.all([this.statusUpdate, update]).then(() => {}).catch(() => {
          this.options.onStatusError?.();
        });
      }
    } catch {
      this.options.onStatusError?.();
    }
  }
}

export function createPcBridgeModule(options: PcBridgeModuleOptions = {}): BackendModule {
  const bridge = new PcBridgeConnection(options);
  return {
    id: 'pc-bridge',
    tools: [
      {
        name: 'pc_open',
        description: 'Open a website (target url with the full https address; it always opens in Dan’s Chrome, never Edge), any installed app by name (target app, e.g. spotify), a repo folder or a window on Dan’s PC. Use browser_do for work on a website.',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', enum: ['url', 'app', 'folder', 'window'] },
            value: { type: 'string', minLength: 1, maxLength: 2048 },
          },
          required: ['target', 'value'],
          allOf: [{
            if: { properties: { target: { const: 'app' } }, required: ['target'] },
            then: { properties: { value: { type: 'string', maxLength: 128 } } },
          }],
          additionalProperties: false,
        },
        execute: (input, _request, signal) => runPcOpen(bridge, input, signal),
      },
      {
        name: 'pc_media',
        description: 'Control Windows media playback or volume with play_pause, next, previous, volume_up, volume_down, or mute.',
        inputSchema: {
          type: 'object',
          properties: { action: { type: 'string', enum: mediaActions } },
          required: ['action'],
          additionalProperties: false,
        },
        reflexSafe: true,
        execute: (input, _request, signal) => runPcMedia(bridge, input, signal),
      },
      {
        name: 'pc_active_window',
        description: 'Return the title of the active window on Dan’s PC.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async (_input, _request, signal) => {
          const result = await bridge.execute({ name: 'active_window', arguments: {} }, signal);
          return { title: result.title };
        },
      },
      {
        name: 'pc_browser_tabs',
        description: 'List open tabs in Dan’s Chrome with their title, URL, and whether each is focused. If nextOffset is non-null, request the next page with that offset. This reads tab metadata only.',
        inputSchema: {
          type: 'object',
          properties: { offset: { type: 'integer', minimum: 0, maximum: 5000 } },
          additionalProperties: false,
        },
        sensitive: true,
        execute: async (input, _request, signal) => {
          const offset = isRecord(input) && Object.keys(input).length === 1 &&
            Number.isInteger(input.offset) && (input.offset as number) >= 0 && (input.offset as number) <= 5000
            ? input.offset as number
            : isRecord(input) && Object.keys(input).length === 0 ? undefined : null;
          if (offset === null) throw new ToolRefusal('Provide a valid browser tab page offset.');
          const result = await bridge.execute({
            name: 'browser_tabs', arguments: offset === undefined ? {} : { offset },
          }, signal);
          if (!validBrowserTabs(result)) throw new Error('Invalid browser tab response');
          return result;
        },
      },
      {
        name: 'pc_browser_snapshot',
        description: 'Take a fresh snapshot of visible actionable controls in one listed Chrome tab. Use only its returned element indexes for actions; never provide selectors, coordinates, or scripts.',
        inputSchema: {
          type: 'object',
          properties: { tabId: { type: 'string', minLength: 1, maxLength: 128 } },
          required: ['tabId'],
          additionalProperties: false,
        },
        sensitive: true,
        execute: async (input, _request, signal) => {
          if (!isRecord(input) || Object.keys(input).length !== 1 ||
              typeof input.tabId !== 'string' || !isTabId(input.tabId)) {
            throw new ToolRefusal('Choose a tab returned by pc_browser_tabs.');
          }
          const result = await bridge.execute({
            name: 'browser_snapshot', arguments: { tabId: input.tabId },
          }, signal);
          if (!validBrowserSnapshot(result, input.tabId)) throw new Error('Invalid browser snapshot response');
          return result;
        },
      },
      {
        name: 'pc_browser_act',
        description: 'Act on an element index from the latest pc_browser_snapshot using click, type, select, scroll, or wait. The bridge rechecks that exact observed DOM element is fresh, visible, and unobstructed. Sensitive fields are blocked; only irreversible clicks require Dan’s explicit approval.',
        inputSchema: {
          type: 'object',
          properties: {
            tabId: { type: 'string', minLength: 1, maxLength: 128 },
            snapshotId: { type: 'string', format: 'uuid' },
            elementIndex: { type: 'integer', minimum: 0, maximum: 500 },
            action: { type: 'string', enum: ['click', 'type', 'select', 'scroll', 'wait'] },
            text: { type: 'string', maxLength: 4096 },
            value: { type: 'string', maxLength: 512 },
            direction: { type: 'string', enum: ['up', 'down'] },
            waitMs: { type: 'integer', minimum: 0, maximum: 5000 },
          },
          required: ['tabId', 'snapshotId', 'elementIndex', 'action'],
          additionalProperties: false,
        },
        sensitive: true,
        execute: (input, _request, signal) => runBrowserAction(bridge, options.runConfirmed, input, signal),
      },
      ...(options.pcActPlanner ? [{
        name: 'pc_act',
        description: 'Control any foreground Windows app with one Jev decision per fresh UI Automation snapshot. Website tasks use Chrome through browser_do, never Edge. Types only explicit quoted, non-sensitive values. Confirm irreversible actions only.',
        inputSchema: {
          type: 'object',
          properties: { goal: { type: 'string', minLength: 1, maxLength: 4_000 } },
          required: ['goal'],
          additionalProperties: false,
        },
        reflexSafe: true,
        sensitive: true,
        execute: (input: unknown, request: FastifyRequest, signal: AbortSignal) =>
          runPcAct(input, request, signal, {
            observe: (commandSignal) => bridge.execute(
              { name: 'uia_snapshot', arguments: {} },
              commandSignal,
            ),
            act: (action, commandSignal) => bridge.execute(
              { name: 'uia_act', arguments: action },
              commandSignal,
            ),
          }, {
            planner: options.pcActPlanner!,
            ...(options.runConfirmed ? { runConfirmed: options.runConfirmed } : {}),
            ...(options.onPcActStep ? { onStep: options.onPcActStep } : {}),
          }),
      }] : []),
    ],
    registerRoutes: async (app) => {
      await app.register(websocket, {
        options: {
          maxPayload: MAX_MESSAGE_BYTES,
          perMessageDeflate: false,
          handleProtocols: (protocols) => protocols.has(PC_BRIDGE_SUBPROTOCOL) ? PC_BRIDGE_SUBPROTOCOL : false,
        },
      });
      app.get('/pc-bridge/connect', {
        websocket: true,
        config: { jarvisPcBridge: true },
      }, (socket, request) => {
        if (!request.pcBridgePrincipal) {
          socket.close(1008, 'Unauthorized');
          return;
        }
        bridge.attach(socket);
      });
      app.addHook('onReady', async () => bridge.initialize());
      app.addHook('onClose', async () => bridge.close());
    },
  };
}

async function runBrowserAction(
  bridge: PcBridgeConnection,
  runConfirmed: PcBridgeModuleOptions['runConfirmed'],
  input: unknown,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const action = validateBrowserAction(input);
  if (!action) {
    throw new ToolRefusal('Use a valid element index from the latest browser snapshot and one supported action.');
  }
  const command: PcCommand = {
    name: 'browser_act',
    arguments: { ...action, ...(action.action === 'click' ? { confirmed: false } : {}) },
  };
  const result = await bridge.execute(command, signal);
  if (!isConfirmationRequired(result)) {
    if (!validBrowserActionFor(result, action.action)) throw new Error('Invalid browser action response');
    return result;
  }
  if (action.action !== 'click') throw new Error('Invalid browser confirmation response');
  if (!runConfirmed) {
    throw new ToolRefusal('Dan’s confirmation service is unavailable; the browser action was not performed.');
  }
  return runConfirmed(result.summary, async () => {
    const approved = await bridge.execute({
      name: 'browser_act',
      arguments: { ...action, confirmed: true },
    }, signal);
    if (!validBrowserActionFor(approved, action.action)) throw new Error('Invalid browser action response');
    return approved;
  }, signal);
}

function validateBrowserAction(input: unknown): Extract<PcCommand, { name: 'browser_act' }>['arguments'] | undefined {
  if (!isRecord(input) ||
      typeof input.tabId !== 'string' || !isTabId(input.tabId) ||
      typeof input.snapshotId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(input.snapshotId) ||
      !Number.isInteger(input.elementIndex) || (input.elementIndex as number) < 0 || (input.elementIndex as number) > 500 ||
      !['click', 'type', 'select', 'scroll', 'wait'].includes(String(input.action))) return undefined;

  const common = ['tabId', 'snapshotId', 'elementIndex', 'action'];
  const fields: Record<string, readonly string[]> = {
    click: common,
    type: [...common, 'text'],
    select: [...common, 'value'],
    scroll: [...common, 'direction'],
    wait: [...common, 'waitMs'],
  };
  const action = input.action as Extract<PcCommand, { name: 'browser_act' }>['arguments']['action'];
  if (Object.keys(input).length !== fields[action]!.length ||
      !Object.keys(input).every(key => fields[action]!.includes(key))) return undefined;
  if (action === 'type' && (typeof input.text !== 'string' || input.text.length > 4096 || hasControlCharacters(input.text))) return undefined;
  if (action === 'select' && (typeof input.value !== 'string' || !input.value.trim() || input.value.length > 512 || hasControlCharacters(input.value))) return undefined;
  if (action === 'scroll' && input.direction !== 'up' && input.direction !== 'down') return undefined;
  if (action === 'wait' && (!Number.isInteger(input.waitMs) || (input.waitMs as number) < 0 || (input.waitMs as number) > 5000)) return undefined;
  return {
    tabId: input.tabId,
    snapshotId: input.snapshotId,
    elementIndex: input.elementIndex as number,
    action,
    ...(action === 'type' ? { text: input.text as string } : {}),
    ...(action === 'select' ? { value: input.value as string } : {}),
    ...(action === 'scroll' ? { direction: input.direction as 'up' | 'down' } : {}),
    ...(action === 'wait' ? { waitMs: input.waitMs as number } : {}),
  };
}

function isConfirmationRequired(value: Record<string, unknown>): value is Record<string, unknown> & {
  confirmationRequired: true;
  actionKind: 'computer_use';
  summary: string;
} {
  return Object.keys(value).length === 3 &&
    value.confirmationRequired === true &&
    value.actionKind === 'computer_use' &&
    typeof value.summary === 'string' &&
    value.summary.trim().length > 0 &&
    value.summary.length <= 300;
}

function validBrowserActionFor(
  value: Record<string, unknown>,
  action: Extract<PcCommand, { name: 'browser_act' }>['arguments']['action'],
): boolean {
  return Object.keys(value).length === 2 && value.acted === true && value.action === action;
}

function validBrowserTabs(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 2 && Array.isArray(value.tabs) && value.tabs.length <= 20 &&
    (value.nextOffset === null || (Number.isInteger(value.nextOffset) &&
      (value.nextOffset as number) >= 0 && (value.nextOffset as number) <= 5000)) &&
    value.tabs.every(tab => isRecord(tab) && Object.keys(tab).length === 4 &&
      typeof tab.id === 'string' && isTabId(tab.id) &&
      typeof tab.title === 'string' && tab.title.length <= 300 &&
      typeof tab.url === 'string' && tab.url.length <= 2048 &&
      typeof tab.focused === 'boolean');
}

function validBrowserSnapshot(value: Record<string, unknown>, tabId?: string): boolean {
  return Object.keys(value).length === 5 && typeof value.tabId === 'string' &&
    isTabId(value.tabId) && (tabId === undefined || value.tabId === tabId) &&
    typeof value.snapshotId === 'string' &&
    /^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(value.snapshotId) &&
    typeof value.title === 'string' && value.title.length <= 300 &&
    typeof value.url === 'string' && value.url.length <= 2048 &&
    Array.isArray(value.elements) && value.elements.length <= 100 &&
    value.elements.every((element, index) => isRecord(element) && Object.keys(element).length === 4 &&
      element.index === index &&
      typeof element.role === 'string' && element.role.length <= 64 &&
      typeof element.name === 'string' && element.name.length <= 256 &&
      typeof element.value === 'string' && element.value.length <= 128);
}

function isTabId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

async function runPcOpen(
  bridge: PcBridgeConnection,
  input: unknown,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!isRecord(input) || typeof input.target !== 'string' ||
      typeof input.value !== 'string' || input.value.length > 2048) {
    throw new ToolRefusal('Provide one valid PC action and its value.');
  }

  let command: PcCommand;
  switch (input.target) {
    case 'url': {
      const url = validateUrl(input.value);
      if (!url) throw new ToolRefusal('Only valid HTTP or HTTPS URLs can be opened.');
      command = { name: 'open_url', arguments: { url } };
      break;
    }
    case 'app':
      if (!input.value.trim() || input.value.length > 128 || hasControlCharacters(input.value)) {
        throw new ToolRefusal('Provide an installed app name between 1 and 128 characters.');
      }
      if (isEdgeAppName(input.value)) throw new ToolRefusal('Microsoft Edge cannot be launched; websites always open in Chrome.');
      command = { name: 'open_app', arguments: { app: input.value.trim() } };
      return handleAppOpen(await bridge.execute(command, signal));
    case 'folder': {
      const relativePath = validateRepoPath(input.value);
      if (!relativePath) throw new ToolRefusal('Choose a folder under C:\\Repo using a relative path.');
      command = { name: 'open_folder', arguments: { relativePath } };
      break;
    }
    case 'window':
      if (!isValidWindowTitle(input.value)) throw new ToolRefusal('Provide an exact window title no longer than 200 characters.');
      command = { name: 'focus_window', arguments: { title: input.value } };
      break;
    default:
      throw new ToolRefusal('That PC action is not supported.');
  }

  return bridge.execute(command, signal);
}

function isEdgeAppName(value: string): boolean {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '') === 'edge' ||
    value.toLowerCase().replace(/[^a-z0-9]/gu, '') === 'microsoftedge' ||
    value.toLowerCase().replace(/[^a-z0-9]/gu, '') === 'msedge';
}

function handleAppOpen(result: Record<string, unknown>): Record<string, unknown> {
  if (result.opened === false && Array.isArray(result.candidates)) {
    const candidates = result.candidates.filter((candidate): candidate is string =>
      typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128 &&
      !hasControlCharacters(candidate));
    if (candidates.length > 0) {
      const choices = candidates.slice(0, 5).map(candidate => JSON.stringify(candidate.slice(0, 60)));
      throw new ToolRefusal(`More than one installed app matches. Choose one: ${choices.join(', ')}.`);
    }
    throw new ToolRefusal('More than one installed app matched; please provide a more specific name.');
  }
  return result;
}

async function runPcMedia(
  bridge: PcBridgeConnection,
  input: unknown,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!isRecord(input) || Object.keys(input).length !== 1 ||
      typeof input.action !== 'string' || !mediaActions.includes(input.action as typeof mediaActions[number])) {
    throw new ToolRefusal('Choose one supported media playback or volume action.');
  }
  return bridge.execute({ name: 'media', arguments: { action: input.action as typeof mediaActions[number] } }, signal);
}

function validateUrl(value: string): string | undefined {
  if (value.length > 2048 || hasControlCharacters(value)) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') ||
        !url.hostname || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function validateRepoPath(value: string): string | undefined {
  if (!value.trim() || value.length > 512 || hasControlCharacters(value) || /[:*?"<>|]/u.test(value) ||
      value.startsWith('/') || value.startsWith('\\') || value.includes(':')) return undefined;
  const segments = value.replaceAll('/', '\\').split('\\');
  if (segments.length > 16 || segments.some((segment) =>
    !segment || segment === '.' || segment === '..' || segment.endsWith('.') ||
    segment.endsWith(' ') || isReservedWindowsName(segment))) return undefined;
  return segments.join('\\');
}

function isReservedWindowsName(segment: string): boolean {
  const name = segment.split('.')[0]!.toUpperCase();
  return ['CON', 'PRN', 'AUX', 'NUL'].includes(name) ||
    /^(COM|LPT)[1-9]$/u.test(name);
}

function isValidWindowTitle(value: string): boolean {
  return value.trim().length > 0 && value.length <= 200 &&
    !hasControlCharacters(value) && value === value.trim();
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

const BROWSER_FALLBACK_NOTES = new Set([
  "Opened in Chrome directly because the Jarvis Chrome extension isn't connected.",
  "Opened in your default browser because the Chrome extension isn't connected.",
]);

function validResult(command: PcCommand['name'], value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (command === 'open_url' && Object.keys(value).length === 2) {
    // Accept the note from older bridges too; installed bridges update separately from the backend.
    return value.opened === true && typeof value.note === 'string' && BROWSER_FALLBACK_NOTES.has(value.note);
  }
  if (command === 'open_app' && Object.keys(value).length === 2) {
    if (value.opened === true) {
      return typeof value.app === 'string' &&
        value.app.length > 0 && value.app.length <= 128 && !hasControlCharacters(value.app);
    }
    return value.opened === false && Array.isArray(value.candidates) &&
      value.candidates.length > 0 && value.candidates.length <= 8 &&
      value.candidates.every(candidate => typeof candidate === 'string' &&
        candidate.length > 0 && candidate.length <= 128 && !hasControlCharacters(candidate));
  }
  if (command === 'media') {
    return Object.keys(value).length === 2 && value.controlled === true &&
      typeof value.action === 'string' && mediaActions.includes(value.action as typeof mediaActions[number]);
  }
  if (['open_url', 'open_app', 'open_folder'].includes(command)) {
    return Object.keys(value).length === 1 && value.opened === true;
  }
  if (command === 'active_window') {
    return Object.keys(value).length === 1 && typeof value.title === 'string' && value.title.length <= 200;
  }
  if (command === 'focus_window') return Object.keys(value).length === 1 && value.activated === true;
  if (command === 'uia_snapshot') return validUiAutomationSnapshot(value);
  if (command === 'uia_act') return validUiAutomationAction(value);
  if (command === 'browser_tabs') return validBrowserTabs(value);
  if (command === 'browser_snapshot') return validBrowserSnapshot(value);
  if (command === 'browser_act') {
    return validBrowserActionResult(value) || isConfirmationRequired(value);
  }
  return false;
}

function validUiAutomationSnapshot(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 3 &&
    typeof value.snapshotId === 'string' &&
    /^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(value.snapshotId) &&
    typeof value.application === 'string' && /^[\p{L}\p{N}_.-]{1,128}$/u.test(value.application) &&
    Array.isArray(value.elements) && value.elements.length <= 100 &&
    value.elements.every((element, index) => isRecord(element) && Object.keys(element).length === 3 &&
      element.index === index && typeof element.role === 'string' && element.role.length <= 64 &&
      typeof element.name === 'string' && element.name.length <= 256 && !hasControlCharacters(element.name));
}

function validUiAutomationAction(value: Record<string, unknown>): boolean {
  return (Object.keys(value).length === 2 && value.acted === true &&
      ['click', 'type', 'scroll_up', 'scroll_down'].includes(String(value.action))) ||
    (Object.keys(value).length === 3 && value.confirmationRequired === true &&
      value.actionKind === 'computer_use' &&
      value.summary === 'Activate a potentially destructive Windows control.');
}

function validBrowserActionResult(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 2 && value.acted === true &&
  ['click', 'type', 'select', 'scroll', 'wait'].includes(String(value.action));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

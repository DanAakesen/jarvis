import { randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import WebSocket, { type RawData } from 'ws';
import { ToolRefusal } from '../core/tool-registry.js';
import type { BackendModule } from '../modules.js';

const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
export const PC_BRIDGE_SUBPROTOCOL = 'jarvis.pc.v1';
const idPattern = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu;
const allowedApps = new Set(['vscode', 'edge', 'explorer', 'terminal']);

type PcCommand =
  | { name: 'open_url'; arguments: { url: string } }
  | { name: 'open_app'; arguments: { app: string } }
  | { name: 'open_folder'; arguments: { relativePath: string } }
  | { name: 'active_window'; arguments: Record<string, never> }
  | { name: 'focus_window'; arguments: { title: string } };

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

export class PcBridgeConnection {
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, PendingCommand>();
  private status: boolean | undefined;
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

  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState === WebSocket.OPEN) socket.close(1001, 'Backend shutting down');
    this.rejectPending(new Error('PC bridge disconnected'));
    this.setStatus(false);
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
      else if (error === 'not_found') this.finish(response.id, new ToolRefusal('The requested app, folder, or window was not found.'));
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
      if (update instanceof Promise) void update.catch(() => this.options.onStatusError?.());
    } catch {
      this.options.onStatusError?.();
    }
  }
}

export interface PcBridgeModuleOptions extends PcBridgeConnectionOptions {}

export function createPcBridgeModule(options: PcBridgeModuleOptions = {}): BackendModule {
  const bridge = new PcBridgeConnection(options);
  return {
    id: 'pc-bridge',
    tools: [
      {
        name: 'pc_open',
        description: 'On Dan’s PC, open an HTTP(S) URL, an allow-listed app, a folder under C:\\Repo in VS Code, or focus a window by its exact title.',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', enum: ['url', 'app', 'folder', 'window'] },
            value: { type: 'string', minLength: 1, maxLength: 2048 },
          },
          required: ['target', 'value'],
          additionalProperties: false,
        },
        execute: (input, _request, signal) => runPcOpen(bridge, input, signal),
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
      if (!allowedApps.has(input.value)) throw new ToolRefusal('That app is not on the PC bridge allow-list.');
      command = { name: 'open_app', arguments: { app: input.value } };
      break;
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

function validateUrl(value: string): string | undefined {
  if (value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) return undefined;
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
  if (!value.trim() || value.length > 512 || /[\u0000-\u001f\u007f:*?"<>|]/u.test(value) ||
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
    !/[\u0000-\u001f\u007f]/u.test(value) && value === value.trim();
}

function validResult(command: PcCommand['name'], value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (['open_url', 'open_app', 'open_folder'].includes(command)) {
    return Object.keys(value).length === 1 && value.opened === true;
  }
  if (command === 'active_window') {
    return Object.keys(value).length === 1 && typeof value.title === 'string' && value.title.length <= 200;
  }
  return Object.keys(value).length === 1 && value.activated === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

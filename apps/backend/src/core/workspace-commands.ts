import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isWorkspaceCommand, workspaceCommandSchema, type WorkspaceCommand, type WorkspaceSnapshot } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';

const commandTimeoutMs = 10_000;
const maxPendingCommands = 8;
const maxCachedCommands = 128;

type WorkspaceEvent = 'workspace-command' | 'workspace-cancel';
type WorkspaceEventSender = (event: WorkspaceEvent, data: unknown) => boolean;

interface WorkspaceConnection {
  readonly sessionId: string;
  readonly send: WorkspaceEventSender;
  snapshot?: WorkspaceSnapshot;
}

interface CommandRecord {
  readonly fingerprint: string;
  readonly sessionId: string;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  state: 'pending' | 'applied' | 'refused' | 'error';
  acknowledgement?: string;
  timer?: ReturnType<typeof setTimeout>;
  abort?: () => void;
}

type WorkspaceCommandOutcome = 'refused' | 'error';

function safeReason(reason: string): boolean {
  return reason.trim().length > 0 && reason.length <= 300 &&
    !Array.from(reason).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}

export type WorkspaceAcknowledgement =
  | { status: 'accepted' | 'duplicate' }
  | { status: 'unknown' | 'stale' };

function fingerprint(command: WorkspaceCommand): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  };
  const serialized = JSON.stringify(canonical(command));
  return createHash('sha256').update(serialized).digest('hex');
}

export class WorkspaceCommandBroker {
  private readonly connections = new Map<string, WorkspaceConnection>();
  private readonly records = new Map<string, Map<string, CommandRecord>>();

  updateSnapshot(ownerId: string, sessionId: string, snapshot: WorkspaceSnapshot): boolean {
    const connection = this.connections.get(ownerId);
    if (connection?.sessionId !== sessionId) return false;
    connection.snapshot = snapshot;
    return true;
  }

  snapshot(ownerId: string): WorkspaceSnapshot | undefined {
    return this.connections.get(ownerId)?.snapshot;
  }

  connect(ownerId: string, send: WorkspaceEventSender): { sessionId: string; close: () => void } {
    const prior = this.connections.get(ownerId);
    if (prior) this.disconnect(ownerId, prior.sessionId);
    const sessionId = randomUUID();
    this.connections.set(ownerId, { sessionId, send });
    return { sessionId, close: () => this.disconnect(ownerId, sessionId) };
  }

  async execute(ownerId: string, command: WorkspaceCommand, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new ToolFailure('Workspace command was cancelled before delivery.');
    const connection = this.connections.get(ownerId);
    if (!connection) throw new ToolRefusal('No active signed-in workspace is connected.');

    let ownerRecords = this.records.get(ownerId);
    if (!ownerRecords) {
      ownerRecords = new Map();
      this.records.set(ownerId, ownerRecords);
    }
    const digest = fingerprint(command);
    const existing = ownerRecords.get(command.commandId);
    if (existing) {
      if (existing.fingerprint !== digest) throw new ToolRefusal('This command ID was already used for a different workspace operation.');
      return this.waitFor(existing.promise, signal);
    }

    let pending = 0;
    for (const record of ownerRecords.values()) if (record.state === 'pending') pending += 1;
    if (pending >= maxPendingCommands) throw new ToolRefusal('The workspace command queue is full. Try again shortly.');

    while (ownerRecords.size >= maxCachedCommands) {
      const oldestSettled = [...ownerRecords].find(([, record]) => record.state !== 'pending')?.[0];
      if (oldestSettled === undefined) throw new ToolRefusal('The workspace command queue is full. Try again shortly.');
      ownerRecords.delete(oldestSettled);
    }

    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
    const record: CommandRecord = {
      fingerprint: digest,
      sessionId: connection.sessionId,
      promise,
      resolve,
      reject,
      signal,
      state: 'pending',
    };
    ownerRecords.set(command.commandId, record);

    let onAbort = () => {};
    const settleError = (error: Error, state: 'refused' | 'error') => {
      if (record.state !== 'pending') return;
      record.state = state;
      clearTimeout(record.timer);
      if (record.abort) signal.removeEventListener('abort', record.abort);
      signal.removeEventListener('abort', onAbort);
      record.reject(error);
    };
    record.abort = onAbort;
    onAbort = () => {
      if (record.state !== 'pending') return;
      const current = this.connections.get(ownerId);
      if (current?.sessionId === record.sessionId) current.send('workspace-cancel', { commandId: command.commandId });
      settleError(new ToolFailure('Workspace command was cancelled; the client may already have applied it.'), 'error');
    };

    record.timer = setTimeout(() => {
      settleError(new ToolFailure('The workspace did not acknowledge the command within 10 seconds; it may already have been applied.'), 'error');
    }, commandTimeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });

    const expiresAt = Date.now() + commandTimeoutMs;
    const frame = JSON.stringify({ command, expiresAt });
    if (Buffer.byteLength(frame) > 300 * 1024 ||
        !connection.send('workspace-command', { command, expiresAt })) {
      settleError(new ToolFailure('The workspace could not accept the command for delivery.'), 'error');
    }
    return this.waitFor(promise, signal);
  }

  acknowledge(
    ownerId: string,
    sessionId: string,
    commandId: string,
    applied: boolean,
    reason?: string,
    outcome: WorkspaceCommandOutcome = 'refused',
  ): WorkspaceAcknowledgement {
    const current = this.connections.get(ownerId);
    if (!current || current.sessionId !== sessionId) return { status: 'stale' };
    const record = this.records.get(ownerId)?.get(commandId);
    if (!record) return { status: 'unknown' };
    if (record.sessionId !== sessionId) return { status: 'stale' };
    const acknowledgement = JSON.stringify({ applied, reason: reason ?? null, outcome });
    if (record.state !== 'pending') {
      return record.acknowledgement === acknowledgement
        ? { status: 'duplicate' }
        : { status: 'stale' };
    }

    if (!applied && reason !== undefined && !safeReason(reason)) {
      return { status: 'unknown' };
    }
    record.acknowledgement = acknowledgement;
    record.state = applied ? 'applied' : 'refused';
    clearTimeout(record.timer);
    if (record.abort) record.signal.removeEventListener('abort', record.abort);
    if (applied) record.resolve();
    else if (outcome === 'error') record.reject(new ToolFailure(reason ?? 'The workspace failed while applying the command.'));
    else record.reject(new ToolRefusal(reason ?? 'The workspace could not apply the command.'));
    return { status: 'accepted' };
  }

  dispose(): void {
    for (const [ownerId, connection] of this.connections) this.disconnect(ownerId, connection.sessionId);
    this.connections.clear();
  }

  private disconnect(ownerId: string, sessionId: string): void {
    const current = this.connections.get(ownerId);
    if (!current || current.sessionId !== sessionId) return;
    this.connections.delete(ownerId);
    const records = this.records.get(ownerId);
    if (!records) return;
    for (const record of records.values()) {
      if (record.state !== 'pending' || record.sessionId !== sessionId) continue;
      record.state = 'error';
      clearTimeout(record.timer);
      if (record.abort) record.signal.removeEventListener('abort', record.abort);
      record.reject(new ToolFailure('The active workspace disconnected before acknowledging the command; it may already have been applied.'));
    }
  }

  private waitFor(promise: Promise<void>, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new ToolFailure('Workspace command was cancelled.'));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        reject(new ToolFailure('Workspace command was cancelled; the client may already have applied it.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        () => { signal.removeEventListener('abort', onAbort); resolve(); },
        (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  }
}

export function registerWorkspaceCommandRoutes(app: FastifyInstance): void {
  app.post<{ Body: WorkspaceSnapshot & { sessionId: string } }>('/now/workspace/state', {
    schema: {
      body: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', format: 'uuid' },
          windows: {
            type: 'array', maxItems: 32,
            items: {
              type: 'object',
              properties: {
                viewId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
                title: { type: 'string', minLength: 1, maxLength: 200 },
              },
              required: ['viewId', 'title'], additionalProperties: false,
            },
          },
          contextPanelOpen: { type: 'boolean' },
        },
        required: ['sessionId', 'windows', 'contextPanelOpen'], additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const { sessionId, windows, contextPanelOpen } = request.body;
    if (!app.workspaceCommands.updateSnapshot(request.principal.objectId, sessionId, { windows, contextPanelOpen })) {
      return reply.code(409).send({ error: 'Workspace connection is stale' });
    }
    return reply.code(204).send();
  });
  app.post<{
    Params: { commandId: string };
    Body: { sessionId: string; applied: boolean; outcome?: WorkspaceCommandOutcome; reason?: string };
  }>('/now/workspace/commands/:commandId/ack', {
    schema: {
      params: {
        type: 'object',
        properties: {
          commandId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]{1,128}$' },
        },
        required: ['commandId'],
        additionalProperties: false,
      },
      body: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$', maxLength: 36 },
          applied: { type: 'boolean' },
          outcome: { type: 'string', enum: ['refused', 'error'] },
          reason: { type: 'string', minLength: 1, maxLength: 300, pattern: '^[^\u0000-\u001f\u007f]+$' },
        },
        required: ['sessionId', 'applied'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const principal = request.principal;
    if (!principal || principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const result = app.workspaceCommands.acknowledge(
      principal.objectId,
      request.body.sessionId,
      request.params.commandId,
      request.body.applied,
      request.body.reason,
      request.body.outcome,
    );
    if (result.status === 'accepted' || result.status === 'duplicate') return reply.code(204).send();
    return reply.code(result.status === 'stale' ? 409 : 404).send({
      error: result.status === 'stale' ? 'Workspace connection is stale' : 'Workspace command is no longer pending',
    });
  });
}

export function isWorkspaceReflexOperation(args: Readonly<Record<string, unknown>>): boolean {
  return ['show', 'focus', 'minimise', 'restore', 'close', 'resize'].includes(String(args.operation)) ||
    args.operation === 'layout' ||
    args.operation === 'context-panel' && (args.action === 'toggle' || args.action === 'close');
}

export const workspaceCommandTool: BackendModule['tools'][number] = {
  name: 'workspace_command',
  description: 'Create, update, show, close, minimise, restore, focus, move, resize, or arrange a temporary view in Dan’s active workspace, or change its context panel.',
  inputSchema: workspaceCommandSchema,
  sensitive: true,
  async execute(input, request, signal) {
    if (!request.agentPrincipal && (!request.principal ||
        request.principal.objectId.toLowerCase() !== request.server.ownerObjectId.toLowerCase() ||
        typeof input !== 'object' || input === null ||
        !isWorkspaceReflexOperation(input as Record<string, unknown>))) {
      throw new ToolRefusal('Only Jarvis can create or update views; the workspace owner can control existing windows.');
    }
    if (!isWorkspaceCommand(input, generatedViewValidationOptions(request.server))) {
      throw new ToolRefusal('The workspace command or generated view is invalid.');
    }
    await request.server.workspaceCommands.execute(request.server.ownerObjectId, input, signal);
    if (input.operation === 'create' || input.operation === 'update' ||
        (input.operation === 'context-panel' && input.action === 'open')) {
      return { type: 'generated-view', view: input.view };
    }
    return { applied: true, commandId: input.commandId, operation: input.operation };
  },
};

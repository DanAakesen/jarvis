import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifySchemaValidationError } from 'fastify';
import {
  htmlArtifactFrameSchema,
  isWorkspaceCommand,
  isWorkspaceSnapshot,
  workspaceCommandSchema,
  workspaceViewSchema,
  type WorkspaceSseEvent,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { toolArgumentRefusal } from './tool-arguments.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';

const commandTimeoutMs = 10_000;
const maxPendingCommands = 8;
const maxCachedCommands = 128;

type WorkspaceEventArgs =
  | [
    event: 'workspace-command',
    data: Extract<WorkspaceSseEvent, { event: 'workspace-command' }>['data'],
  ]
  | [
    event: 'workspace-cancel',
    data: Extract<WorkspaceSseEvent, { event: 'workspace-cancel' }>['data'],
  ];
type WorkspaceEventSender = (...args: WorkspaceEventArgs) => boolean;

interface WorkspaceConnection {
  readonly sessionId: string;
  readonly send: WorkspaceEventSender;
  snapshot?: WorkspaceSnapshot;
  snapshotAt?: number;
}

interface CommandRecord {
  readonly fingerprint: string;
  /** Every tab the command was delivered to; the first tab that applies it settles the command. */
  readonly sessionIds: Set<string>;
  /** Tabs that refused, failed, or disconnected; once all have, the command is refused. */
  readonly declined: Map<string, { outcome: 'refused' | 'error'; reason: string }>;
  readonly acknowledgements: Map<string, string>;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  state: 'pending' | 'applied' | 'refused' | 'error';
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
  /** Every open signed-in tab per owner; commands go to all of them. */
  private readonly connections = new Map<string, Map<string, WorkspaceConnection>>();
  private readonly records = new Map<string, Map<string, CommandRecord>>();
  private snapshotClock = 0;

  isConnected(ownerId: string): boolean {
    return (this.connections.get(ownerId)?.size ?? 0) > 0;
  }

  updateSnapshot(ownerId: string, sessionId: string, snapshot: WorkspaceSnapshot): boolean {
    const connection = this.connections.get(ownerId)?.get(sessionId);
    if (!connection) return false;
    connection.snapshot = snapshot;
    connection.snapshotAt = ++this.snapshotClock;
    return true;
  }

  /** The most recently reported tab layout, which is the tab Dan is most likely looking at. */
  snapshot(ownerId: string): WorkspaceSnapshot | undefined {
    let latest: WorkspaceConnection | undefined;
    for (const connection of this.connections.get(ownerId)?.values() ?? []) {
      if (connection.snapshot && (!latest || (connection.snapshotAt ?? 0) > (latest.snapshotAt ?? 0))) {
        latest = connection;
      }
    }
    return latest?.snapshot;
  }

  connect(ownerId: string, send: WorkspaceEventSender): { sessionId: string; close: () => void } {
    const sessionId = randomUUID();
    let ownerConnections = this.connections.get(ownerId);
    if (!ownerConnections) {
      ownerConnections = new Map();
      this.connections.set(ownerId, ownerConnections);
    }
    ownerConnections.set(sessionId, { sessionId, send });
    return { sessionId, close: () => this.disconnect(ownerId, sessionId) };
  }

  async execute(ownerId: string, command: WorkspaceCommand, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new ToolFailure('Workspace command was cancelled before delivery.');
    const ownerConnections = this.connections.get(ownerId);
    if (!ownerConnections || ownerConnections.size === 0) {
      throw new ToolRefusal('No active signed-in workspace is connected.');
    }

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
      sessionIds: new Set(ownerConnections.keys()),
      declined: new Map(),
      acknowledgements: new Map(),
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
      for (const sessionId of record.sessionIds) {
        this.connections.get(ownerId)?.get(sessionId)?.send('workspace-cancel', { commandId: command.commandId });
      }
      settleError(new ToolFailure('Workspace command was cancelled; the client may already have applied it.'), 'error');
    };

    record.timer = setTimeout(() => {
      settleError(new ToolFailure('The workspace did not acknowledge the command within 10 seconds; it may already have been applied.'), 'error');
    }, commandTimeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });

    const expiresAt = Date.now() + commandTimeoutMs;
    const frame = JSON.stringify({ command, expiresAt });
    if (Buffer.byteLength(frame) > 300 * 1024) {
      settleError(new ToolFailure('The workspace could not accept the command for delivery.'), 'error');
      return this.waitFor(promise, signal);
    }
    for (const connection of [...ownerConnections.values()]) {
      if (!connection.send('workspace-command', { command, expiresAt })) {
        this.decline(record, connection.sessionId, 'error', 'The workspace could not accept the command for delivery.');
      }
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
    if (!this.connections.get(ownerId)?.has(sessionId)) return { status: 'stale' };
    const record = this.records.get(ownerId)?.get(commandId);
    if (!record) return { status: 'unknown' };
    if (!record.sessionIds.has(sessionId)) return { status: 'stale' };
    const acknowledgement = JSON.stringify({ applied, reason: reason ?? null, outcome });
    const previous = record.acknowledgements.get(sessionId);
    if (previous !== undefined) return previous === acknowledgement ? { status: 'duplicate' } : { status: 'stale' };
    if (!applied && reason !== undefined && !safeReason(reason)) {
      return { status: 'unknown' };
    }
    record.acknowledgements.set(sessionId, acknowledgement);
    if (record.state !== 'pending') return { status: 'accepted' };
    if (applied) {
      record.state = 'applied';
      clearTimeout(record.timer);
      if (record.abort) record.signal.removeEventListener('abort', record.abort);
      record.resolve();
    } else {
      this.decline(record, sessionId, outcome, reason ?? (outcome === 'error'
        ? 'The workspace failed while applying the command.'
        : 'The workspace could not apply the command.'));
    }
    return { status: 'accepted' };
  }

  dispose(): void {
    for (const [ownerId, ownerConnections] of this.connections) {
      for (const sessionId of [...ownerConnections.keys()]) this.disconnect(ownerId, sessionId);
    }
    this.connections.clear();
  }

  /** One tab declined; the command fails only when every tab it went to has declined. */
  private decline(record: CommandRecord, sessionId: string, outcome: 'refused' | 'error', reason: string): void {
    if (record.state !== 'pending' || !record.sessionIds.has(sessionId)) return;
    record.declined.set(sessionId, { outcome, reason });
    if (record.declined.size < record.sessionIds.size) return;
    const refusal = [...record.declined.values()].find((decline) => decline.outcome === 'refused');
    record.state = refusal ? 'refused' : 'error';
    clearTimeout(record.timer);
    if (record.abort) record.signal.removeEventListener('abort', record.abort);
    record.reject(refusal ? new ToolRefusal(refusal.reason) : new ToolFailure(reason));
  }

  private disconnect(ownerId: string, sessionId: string): void {
    const ownerConnections = this.connections.get(ownerId);
    if (!ownerConnections?.delete(sessionId)) return;
    if (ownerConnections.size === 0) this.connections.delete(ownerId);
    for (const record of this.records.get(ownerId)?.values() ?? []) {
      this.decline(record, sessionId, 'error',
        'The active workspace disconnected before acknowledging the command; it may already have been applied.');
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
          frame: htmlArtifactFrameSchema,
          view: workspaceViewSchema,
        },
        required: ['sessionId', 'windows', 'contextPanelOpen'], additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const { sessionId, ...snapshot } = request.body;
    if (!isWorkspaceSnapshot(snapshot)) {
      return reply.code(400).send({ error: 'Invalid workspace snapshot' });
    }
    if (!app.workspaceCommands.updateSnapshot(request.principal.objectId, sessionId, snapshot)) {
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
    args.operation === 'conversation' && ['show', 'hide'].includes(String(args.action)) ||
    args.operation === 'layout' ||
    args.operation === 'context-panel' && (args.action === 'close' ||
      args.action === 'open' && args.view === undefined);
}

export const workspaceCommandTool: BackendModule['tools'][number] = {
  name: 'workspace_command',
  description: 'Show or hide Dan’s conversation transcript, navigate his visible shell page (home, factory board or task/issue, settings section, usage, knowledge, folio, status), create, update, show, close, minimise, restore, focus, move, resize, or arrange a temporary workspace view, or change its context panel. Conversation visibility is reversible and needs no confirmation. Supply a unique commandId. Navigation section is settings-only; taskId and positive integer issueNumber are factory-only. Success requires a tab to acknowledge applying the command; relay its refusal reason.',
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
      if (typeof input === 'object' && input !== null && !Array.isArray(input) &&
          (input as Record<string, unknown>).operation === 'conversation') {
        const missingAction = (input as Record<string, unknown>).action === undefined;
        const validationError: FastifySchemaValidationError = {
          keyword: missingAction ? 'required' : 'enum',
          instancePath: missingAction ? '' : '/action',
          schemaPath: missingAction ? '#/required' : '#/properties/action/enum',
          params: missingAction ? { missingProperty: 'action' } : {},
        };
        throw new ToolRefusal(toolArgumentRefusal(workspaceCommandTool, validationError, request.log).refused);
      }
      throw new ToolRefusal('The workspace command or generated view is invalid.');
    }
    await request.server.workspaceCommands.execute(request.server.ownerObjectId, input, signal);
    if (input.operation === 'create' || input.operation === 'update' ||
        (input.operation === 'context-panel' && input.action === 'open' && input.view !== undefined)) {
      return { type: 'generated-view', view: input.view };
    }
    if (input.operation === 'navigate') return { applied: true, ...input };
    if (input.operation === 'conversation') return { applied: true, ...input };
    return { applied: true, commandId: input.commandId, operation: input.operation };
  },
};

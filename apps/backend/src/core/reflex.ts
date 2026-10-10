import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { WorkspaceSnapshot } from '@jarvis/contracts';
import { confirmToolCall, type ToolCallOutcome } from './tool-calls.js';
import { ToolFailure, ToolRefusal, type RegisteredTool } from './tool-registry.js';
import { isWorkspaceReflexOperation } from './workspace-commands.js';
import { startWorkPresentation } from './work-presentation.js';
import {
  jevChoiceConfidenceThreshold,
  jevFailureFromStatus,
  reflexAddressedThreshold,
  reflexCompleteCommandThreshold,
  reflexConfirmationThreshold,
  type JevFailure,
} from './jev.js';

const endpoint = 'https://api.typesafe.ai/v1/systemone';
const model = 'jev-latest';
const requestTimeoutMs = 1_200;
const maxResponseBytes = 256 * 1024;
export interface ReflexTarget {
  readonly choice: string;
  readonly tool: RegisteredTool;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly description?: string;
}

export interface ReflexClassification {
  readonly addressed: boolean;
  readonly intent: 'action' | 'question' | 'other';
  readonly confidence: number;
  readonly needsConfirmation: boolean;
  readonly completeCommand?: boolean;
  readonly contradictedAction?: string | null;
  readonly target: ReflexTarget | null;
}

export interface ReflexContext {
  readonly executed: readonly string[];
  readonly executedActions?: readonly { readonly id: string; readonly summary: string }[];
  readonly partial?: boolean;
  readonly final?: boolean;
}

export interface ReflexClassifier {
  classify(
    text: string,
    language: 'da' | 'en',
    targets: readonly ReflexTarget[],
    signal: AbortSignal,
    context?: ReflexContext,
  ): Promise<ReflexClassification | JevFailure | null>;
}

export interface ReflexActionResult {
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result: unknown;
  readonly outcome: ToolCallOutcome;
  readonly note: string;
}

export interface ReflexActionReplay {
  readonly tool: string;
  readonly result: unknown;
  readonly outcome: ToolCallOutcome;
  readonly note: string;
}

interface StoredChatReflexReplay extends ReflexActionReplay {
  readonly argumentsFingerprint: string;
}

interface ChatReflexFlight {
  readonly result: Promise<StoredChatReflexReplay | null>;
  readonly resolve: (result: StoredChatReflexReplay | null) => void;
  readonly timer: NodeJS.Timeout;
  settled: boolean;
}

const chatReflexFlights = new Map<string, ChatReflexFlight>();
const chatReflexFlightTtlMs = 120_000;

function fingerprintArguments(value: unknown): string {
  const normalize = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(normalize).join(',')}]`;
    if (typeof item === 'object' && item !== null) {
      const object = item as Record<string, unknown>;
      return `{${Object.keys(object).sort().map((key) =>
        `${JSON.stringify(key)}:${normalize(object[key])}`,
      ).join(',')}}`;
    }
    return JSON.stringify(item) ?? 'null';
  };
  return createHash('sha256').update(normalize(value)).digest('hex');
}

function replayArguments(tool: string, arguments_: unknown): unknown {
  if (tool !== 'workspace_command' || !record(arguments_)) return arguments_;
  return Object.fromEntries(Object.entries(record(arguments_)!).filter(([key]) => key !== 'commandId'));
}

export function reflexActionSignature(target: ReflexTarget): string {
  return `${target.tool.name}:${fingerprintArguments(replayArguments(target.tool.name, target.arguments))}`;
}

export function registerChatReflex(messageId: string): (result: ReflexActionResult | null) => void {
  let resolve!: (result: StoredChatReflexReplay | null) => void;
  const result = new Promise<StoredChatReflexReplay | null>((complete) => { resolve = complete; });
  const entry: ChatReflexFlight = {
    result,
    resolve,
    timer: setTimeout(() => {
      if (chatReflexFlights.get(messageId) === entry) {
        chatReflexFlights.delete(messageId);
        entry.resolve(null);
      }
    }, chatReflexFlightTtlMs),
    settled: false,
  };
  entry.timer.unref();
  chatReflexFlights.set(messageId, entry);
  return (action) => {
    if (entry.settled) return;
    entry.settled = true;
    entry.resolve(action ? {
      tool: action.tool,
      result: action.result,
      outcome: action.outcome,
      note: action.note,
      argumentsFingerprint: fingerprintArguments(replayArguments(action.tool, action.arguments)),
    } : null);
  };
}

export async function findChatReflexReplay(
  messageId: string,
  tool: string,
  arguments_: unknown,
): Promise<ReflexActionReplay | null> {
  const entry = chatReflexFlights.get(messageId);
  if (!entry) return null;
  const action = await entry.result;
  if (!action || action.tool !== tool ||
      action.argumentsFingerprint !== fingerprintArguments(replayArguments(tool, arguments_))) return null;
  return { tool: action.tool, result: action.result, outcome: action.outcome, note: action.note };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function answer(answers: Record<string, unknown>, name: string, type: string): Record<string, unknown> | undefined {
  const value = record(answers[name]);
  return value?.type === type ? value : undefined;
}

function validProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function retryDelay(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  const milliseconds = seconds * 1_000;
  return milliseconds <= 500 ? milliseconds : undefined;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function readBounded(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxResponseBytes) {
    throw new Error('Jev response exceeded the size limit');
  }
  if (!response.body) throw new Error('Jev response was empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw new Error('Jev response exceeded the size limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function createJevReflexClassifier(
  getApiKey: () => Promise<string | undefined>,
  fetcher: typeof fetch = fetch,
): ReflexClassifier {
  return {
    async classify(text, language, targets, signal, context) {
      if (typeof text !== 'string' || !text.trim() || text.length > 20_000 || signal.aborted) return null;
      let apiKey: string | undefined;
      try {
        apiKey = await getApiKey();
      } catch {
        return null;
      }
      if (!apiKey || !apiKey.trim() || apiKey.length > 10_000 || /[\r\n]/u.test(apiKey)) return null;

      const choices: Record<string, string> = { main_agent: 'Use the main Jarvis agent.' };
      for (const target of targets) {
        choices[target.choice] = `${target.description ?? target.tool.name} with arguments ${JSON.stringify(target.arguments)}`;
      }
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);
      const questions: Record<string, unknown> = {
        addressed: {
          type: 'noul',
          instructions: 'Is Dan directly addressing Jarvis with this turn?',
        },
        intent: {
          type: 'choice',
          instructions: 'Classify the requested intent.',
          criteria: {
            action: 'Dan asks Jarvis to perform an action.',
            question: 'Dan asks Jarvis for information or an answer.',
            other: 'No clear request is present.',
          },
        },
        target: {
          type: 'choice',
          instructions: 'Choose one exact route. Use main_agent unless one listed safe action completely matches the request.',
          criteria: choices,
        },
        needs_confirmation: {
          type: 'noul',
          instructions: 'Would the requested action have an external effect or require explicit confirmation? Controlling Jarvis workspace windows and its context panel is reversible UI state and needs no confirmation.',
        },
      };
      if (context) {
        questions.complete_command = {
          type: 'noul',
          instructions: 'Does the latest stable transcript contain a new, complete command not already listed as executed?',
        };
        if (context.final && context.executed.length > 0) {
          const contradictedActionChoices: Record<string, string> = {
            none: 'No listed executed action is explicitly contradicted.',
          };
          for (const action of context.executedActions ?? []) {
            contradictedActionChoices[action.id] = action.summary;
          }
          questions.contradicted_action = {
            type: 'choice',
            instructions: 'Choose the one listed executed action explicitly contradicted by the final transcript, or none.',
            criteria: contradictedActionChoices,
          };
        }
      }
      const body = JSON.stringify({
        model,
        state: {
          text: text.trim(),
          language,
          // Without this, Jev judged every voice turn as "not addressed" (L105).
          situation: 'Dan is speaking or typing directly to Jarvis in Jarvis\'s own chat or voice interface, so his requests are addressed to Jarvis unless he is clearly talking to someone else. Voice transcripts can contain background speech or noise fragments.',
          ...(context ? { already_executed: context.executed.slice(-8) } : {}),
        },
        questions,
      });

      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: 'Bearer '.concat(apiKey),
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body,
          signal: requestSignal,
        });
        if (response.status === 429) {
          const delay = retryDelay(response.headers.get('retry-after'));
          await response.body?.cancel().catch(() => {});
          if (delay === undefined || delay >= requestTimeoutMs) return jevFailureFromStatus(429);
          if (requestSignal.aborted) {
            return signal.aborted ? null : { failure: 'timeout' };
          }
          await wait(delay, requestSignal);
          response = await fetcher(endpoint, {
            method: 'POST',
            redirect: 'error',
            headers: {
              Authorization: 'Bearer '.concat(apiKey),
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body,
            signal: requestSignal,
          });
        }
      } catch {
        if (signal.aborted) return null;
        return requestSignal.aborted ? { failure: 'timeout' } : { failure: 'network_error' };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return jevFailureFromStatus(response.status);
      }
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        await response.body?.cancel().catch(() => {});
        return { failure: 'invalid_answer' };
      }
      let payload: Record<string, unknown> | undefined;
      try {
        payload = record(await readBounded(response));
      } catch {
        if (signal.aborted) return null;
        return requestSignal.aborted ? { failure: 'timeout' } : { failure: 'invalid_answer' };
      }
      const answers = record(payload?.answers);
      if (!answers) return { failure: 'invalid_answer' };
      const addressed = answer(answers, 'addressed', 'noul')?.noul;
      const intentAnswer = answer(answers, 'intent', 'choice');
      const routeAnswer = answer(answers, 'target', 'choice');
      const confirmation = answer(answers, 'needs_confirmation', 'noul')?.noul;
      const completeCommand = context
        ? answer(answers, 'complete_command', 'noul')?.noul
        : undefined;
      const contradictionAnswer = context?.final && context.executed.length > 0
        ? answer(answers, 'contradicted_action', 'choice')
        : undefined;
      const contradictedAction = contradictionAnswer?.choice;
      const contradictionConfidence = contradictionAnswer?.confidence;
      const validContradictionConfidence = validProbability(contradictionConfidence)
        ? contradictionConfidence
        : undefined;
      const contradictedActionChoices = new Set([
        'none',
        ...(context?.executedActions ?? []).map(({ id }) => id),
      ]);
      let selectedContradiction = typeof contradictedAction === 'string' &&
        contradictedActionChoices.has(contradictedAction) ? contradictedAction : undefined;
      const intent = intentAnswer?.choice;
      const choice = routeAnswer?.choice;
      const routeConfidence = routeAnswer?.confidence;
      if (!validProbability(addressed) || !validProbability(confirmation) ||
          (context && !validProbability(completeCommand)) ||
          (context?.final && context.executed.length > 0 &&
           (selectedContradiction === undefined || validContradictionConfidence === undefined)) ||
          (intent !== 'action' && intent !== 'question' && intent !== 'other') ||
          !validProbability(intentAnswer?.confidence) ||
          typeof choice !== 'string' || !Object.hasOwn(choices, choice) ||
          !validProbability(routeConfidence)) {
        return { failure: 'invalid_answer' };
      }

      if (context?.final && context.executed.length > 0 &&
          validContradictionConfidence !== undefined &&
          validContradictionConfidence < jevChoiceConfidenceThreshold) {
        selectedContradiction = 'none';
      }
      const completeCommandScore = validProbability(completeCommand) ? completeCommand : undefined;
      const target = choice === 'main_agent' ? null : targets.find((item) => item.choice === choice) ?? null;
      return {
        addressed: addressed >= reflexAddressedThreshold,
        intent,
        confidence: Math.min(intentAnswer.confidence, routeConfidence),
        needsConfirmation: confirmation >= reflexConfirmationThreshold,
        ...(completeCommandScore === undefined ? {} : { completeCommand: completeCommandScore >= reflexCompleteCommandThreshold }),
        ...(selectedContradiction === undefined ? {} : {
          contradictedAction: selectedContradiction === 'none' ? null : selectedContradiction,
        }),
        target,
      };
    },
  };
}

export async function executeReflexAction(
  classification: ReflexClassification | null,
  request: FastifyRequest,
  messageId: string,
  signal: AbortSignal,
  mode: 'partial' | 'final' | 'undo' = 'final',
): Promise<ReflexActionResult | null> {
  if (reflexSkipReason(classification, request, signal, mode)) return null;
  const target = classification!.target!;

  const activityId = `reflex-${messageId}-${target.tool.name}`;
  request.server.jarvisActivityHub.publish({
    type: 'tool-call-started', activityId, source: request.routeOptions.url?.includes('/voice') ? 'voice' : 'chat',
    toolName: target.tool.name,
  });
  let outcome: ToolCallOutcome = 'ok';
  let result: unknown;
  const presentation = startWorkPresentation(target.tool.name, target.arguments, request, randomUUID(), messageId, signal);
  try {
    result = await target.tool.execute(target.arguments, request, signal);
    const serialized = JSON.stringify(result);
    if (serialized === undefined || Buffer.byteLength(serialized) > 1024 * 1024) {
      throw new Error('Invalid tool result');
    }
  } catch (error) {
    if (error instanceof ToolRefusal && !signal.aborted) {
      outcome = 'refused';
      result = { refused: error.message };
    } else if (error instanceof ToolFailure && !signal.aborted) {
      outcome = 'error';
      result = { failure: error.message };
    } else {
      outcome = 'error';
      result = { error: 'Tool execution failed' };
    }
  } finally {
    if (outcome === 'error') request.server.systemHealthDiagnostics.record('failed');
    presentation.finish(result, outcome === 'ok');
  }
  try {
    await request.server.toolCallStore!.record({
      messageId,
      tool: target.tool.name,
      arguments: target.tool.sensitive ? { redacted: true } : target.arguments,
      result: target.tool.sensitive ? { redacted: true } : result,
      outcome,
    });
  } catch {
    request.server.jarvisActivityHub.publish({
      type: 'failed',
      activityId,
      source: request.routeOptions.url?.includes('/voice') ? 'voice' : 'chat',
    });
    return {
      tool: target.tool.name,
      arguments: target.arguments,
      result,
      outcome: 'error',
      note: `Reflex action ${target.tool.name} may have completed, but its result could not be recorded. Check its status before retrying.`,
    };
  }
  request.server.jarvisActivityHub.publish({
    type: 'tool-call-finished', activityId,
    source: request.routeOptions.url?.includes('/voice') ? 'voice' : 'chat',
    toolName: target.tool.name, outcome,
  });
  const confirmation = confirmToolCall(target.tool.name, outcome, result);
  return {
    tool: target.tool.name,
    arguments: target.arguments,
    result,
    outcome,
    note: `Reflex already did ${target.description ?? target.tool.name} (${outcome}): ${confirmation}`,
  };
}

function isSafeAppOpenTarget(target: ReflexTarget | null | undefined): boolean {
  if (target?.tool.name !== 'pc_open' || target.arguments.target !== 'app' ||
      typeof target.arguments.value !== 'string') return false;
  const appName = target.arguments.value.trim();
  const normalized = appName.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return appName.length > 0 && appName.length <= 128 &&
    !['edge', 'microsoftedge', 'msedge'].includes(normalized);
}

function reflexSkipReason(
  classification: ReflexClassification | null,
  request: FastifyRequest,
  signal: AbortSignal,
  mode: 'partial' | 'final' | 'undo',
): string | null {
  const target = classification?.target;
  const partialSafe = target?.tool.name === 'workspace_command' && workspaceReflexSafe(target) ||
    target?.tool.name === 'pause_task' && target.tool.reflexSafe === true ||
    isSafeAppOpenTarget(target) ||
    target?.tool.name === 'pc_media' && target.tool.reflexSafe === true &&
      ['play_pause', 'next', 'previous', 'volume_up', 'volume_down', 'mute'].includes(String(target.arguments.action)) ||
    target?.tool.name === 'pc_open' && target.arguments.target === 'url' &&
      typeof target.arguments.value === 'string' && safeHttpUrl(target.arguments.value);
  const modeSafe = mode === 'partial' ? partialSafe
    : mode === 'undo' ? target?.tool.name === 'resume_task'
      : target?.tool.reflexSafe === true || target?.tool.name === 'workspace_command' && workspaceReflexSafe(target) ||
        isSafeAppOpenTarget(target);
  if (signal.aborted) return 'cancelled';
  if (!classification) return 'unavailable';
  if (!classification.addressed) return 'not_addressed';
  if (classification.intent !== 'action') return 'not_action';
  if (classification.completeCommand === false) return 'incomplete_command';
  if (classification.confidence < jevChoiceConfidenceThreshold) return 'low_confidence';
  if (classification.needsConfirmation) return 'confirmation_required';
  if (!target) return 'no_target';
  if (!modeSafe) return 'unsafe_target';
  if (!request.principal) return 'unauthorized';
  if (!request.server.toolCallStore) return 'audit_unavailable';
  const validateInput = request.compileValidationSchema(target.tool.inputSchema, 'body');
  return validateInput(target.arguments) ? null : 'invalid_arguments';
}

export function logReflexDecision(
  request: FastifyRequest,
  classification: ReflexClassification | null,
  source: 'chat' | 'voice-partial' | 'voice-final',
  startedAt: number,
  signal: AbortSignal,
  action: ReflexActionResult | null,
  reason?: string,
): void {
  const confidence = classification?.confidence ?? 0;
  request.log.info({
    source,
    addressed: classification?.addressed ?? false,
    intent: classification?.intent ?? 'other',
    tool: classification?.target?.tool.name ?? 'none',
    confidence: confidence < 0.5 ? '<0.5' : confidence <= 0.8 ? '0.5–0.8' : '>0.8',
    completeCommand: classification ? source === 'voice-partial'
      ? classification.completeCommand === true : classification.completeCommand !== false : false,
    executed: action?.outcome === 'ok',
    reason: reason ?? (action ? action.outcome === 'ok' ? 'executed' : action.outcome :
      reflexSkipReason(classification, request, signal, source === 'voice-partial' ? 'partial' : 'final') ?? 'execution_failed'),
    latencyMs: Math.min(600_000, Math.max(0, performance.now() - startedAt)),
  }, 'reflex.decision');
}

export async function undoPartialReflexAction(
  original: ReflexTarget,
  request: FastifyRequest,
  messageId: string,
  signal: AbortSignal,
): Promise<ReflexActionResult | null> {
  if (original.tool.name === 'workspace_command' && original.arguments.operation === 'close' &&
      typeof original.arguments.viewId === 'string') {
    return executeReflexAction({
      addressed: true, intent: 'action', confidence: 1, needsConfirmation: false, completeCommand: true,
      target: {
        choice: `undo_${original.choice}`, tool: original.tool,
        arguments: { commandId: randomUUID(), operation: 'restore', viewId: original.arguments.viewId },
      },
    }, request, messageId, signal);
  }
  if (original.tool.name !== 'pause_task' || typeof original.arguments.taskId !== 'string') return null;
  const tool = request.server.jarvisTools.get('resume_task');
  if (!tool) return null;
  return executeReflexAction({
    addressed: true,
    intent: 'action',
    confidence: 1,
    needsConfirmation: false,
    completeCommand: true,
    target: { choice: `undo_${original.choice}`, tool, arguments: { taskId: original.arguments.taskId } },
  }, request, messageId, signal, 'undo');
}

function safeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function reflexTargets(request: FastifyRequest, browserGoal?: string): Promise<ReflexTarget[]> {
  const workspace = request.principal
    ? request.server.workspaceCommands.snapshot(request.principal.objectId) : undefined;
  let taskIds: string[] = [];
  if (request.server.jarvisTools.get('pause_task')?.reflexSafe && request.server.taskStore) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const running = request.server.taskStore.list({ state: 'Running', limit: 100, offset: 0 });
      const tasks = workspace ? await Promise.race([
        running,
        new Promise<[]>((resolve) => { timeout = setTimeout(() => resolve([]), 150); }),
      ]) : await running;
      taskIds = tasks.map(({ id }) => id);
    } catch {
      taskIds = [];
    } finally {
      clearTimeout(timeout);
    }
  }
  return createReflexTargets(request.server.jarvisTools.list(), taskIds, browserGoal, workspace);
}

export function workspaceReflexSafe(target: ReflexTarget): boolean {
  return target.tool.name === 'workspace_command' && isWorkspaceReflexOperation(target.arguments);
}

export function createWorkspaceReflexTargets(
  tool: RegisteredTool,
  snapshot: WorkspaceSnapshot,
): ReflexTarget[] {
  const targets: ReflexTarget[] = [];
  const add = (description: string, arguments_: Record<string, unknown>) => {
    targets.push({
      choice: `workspace_${targets.length}`, tool, description,
      arguments: { commandId: randomUUID(), ...arguments_ },
    });
  };
  for (const { viewId, title } of snapshot.windows.slice(0, 32)) {
    for (const operation of ['show', 'focus', 'minimise', 'restore', 'close']) {
      add(`${operation} the Jarvis workspace window ${JSON.stringify(title)} (${viewId})`, { operation, viewId });
    }
    add(`make the Jarvis workspace window ${JSON.stringify(title)} bigger`, {
      operation: 'resize', viewId, width: 0.9, height: 0.9, x: 0.05, y: 0.05,
    });
  }
  for (const arrangement of ['tiled', 'layered']) {
    add(`arrange Jarvis workspace windows ${arrangement}${arrangement === 'tiled' ? ' / side by side' : ''}`,
      { operation: 'layout', arrangement });
  }
  for (const action of ['open', 'close']) {
    add(`${action} the Jarvis context panel`, { operation: 'context-panel', action });
  }
  return targets;
}

export function createReflexTargets(
  tools: readonly RegisteredTool[],
  taskIds: readonly string[] = [],
  browserGoal?: string,
  workspace?: WorkspaceSnapshot,
  appName = requestedAppName(browserGoal),
): ReflexTarget[] {
  const targets: ReflexTarget[] = [];
  for (const tool of tools) {
    if (tool.name === 'workspace_command' && workspace) {
      targets.push(...createWorkspaceReflexTargets(tool, workspace));
      continue;
    }
    if (tool.name === 'pc_open') {
      if (appName && !isEdgeAppName(appName)) {
        targets.push({
          choice: `target_${targets.length}`,
          tool,
          arguments: { target: 'app', value: appName },
        });
      }
      continue;
    }
    if (tool.name === 'pc_media' && tool.reflexSafe === true) {
      for (const action of ['play_pause', 'next', 'previous', 'volume_up', 'volume_down', 'mute']) {
        targets.push({
          choice: `target_${targets.length}`,
          tool,
          arguments: { action },
        });
      }
      continue;
    }
    if (!tool.reflexSafe) continue;
    const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
    if (tool.name === 'browser_do' && typeof browserGoal === 'string' &&
        browserGoal.trim().length > 0 && browserGoal.length <= 4_000) {
      targets.push({
        choice: `target_${targets.length}`,
        tool,
        arguments: { goal: browserGoal.trim() },
      });
      continue;
    }
    if (required.length === 0) {
      targets.push({ choice: `target_${targets.length}`, tool, arguments: {} });
      continue;
    }
    if (tool.name === 'pause_task' && required.length === 1 && required[0] === 'taskId') {
      for (const taskId of taskIds) {
        targets.push({
          choice: `target_${targets.length}`,
          tool,
          arguments: { taskId },
        });
      }
    }
  }
  return targets;
}

function requestedAppName(text: string | undefined): string | undefined {
  if (!text || text.length > 4_000) return undefined;
  const match = /^(?:jarvis[,\s]+)?(?:(?:please|can you)\s+)?(?:open|launch|start|åbn)\s+(?:the\s+)?(.+?)\s*[.!?]*$/iu
    .exec(text.trim());
  if (!match) return undefined;
  const name = match[1]!.replace(/\s+(?:please|now|for me|tak|nu)$/iu, '').trim();
  if (!name || name.length > 128 || /[/:\\]/u.test(name) ||
      /\b(?:and|then|search|navigate|website|webpage|tab|browser)\b/iu.test(name) ||
      /\b[a-z0-9-]+\.[a-z]{2,}\b/iu.test(name) ||
      Array.from(name).some(character => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })) return undefined;
  return name;
}

function isEdgeAppName(value: string): boolean {
  return ['edge', 'microsoftedge', 'msedge'].includes(value.toLowerCase().replace(/[^a-z0-9]/gu, ''));
}

export function createBrowserUrlTargets(tool: RegisteredTool | undefined, text: string): ReflexTarget[] {
  if (!tool) return [];
  const destination = /(?:\b(?:open|launch)\s+|\b(?:go|navigate)\s+to\s+|\b(?:åbn|start)\s+|\b(?:gå|naviger)\s+til\s+)([^\s,;!?]+)/iu
    .exec(text)?.[1]?.replace(/[.!?]+$/u, '');
  if (!destination) return [];

  const host = destination.replace(/^https?:\/\//iu, '').replace(/\/.*$/u, '').toLowerCase();
  const domain = host === 'google' ? 'www.google.com' : host.includes('.') ? host : undefined;
  if (!domain || !/^[a-z0-9.-]{1,253}$/u.test(domain)) return [];

  return [{
    choice: 'open_url',
    tool,
    arguments: { target: 'url', value: `https://${domain}/` },
  }];
}

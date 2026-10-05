import type { FastifyRequest } from 'fastify';
import { confirmToolCall, type ToolCallOutcome } from './tool-calls.js';
import { ToolFailure, ToolRefusal, type RegisteredTool } from './tool-registry.js';

const endpoint = 'https://api.typesafe.ai/v1/systemone';
const model = 'jev-latest';
const requestTimeoutMs = 1_200;
const maxResponseBytes = 256 * 1024;
const confidenceThreshold = 0.9;

export interface ReflexTarget {
  readonly choice: string;
  readonly tool: RegisteredTool;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ReflexClassification {
  readonly addressed: boolean;
  readonly intent: 'action' | 'question' | 'other';
  readonly confidence: number;
  readonly needsConfirmation: boolean;
  readonly completeCommand?: boolean;
  readonly contradictsExecuted?: boolean;
  readonly target: ReflexTarget | null;
}

export interface ReflexContext {
  readonly executed: readonly string[];
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
  ): Promise<ReflexClassification | null>;
}

export interface ReflexActionResult {
  readonly tool: string;
  readonly outcome: ToolCallOutcome;
  readonly note: string;
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
        choices[target.choice] = `${target.tool.name} with arguments ${JSON.stringify(target.arguments)}`;
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
        confidence: {
          type: 'score',
          instructions: 'How confidently is the intent and requested action fully understood?',
          criteria: ['uncertain', 'certain'],
        },
        needs_confirmation: {
          type: 'noul',
          instructions: 'Would the requested action have an external effect or require explicit confirmation?',
        },
      };
      if (context) {
        questions.complete_command = {
          type: 'noul',
          instructions: 'Does the latest stable transcript contain a new, complete command not already listed as executed?',
        };
        if (context.final && context.executed.length > 0) {
          questions.contradicts_executed = {
            type: 'noul',
            instructions: 'Does this final transcript explicitly contradict one of the listed executed actions?',
          };
        }
      }
      const body = JSON.stringify({
        model,
        state: {
          text: text.trim(),
          language,
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
          if (delay === undefined || delay >= requestTimeoutMs || requestSignal.aborted) return null;
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
        if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
          await response.body?.cancel().catch(() => {});
          return null;
        }
        const payload = record(await readBounded(response));
        const answers = record(payload?.answers);
        if (!answers) return null;
        const addressed = answer(answers, 'addressed', 'noul')?.noul;
        const intentAnswer = answer(answers, 'intent', 'choice');
        const routeAnswer = answer(answers, 'target', 'choice');
        const confidenceAnswer = answer(answers, 'confidence', 'score');
        const confirmation = answer(answers, 'needs_confirmation', 'noul')?.noul;
        const completeCommand = context
          ? answer(answers, 'complete_command', 'noul')?.noul
          : undefined;
        const contradiction = context?.final && context.executed.length > 0
          ? answer(answers, 'contradicts_executed', 'noul')?.noul
          : undefined;
        const intent = intentAnswer?.choice;
        const choice = routeAnswer?.choice;
        const routeConfidence = routeAnswer?.confidence;
        const confidenceScore = confidenceAnswer?.score;
        if (!validProbability(addressed) || !validProbability(confirmation) ||
            (context && !validProbability(completeCommand)) ||
            (context?.final && context.executed.length > 0 && !validProbability(contradiction)) ||
            (intent !== 'action' && intent !== 'question' && intent !== 'other') ||
            typeof intentAnswer?.confidence !== 'number' || !validProbability(intentAnswer.confidence) ||
            typeof choice !== 'string' || !Object.hasOwn(choices, choice) ||
            !validProbability(routeConfidence) || !validProbability(confidenceScore)) return null;

        const target = choice === 'main_agent' ? null : targets.find((item) => item.choice === choice) ?? null;
        return {
          addressed: addressed >= confidenceThreshold,
          intent,
          confidence: Math.min(intentAnswer.confidence, routeConfidence, confidenceScore),
          needsConfirmation: confirmation >= 0.5,
          ...(completeCommand === undefined ? {} : { completeCommand: completeCommand >= confidenceThreshold }),
          ...(contradiction === undefined ? {} : { contradictsExecuted: contradiction >= confidenceThreshold }),
          target,
        };
      } catch {
        return null;
      }
    },
  };
}

export async function executeReflexAction(
  classification: ReflexClassification | null,
  request: FastifyRequest,
  messageId: string,
  signal: AbortSignal,
  mode: 'partial' | 'final' = 'final',
): Promise<ReflexActionResult | null> {
  const target = classification?.target;
  const partialSafe = target?.tool.name === 'pause_task' && target.tool.reflexSafe === true ||
    target?.tool.name === 'pc_open' && target.arguments.target === 'url' &&
      typeof target.arguments.value === 'string' && safeHttpUrl(target.arguments.value);
  const modeSafe = mode === 'partial' ? partialSafe
    : mode === 'undo' ? target?.tool.name === 'resume_task'
      : target?.tool.reflexSafe === true;
  if (!classification?.addressed || classification.intent !== 'action' ||
      classification.completeCommand === false ||
      classification.confidence < confidenceThreshold || classification.needsConfirmation ||
      !target || !modeSafe ||
      !request.principal || !request.server.toolCallStore) return null;
  if (!request.validateInput(target.arguments, target.tool.inputSchema, 'body')) return null;

  const activityId = `reflex-${messageId}-${target.tool.name}`;
  request.server.jarvisActivityHub.publish({
    type: 'tool-call-started', activityId, source: request.routeOptions.url?.includes('/voice') ? 'voice' : 'chat',
    toolName: target.tool.name,
  });
  let outcome: ToolCallOutcome = 'ok';
  let result: unknown;
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
  }
  try {
    await request.server.toolCallStore.record({
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
    outcome,
    note: `Reflex already did ${target.tool.name} (${outcome}): ${confirmation}`,
  };
}

export async function undoPartialReflexAction(
  original: ReflexTarget,
  request: FastifyRequest,
  messageId: string,
  signal: AbortSignal,
): Promise<ReflexActionResult | null> {
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

export async function reflexTargets(request: FastifyRequest): Promise<ReflexTarget[]> {
  let taskIds: string[] = [];
  if (request.server.jarvisTools.get('pause_task')?.reflexSafe && request.server.taskStore) {
    try {
      taskIds = (await request.server.taskStore.list({ state: 'Running', limit: 100, offset: 0 }))
        .map(({ id }) => id);
    } catch {
      taskIds = [];
    }
  }
  return createReflexTargets(request.server.jarvisTools.list(), taskIds);
}

export function createReflexTargets(
  tools: readonly RegisteredTool[],
  taskIds: readonly string[] = [],
): ReflexTarget[] {
  const targets: ReflexTarget[] = [];
  for (const tool of tools) {
    if (!tool.reflexSafe) continue;
    const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
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

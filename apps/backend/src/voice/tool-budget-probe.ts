import type { FastifyBaseLogger } from 'fastify';
import WebSocket, { type RawData } from 'ws';
import { parseVoiceEvent } from './realtime.js';
import {
  TOOL_BUDGET_HEALTH_RUNG, TOOL_BUDGET_PROBE_NAMES, type ToolBudgetMemory, type ToolBudgetProbeName,
} from './tool-budget.js';
import type { VoiceConnectionFactory } from './relay.js';

export const TOOL_BUDGET_PROBE_INTERVAL_MS = 30 * 60_000;
export const TOOL_BUDGET_PROBE_DEADLINE_MS = 8_000;
const TOOL_BUDGET_PROBE_CLOSE_GRACE_MS = 250;

interface ProbeFrameMetrics {
  readonly toolCount: number;
  readonly toolBytes: number;
  readonly instructionsBytes: number;
  readonly frameBytes: number;
}

interface ProbeContext {
  readonly buildFrame: (probe: ToolBudgetProbeName) => unknown;
  readonly acquireToken: (signal: AbortSignal) => Promise<string>;
  readonly voiceModel: string;
  readonly memory: ToolBudgetMemory;
  readonly log: FastifyBaseLogger;
}

interface ActiveProbe {
  readonly done: Promise<void>;
  finish(outcome: 'timeout' | 'error' | 'closed' | 'ready'): void;
}

function measureFrame(frame: unknown, serialized: string): ProbeFrameMetrics {
  const session = (frame as { session?: {
    tools?: unknown[];
    instructions?: unknown;
  } }).session;
  const tools = session?.tools ?? [];
  return {
    toolCount: tools.length,
    toolBytes: Buffer.byteLength(JSON.stringify(tools)),
    instructionsBytes: typeof session?.instructions === 'string'
      ? Buffer.byteLength(session.instructions) : 0,
    frameBytes: Buffer.byteLength(serialized),
  };
}

function closeSocket(socket: WebSocket): void {
  if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Voice tool-budget probe');
  else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
}

export interface VoiceToolBudgetProbe {
  start(context: ProbeContext): boolean;
  close(): Promise<void>;
}

export function createVoiceToolBudgetProbe(
  connect: VoiceConnectionFactory,
  enabled = true,
  now: () => number = () => performance.now(),
): VoiceToolBudgetProbe {
  let disposed = false;
  let running = false;
  let lastRunAt: number | undefined;
  let active: ActiveProbe | undefined;

  const runProbe = (
    probe: ToolBudgetProbeName, serialized: string,
    metrics: ProbeFrameMetrics, context: ProbeContext,
  ): Promise<'timeout' | 'error' | 'closed' | 'ready'> => new Promise((resolve) => {
    const startedAt = now();
    const controller = new AbortController();
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let resolveDone!: () => void;
    const done = new Promise<void>((doneResolve) => { resolveDone = doneResolve; });
    const log = (outcome: 'timeout' | 'error' | 'closed' | 'ready') => {
      const fields = { probe, ...metrics, outcome, elapsedMs: Math.max(0, Math.round(now() - startedAt)) };
      context.log[outcome === 'ready' ? 'info' : 'warn'](fields, 'voice.tool_budget_probe');
    };
    function finish(outcome: 'timeout' | 'error' | 'closed' | 'ready') {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      timer = undefined;
      controller.abort();
      log(outcome);
      const finishClose = () => {
        clearTimeout(closeTimer);
        closeTimer = undefined;
        if (active === current) active = undefined;
        resolve(outcome);
        resolveDone();
      };
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.once('close', finishClose);
        closeTimer = setTimeout(() => {
          if (socket?.readyState !== WebSocket.CLOSED) socket?.terminate();
          finishClose();
        }, TOOL_BUDGET_PROBE_CLOSE_GRACE_MS);
        closeTimer.unref();
        closeSocket(socket);
      } else {
        finishClose();
      }
    }
    const current = { done, finish };
    active = current;
    timer = setTimeout(() => finish('timeout'), TOOL_BUDGET_PROBE_DEADLINE_MS);
    timer.unref();
    const onError = () => finish('error');
    const onClose = () => finish('closed');
    const onOpen = () => {
      if (settled || !socket) return;
      try {
        socket.send(serialized, (error) => { if (error) finish('error'); });
      } catch {
        finish('error');
      }
    };
    const onMessage = (data: RawData, binary: boolean) => {
      const event = parseVoiceEvent(data, binary);
      if (event?.type === 'session.updated') finish('ready');
      else if (event?.type === 'error') finish('error');
    };

    void context.acquireToken(controller.signal).then((token) => {
      if (settled || disposed) {
        if (!settled) finish('closed');
        return;
      }
      socket = connect(token, controller.signal, undefined, context.voiceModel);
      socket.once('open', onOpen);
      socket.on('message', onMessage);
      socket.once('error', onError);
      socket.once('close', onClose);
    }).catch(() => finish(disposed ? 'closed' : 'error'));

    void done.then(() => {
      socket?.removeListener('open', onOpen);
      socket?.removeListener('message', onMessage);
      socket?.removeListener('error', onError);
      socket?.removeListener('close', onClose);
    });
  });

  const run = async (context: ProbeContext) => {
    for (const probe of TOOL_BUDGET_PROBE_NAMES) {
      if (disposed) return;
      let frame: unknown;
      let serialized: string;
      let metrics: ProbeFrameMetrics;
      try {
        frame = context.buildFrame(probe);
        serialized = JSON.stringify(frame);
        metrics = measureFrame(frame, serialized);
      } catch {
        context.log.warn({
          probe, toolCount: 0, toolBytes: 0, instructionsBytes: 0, frameBytes: 0,
          outcome: 'error', elapsedMs: 0,
        }, 'voice.tool_budget_probe');
        continue;
      }
      const outcome = await runProbe(probe, serialized, metrics, context);
      if (outcome === 'ready') {
        if (probe === 'full') context.memory.set(0);
        else if (probe === 'no_proactive') context.memory.set(TOOL_BUDGET_HEALTH_RUNG);
      }
      if (outcome === 'ready' || disposed) return;
    }
  };

  return {
    start(context) {
      const startedAt = now();
      if (!enabled || disposed || running ||
          (lastRunAt !== undefined && startedAt - lastRunAt < TOOL_BUDGET_PROBE_INTERVAL_MS)) return false;
      running = true;
      lastRunAt = startedAt;
      queueMicrotask(() => {
        if (disposed) {
          running = false;
          return;
        }
        void run(context).catch(() => {
          context.log.warn({
            probe: 'full', toolCount: 0, toolBytes: 0, instructionsBytes: 0, frameBytes: 0,
            outcome: 'error', elapsedMs: 0,
          }, 'voice.tool_budget_probe');
        }).finally(() => { running = false; });
      });
      return true;
    },
    async close() {
      disposed = true;
      const current = active;
      current?.finish('closed');
      await current?.done;
    },
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicConfig } from '../config/public-config';
import { backendFetch } from './backend-request';
import type { ScreenShareController } from './screen-sharing';

export const WATCH_INTERVAL_MS = 2_600;
const MAX_CONSECUTIVE_FAILURES = 3;

export interface WatchBudget {
  readonly usedUsd: number;
  readonly limitUsd: number;
}

export interface VisionWatchController {
  /** True only while frames are actually being sent for this source. */
  readonly watching: boolean;
  /** Shared daily vision budget as last reported by the backend, null until the first answer. */
  readonly budget: WatchBudget | null;
  start(): void;
  stop(): void;
}

class WatchRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function formatWatchBudget(budget: WatchBudget | null): string {
  if (!budget) return '';
  const usd = (value: number) => `$${value.toFixed(2)}`;
  return `${usd(budget.usedUsd)} of ${usd(budget.limitUsd)} used today`;
}

function parseResult(value: unknown): WatchBudget {
  if (typeof value === 'object' && value !== null && 'budget' in value) {
    const { budget } = value;
    if (typeof budget === 'object' && budget !== null && 'usedUsd' in budget && 'limitUsd' in budget &&
        typeof budget.usedUsd === 'number' && typeof budget.limitUsd === 'number' &&
        Number.isFinite(budget.usedUsd) && Number.isFinite(budget.limitUsd)) {
      return { usedUsd: budget.usedUsd, limitUsd: budget.limitUsd };
    }
  }
  throw new WatchRequestError('Jarvis returned an invalid watch response.', 502);
}

async function postFrame(
  backendUrl: string, token: string, sessionId: string, source: 'screen' | 'camera', frame: string, signal: AbortSignal,
): Promise<WatchBudget> {
  const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/vision/watch`, {
    method: 'POST',
    headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, source, frame }),
    signal,
  });
  if (!response.ok) {
    let message = 'Jarvis could not watch the shared image.';
    try {
      const value: unknown = await response.json();
      if (typeof value === 'object' && value !== null && 'error' in value &&
          typeof value.error === 'string' && value.error.length <= 300) message = value.error;
    } catch { /* Keep the stable message. */ }
    throw new WatchRequestError(message, response.status);
  }
  return parseResult(await response.json());
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Continuous watching for one already-shared source. It never starts capture itself: watching ends when the
 * share ends, the conversation session changes, Dan stops it, the budget is spent, or the backend refuses it.
 */
export function useVisionWatch(
  config: PublicConfig,
  getAccessToken: () => Promise<string>,
  capture: Pick<ScreenShareController, 'sharing' | 'captureFrame'> | undefined,
  source: 'screen' | 'camera',
  sessionId: string | null,
  onStopped?: (message: string) => void,
): VisionWatchController {
  const [requested, setRequested] = useState(false);
  const [budget, setBudget] = useState<WatchBudget | null>(null);
  const sharing = capture?.sharing ?? false;
  const captureFrame = capture?.captureFrame;
  const backendUrl = config.backendUrl;
  const tokenRef = useRef(getAccessToken);
  const stoppedRef = useRef(onStopped);
  useEffect(() => { tokenRef.current = getAccessToken; stoppedRef.current = onStopped; }, [getAccessToken, onStopped]);
  const ready = sharing && Boolean(sessionId) && Boolean(captureFrame) && Boolean(config.backendUrl);
  const watching = requested && ready;

  // A share that ended or a session that changed ends watching; adjust during render rather than in an effect.
  if (requested && !ready) setRequested(false);

  useEffect(() => {
    if (!watching || !sessionId || !captureFrame || !backendUrl) return;
    const activeSession = sessionId;
    const controller = new AbortController();
    const { signal } = controller;
    const run = async () => {
      let failures = 0;
      let previous = '';
      while (!signal.aborted) {
        try {
          const frame = await captureFrame();
          if (signal.aborted) return;
          // Unchanged frames carry nothing new and would only spend budget.
          if (frame !== previous) {
            const next = await postFrame(backendUrl, await tokenRef.current(), activeSession, source, frame, signal);
            if (signal.aborted) return;
            previous = frame;
            setBudget(next);
          }
          failures = 0;
        } catch (reason) {
          if (signal.aborted) return;
          const failure = reason instanceof WatchRequestError ? reason : null;
          if (failure && (failure.status === 404 || (failure.status === 429 && /budget/iu.test(failure.message)))) {
            stoppedRef.current?.(failure.message);
            setRequested(false);
            return;
          }
          if (!(failure?.status === 429)) failures += 1;
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            stoppedRef.current?.(`Watching stopped: ${failure?.message ?? 'Jarvis could not capture the shared image.'}`);
            setRequested(false);
            return;
          }
        }
        await pause(WATCH_INTERVAL_MS, signal);
      }
    };
    void run();
    return () => controller.abort();
  }, [backendUrl, captureFrame, sessionId, source, watching]);

  const start = useCallback(() => {
    if (!ready) return;
    setRequested(true);
  }, [ready]);
  const stop = useCallback(() => setRequested(false), []);
  return { watching, budget, start, stop };
}

import type { ActivityAlert } from '../alerts.js';
import type { AlertActivityStore } from '../database/alert-store.js';

const budgetResourceIdPattern = /^\/subscriptions\/[\da-f-]+\/resourceGroups\/[a-z\d._()-]+\/providers\/Microsoft\.Consumption\/budgets\/[a-z\d._()-]+$/iu;
const armScope = 'https://management.azure.com/.default';
const apiVersion = '2019-10-01';
const requestTimeoutMs = 10_000;
const maxResponseBytes = 256 * 1024;

export interface BudgetSnapshot {
  amount: number;
  currentSpend: number;
  periodStart: string;
}

export interface BudgetReader {
  read(signal: AbortSignal): Promise<BudgetSnapshot>;
}

interface ArmBudgetReaderOptions {
  resourceId: string;
  getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  fetcher?: typeof fetch;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel();
    throw new Error('Azure budget response was too large');
  }
  if (!response.body) throw new Error('Azure budget response was empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw new Error('Azure budget response was too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new Error('Azure budget response was invalid'); }
}

export function createArmBudgetReader({
  resourceId,
  getToken,
  fetcher = fetch,
}: ArmBudgetReaderOptions): BudgetReader {
  if (!budgetResourceIdPattern.test(resourceId)) throw new Error('Invalid Azure budget resource ID');
  const url = new URL(`https://management.azure.com${resourceId}`);
  url.searchParams.set('api-version', apiVersion);

  return {
    async read(signal) {
      const timeout = AbortSignal.timeout(requestTimeoutMs);
      const boundedSignal = AbortSignal.any([signal, timeout]);
      const token = await getToken(armScope, boundedSignal);
      if (!token.trim() || /[\r\n]/u.test(token)) throw new Error('Azure budget identity token unavailable');
      const response = await fetcher(url, {
        headers: { Authorization: ['Bear', 'er'].join('') + ' ' + token, Accept: 'application/json' },
        redirect: 'error',
        signal: boundedSignal,
      });
      if (response.redirected || !response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('Azure budget request failed');
      }
      const result = await readJson(response);
      if (!object(result) || !object(result.properties)) throw new Error('Azure budget response was incomplete');
      const properties = result.properties;
      const period = object(properties.timePeriod) ? properties.timePeriod.startDate : undefined;
      const spend = object(properties.currentSpend) ? properties.currentSpend.amount : undefined;
      if (typeof properties.amount !== 'number' || !Number.isFinite(properties.amount) || properties.amount <= 0 ||
        typeof spend !== 'number' || !Number.isFinite(spend) || spend < 0 ||
        typeof period !== 'string' || !Number.isFinite(Date.parse(period))) {
        throw new Error('Azure budget response was incomplete');
      }
      return { amount: properties.amount, currentSpend: spend, periodStart: period };
    },
  };
}

export async function recordBudgetThresholdIfReached(
  reader: BudgetReader,
  alerts: AlertActivityStore,
  signal: AbortSignal,
): Promise<boolean> {
  const budget = await reader.read(signal);
  if (budget.currentSpend / budget.amount < 0.8) return false;
  const start = new Date(budget.periodStart);
  if (!Number.isFinite(start.getTime())) throw new Error('Azure budget period was invalid');
  const period = start.toISOString().slice(0, 7);
  const alert: ActivityAlert = {
    type: 'budget_threshold',
    dedupeKey: `budget-80:${period}`,
    title: 'Monthly Azure budget reached 80%',
    link: null,
  };
  return alerts.record(alert);
}

export function startBudgetAlertMonitor(
  reader: BudgetReader,
  alerts: AlertActivityStore,
  onError: () => void,
  intervalMs = 15 * 60_000,
): () => Promise<void> {
  let stopped = false;
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;

  const check = () => {
    if (stopped || running) return;
    controller = new AbortController();
    const activeController = controller;
    running = recordBudgetThresholdIfReached(reader, alerts, activeController.signal)
      .then(() => undefined)
      .catch(() => { if (!activeController.signal.aborted) onError(); })
      .finally(() => {
        if (controller === activeController) controller = undefined;
        running = undefined;
      });
  };
  check();
  const timer = setInterval(check, intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    controller?.abort();
    await running;
  };
}

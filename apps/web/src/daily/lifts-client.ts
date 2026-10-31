import { awaitWithSignal, backendFetch } from '../backend-request';

export interface LiftEntry {
  id: string;
  exerciseName: string;
  weightKg: number;
  reps: number;
  sets: number;
  performedAt: string;
  deletedAt: string | null;
  updatedAt: string;
  revision: number;
}

export interface LiftDraft {
  exerciseName: string;
  weightKg: number;
  reps: number;
  sets: number;
}

export class LiftWriteError extends Error {
  constructor(readonly kind: 'unavailable' | 'auth' | 'rejected' | 'invalid' | 'offline' | 'failed', message: string) {
    super(message);
    this.name = 'LiftWriteError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/u.test(value) && Number.isFinite(Date.parse(value));
}

function parseEntry(value: unknown): LiftEntry | null {
  if (!isRecord(value) || typeof value.id !== 'string' ||
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(value.id) ||
      typeof value.exerciseName !== 'string' || value.exerciseName.trim() !== value.exerciseName ||
      value.exerciseName.length < 1 || value.exerciseName.length > 80 ||
      typeof value.weightKg !== 'number' || !Number.isFinite(value.weightKg) || value.weightKg < 0 || value.weightKg > 1000 ||
      Math.abs(value.weightKg * 100 - Math.round(value.weightKg * 100)) >= 1e-7 ||
      !Number.isSafeInteger(value.reps) || Number(value.reps) < 1 || Number(value.reps) > 1000 ||
      !Number.isSafeInteger(value.sets) || Number(value.sets) < 1 || Number(value.sets) > 100 ||
      !isTime(value.performedAt) || value.deletedAt !== null && !isTime(value.deletedAt) ||
      !isTime(value.updatedAt) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) return null;
  return {
    id: value.id, exerciseName: value.exerciseName, weightKg: value.weightKg, reps: Number(value.reps),
    sets: Number(value.sets), performedAt: value.performedAt, deletedAt: value.deletedAt as string | null,
    updatedAt: value.updatedAt, revision: Number(value.revision),
  };
}

async function responseJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('application/json') ||
      declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > 16 * 1024)) {
    await response.body?.cancel();
    throw new LiftWriteError('invalid', 'Jarvis returned an unreadable lift response.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16 * 1024) throw new LiftWriteError('invalid', 'Jarvis returned an unreadable lift response.');
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join('')) as unknown;
  } catch (error) {
    if (error instanceof LiftWriteError) throw error;
    throw new LiftWriteError('invalid', 'Jarvis returned an unreadable lift response.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function write<T>(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  signal: AbortSignal,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  result: (value: unknown) => T | null,
): Promise<T> {
  if (!backendUrl) throw new LiftWriteError('unavailable', 'Workout logging is not available here.');
  signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  let token: string;
  try { token = await awaitWithSignal(getAccessToken, signal); }
  catch {
    signal.throwIfAborted();
    throw new LiftWriteError('auth', 'Sign in as the Jarvis owner to save lifts.');
  }
  let response: Response;
  try {
    response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
      method, signal, cache: 'no-store',
      headers: {
        Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    signal.throwIfAborted();
    throw new LiftWriteError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'failed',
      typeof navigator !== 'undefined' && !navigator.onLine ? 'You are offline. Your lift is still in the form.' : 'Lift could not be saved. Try again.');
  }
  let value: unknown;
  try { value = await responseJson(response); }
  catch (error) {
    if (response.status < 400) throw error;
    signal.throwIfAborted();
    throw new LiftWriteError('failed', 'Lift could not be saved. Try again.');
  }
  if (!response.ok) {
    const message = isRecord(value) && typeof value.error === 'string' && value.error.length <= 240
      ? value.error : response.status >= 500 ? 'Lift could not be saved. Try again.' : 'Lift request was rejected.';
    const kind = response.status === 401 || response.status === 403 ? 'auth'
      : response.status === 400 ? 'rejected' : response.status === 404 || response.status === 405 ? 'unavailable' : 'failed';
    throw new LiftWriteError(kind, message);
  }
  const parsed = result(value);
  if (parsed === null) throw new LiftWriteError('invalid', 'Jarvis returned an unreadable lift response.');
  return parsed;
}

export function createLift(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  payload: LiftDraft & { idempotencyKey: string },
  signal: AbortSignal,
): Promise<{ entry: LiftEntry; replayed: boolean }> {
  return write(backendUrl, getAccessToken, signal, '/daily/lifts', 'POST', payload, value => {
    if (!isRecord(value) || typeof value.replayed !== 'boolean') return null;
    const entry = parseEntry(value.entry);
    return entry ? { entry, replayed: value.replayed } : null;
  });
}

export function updateLift(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  id: string,
  patch: LiftDraft,
  signal: AbortSignal,
): Promise<LiftEntry> {
  return write(backendUrl, getAccessToken, signal, `/daily/lifts/${encodeURIComponent(id)}`, 'PATCH', patch,
    value => isRecord(value) ? parseEntry(value.entry) : null);
}

export function deleteLift(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  id: string,
  signal: AbortSignal,
): Promise<LiftEntry> {
  return write(backendUrl, getAccessToken, signal, `/daily/lifts/${encodeURIComponent(id)}`, 'DELETE', undefined,
    value => isRecord(value) ? parseEntry(value.entry) : null);
}

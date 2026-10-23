import type { OwnerSessionStore } from './store.js';

export const ownerSessionBootRevokeTimeoutMs = 60_000;

export type OwnerSessionBootRevokeLog = {
  readonly outcome: 'revoked' | 'table_missing' | 'skipped' | 'failed';
  readonly count?: number;
};

export function startOwnerSessionBootRevoke(options: {
  readonly enabled: boolean;
  readonly store?: Pick<OwnerSessionStore, 'revokeAll'>;
  readonly ownerObjectId?: string;
  readonly log: (fields: OwnerSessionBootRevokeLog) => void;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}): void {
  const log = (fields: OwnerSessionBootRevokeLog) => {
    try { options.log(fields); } catch { /* Startup must not depend on logging. */ }
  };
  if (options.enabled || !options.store || !options.ownerObjectId) {
    log({ outcome: 'skipped' });
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Owner session boot revoke timed out')),
      options.timeoutMs ?? ownerSessionBootRevokeTimeoutMs);
  });
  const revoke = Promise.resolve().then(() =>
    options.store!.revokeAll(options.ownerObjectId!, (options.now ?? (() => new Date()))()));
  void Promise.race([revoke, timeout]).then(
    (count) => log({ outcome: 'revoked', count }),
    (error: unknown) => log({ outcome: isMissingOwnerSessionTable(error) ? 'table_missing' : 'failed' }),
  ).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function isMissingOwnerSessionTable(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const details = error as Record<string, unknown>;
  return details.number === 208 ||
    (details.originalError !== null && typeof details.originalError === 'object' &&
      (details.originalError as Record<string, unknown>).number === 208);
}

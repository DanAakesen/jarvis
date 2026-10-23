import type { UserPrincipal } from '../verify.js';
import { SessionLookupAdmission } from './admission.js';
import { ownerSessionPolicy, type OwnerSessionPolicy } from './config.js';
import { SlidingWindowRateLimiter, type RateDecision } from './rate-limit.js';
import type { OwnerSessionRecord, OwnerSessionStore } from './store.js';
import {
  generateOwnerSessionCredential, ownerSessionPrefix, ownerSessionSecretMatches, parseOwnerSessionToken,
  spendOwnerSessionComparison,
} from './token.js';

/** The session store failed. Callers answer 503, never 401: the client must keep a good session. */
export class OwnerSessionUnavailable extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Owner session store unavailable', options);
    this.name = 'OwnerSessionUnavailable';
  }
}

/**
 * A lookup was refused before the store was read, because too many lookups of unfamiliar ids are running or
 * were run. Callers answer 429, never 401: the token was not judged, so the client must keep it.
 */
export class OwnerSessionThrottled extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Owner session lookup throttled');
    this.name = 'OwnerSessionThrottled';
  }
}

/** Why a token was refused. Used for audit logging only; the client always sees the same 401. */
export type OwnerSessionRejection =
  | 'malformed' | 'unknown_session' | 'secret_mismatch' | 'revoked' | 'idle_expired' | 'absolute_expired'
  | 'owner_mismatch';

/** The session a request authenticated with; `prefix` is the only form of the id that may be logged. */
export interface OwnerSessionContext {
  readonly id: string;
  readonly prefix: string;
}

export type OwnerSessionVerdict =
  | {
    readonly ok: true;
    /** Same shape as the owner principal a verified Entra token yields. */
    readonly principal: UserPrincipal;
    readonly session: OwnerSessionContext;
    /** `failed` means the verification stands but the sliding expiry was not extended this time. */
    readonly refresh: 'none' | 'extended' | 'failed';
  }
  | { readonly ok: false; readonly reason: OwnerSessionRejection; readonly prefix: string | null };

export interface OwnerSessionVerifier {
  /** Rejects with OwnerSessionThrottled when admission refuses the lookup and with OwnerSessionUnavailable when the store fails. */
  verify(token: string): Promise<OwnerSessionVerdict>;
}

export interface OwnerSessionServiceOptions {
  readonly store: OwnerSessionStore;
  /** Lower-case object id of the single owner; the store's owner must still match it on every verification. */
  readonly ownerObjectId: string;
  readonly tenantId: string;
  readonly policy?: OwnerSessionPolicy;
  readonly now?: () => Date;
  readonly random?: (size: number) => Buffer;
}

export interface CreateOwnerSessionRequest {
  readonly ownerObjectId: string;
  readonly displayName: string;
  readonly deviceLabel: string | null;
}

export interface CreatedOwnerSession {
  readonly sessionId: string;
  readonly prefix: string;
  /** The only time the token exists in readable form. */
  readonly token: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  /** Sessions revoked to stay within the active limit. */
  readonly evicted: number;
}

export class OwnerSessionService implements OwnerSessionVerifier {
  readonly policy: OwnerSessionPolicy;
  private readonly store: OwnerSessionStore;
  private readonly owner: string;
  private readonly tenantId: string;
  private readonly now: () => Date;
  private readonly random: ((size: number) => Buffer) | undefined;
  private readonly createLimiter: SlidingWindowRateLimiter;
  private readonly admission: SessionLookupAdmission;

  constructor(options: OwnerSessionServiceOptions) {
    this.policy = options.policy ?? ownerSessionPolicy;
    this.store = options.store;
    this.owner = options.ownerObjectId.toLowerCase();
    this.tenantId = options.tenantId;
    this.now = options.now ?? (() => new Date());
    this.random = options.random;
    this.createLimiter = new SlidingWindowRateLimiter(this.policy.createLimits, this.now);
    this.admission = new SessionLookupAdmission(this.policy.lookupAdmission, this.now);
  }

  /** True when the object id belongs to the single configured owner. */
  isOwner(objectId: string): boolean {
    return objectId.toLowerCase() === this.owner;
  }

  /** Counts one create attempt for the owner against the sliding-window limits. */
  consumeCreateAllowance(ownerObjectId: string): RateDecision {
    return this.createLimiter.consume(ownerObjectId.toLowerCase());
  }

  async create(input: CreateOwnerSessionRequest): Promise<CreatedOwnerSession> {
    const now = this.now();
    const credential = generateOwnerSessionCredential(this.random);
    const absoluteExpiresAt = new Date(now.getTime() + this.policy.absoluteLifetimeMs);
    const idleExpiresAt = new Date(Math.min(now.getTime() + this.policy.idleLifetimeMs, absoluteExpiresAt.getTime()));
    const record: OwnerSessionRecord = {
      sessionId: credential.sessionId,
      secretHash: credential.secretHash,
      ownerObjectId: input.ownerObjectId.toLowerCase(),
      displayName: input.displayName,
      deviceLabel: input.deviceLabel,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      revokedAt: null,
    };
    const { evicted } = await this.guarded(() => this.store.create({
      record,
      maxActive: this.policy.maxActiveSessions,
      purgeBefore: new Date(now.getTime() - this.policy.retentionAfterDeathMs),
    }));
    return {
      sessionId: credential.sessionId,
      prefix: ownerSessionPrefix(credential.sessionId),
      token: credential.token,
      idleExpiresAt,
      absoluteExpiresAt,
      evicted,
    };
  }

  async verify(token: string): Promise<OwnerSessionVerdict> {
    const credential = parseOwnerSessionToken(token);
    if (!credential) return { ok: false, reason: 'malformed', prefix: null };
    const { sessionId, secret } = credential;
    // Admission comes before any store access, so a caller without a valid session cannot cause database work.
    const admission = this.admission.admit(sessionId);
    if (!admission.admitted) throw new OwnerSessionThrottled(admission.retryAfterSeconds);
    try {
      const verdict = await this.lookup(sessionId, secret);
      if (verdict.ok) this.admission.verified(sessionId);
      else this.admission.forget(sessionId);
      return verdict;
    } finally {
      admission.release();
    }
  }

  // Reads the store and judges the credential. A store failure propagates and leaves the admission state alone.
  private async lookup(sessionId: string, secret: string): Promise<OwnerSessionVerdict> {
    const prefix = ownerSessionPrefix(sessionId);
    const record = await this.guarded(() => this.store.find(sessionId));
    if (!record) {
      spendOwnerSessionComparison(secret);
      return { ok: false, reason: 'unknown_session', prefix };
    }
    if (!ownerSessionSecretMatches(record.secretHash, secret)) return { ok: false, reason: 'secret_mismatch', prefix };
    const now = this.now();
    if (record.revokedAt !== null) return { ok: false, reason: 'revoked', prefix };
    // The sliding expiry is clamped to the cap, so check the cap first: it names why a session that was used
    // right up to the end of its life stopped working.
    if (now >= record.absoluteExpiresAt) return { ok: false, reason: 'absolute_expired', prefix };
    if (now >= record.idleExpiresAt) return { ok: false, reason: 'idle_expired', prefix };
    if (record.ownerObjectId.toLowerCase() !== this.owner) return { ok: false, reason: 'owner_mismatch', prefix };
    return {
      ok: true,
      principal: { objectId: this.owner, tenantId: this.tenantId, displayName: record.displayName },
      session: { id: sessionId, prefix },
      refresh: await this.refresh(record, now),
    };
  }

  /** Revokes one session of the owner; false when it was already revoked. */
  async revokeCurrent(ownerObjectId: string, sessionId: string): Promise<boolean> {
    return this.guarded(() => this.store.revoke(ownerObjectId.toLowerCase(), sessionId, this.now()));
  }

  /** Revokes every active session of the owner, including the caller's own. */
  async revokeAll(ownerObjectId: string): Promise<number> {
    return this.guarded(() => this.store.revokeAll(ownerObjectId.toLowerCase(), this.now()));
  }

  // Extends the idle expiry at most once per refresh interval. A failed write never fails the request;
  // the next request retries it.
  private async refresh(record: OwnerSessionRecord, now: Date): Promise<'none' | 'extended' | 'failed'> {
    if (now.getTime() - record.lastUsedAt.getTime() < this.policy.refreshAfterMs) return 'none';
    const idleExpiresAt = new Date(Math.min(now.getTime() + this.policy.idleLifetimeMs, record.absoluteExpiresAt.getTime()));
    try {
      const changed = await this.store.touch({
        sessionId: record.sessionId,
        now,
        idleExpiresAt,
        staleBefore: new Date(now.getTime() - this.policy.refreshAfterMs),
      });
      return changed ? 'extended' : 'none';
    } catch {
      return 'failed';
    }
  }

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      throw new OwnerSessionUnavailable({ cause });
    }
  }
}

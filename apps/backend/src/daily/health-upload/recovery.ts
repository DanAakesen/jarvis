import { setTimeout as delay } from 'node:timers/promises';
import type { AzureHealthBuffer,OwnedHealthRecovery } from './azure-buffer.js';
import type { HealthHostConfig } from './host-config.js';

const ceiling = 1_000_000_000;
export interface RecoveryStatus {
  state: 'disabled' | 'idle' | 'running' | 'stopping' | 'stopped';
  outcome: 'never' | 'complete' | 'partial' | 'busy' | 'error' | 'timeout' | 'canceled';
  attempts: number; inspected: number; queued: number; failed: number; hasMore: boolean | null;
  lastAttemptAt: string | null; lastCompletedAt: string | null; nextDelayMs: number;
}
export class HealthOutboxRecovery {
  private readonly controller = new AbortController();
  private task: Promise<void> | null = null;
  private current: Promise<RecoveryStatus> | null = null;
  private active = false;
  private statusValue: RecoveryStatus;
  constructor(private readonly config: HealthHostConfig,private readonly buffer: Pick<AzureHealthBuffer,'recoverOwnedPage'>,
    private readonly observe?: (status: RecoveryStatus) => void) {
    this.statusValue = { state: config.recoveryEnabled ? 'idle' : 'disabled',outcome: 'never',attempts: 0,inspected: 0,queued: 0,failed: 0,
      hasMore: null,lastAttemptAt: null,lastCompletedAt: null,nextDelayMs: config.recoveryIntervalMs };
  }
  status(): RecoveryStatus { return { ...this.statusValue }; }
  once(): Promise<RecoveryStatus> {
    if (!this.config.recoveryEnabled || this.active || this.controller.signal.aborted) throw new TypeError('Recovery not available');
    const current = this.execute(); this.current = current;
    return current.finally(() => { if (this.current === current) this.current = null; });
  }
  private async execute(): Promise<RecoveryStatus> {
    this.active = true; this.statusValue.state = 'running';
    this.statusValue.attempts = Math.min(ceiling,this.statusValue.attempts + 1); this.statusValue.lastAttemptAt = new Date().toISOString();
    const signal = AbortSignal.any([this.controller.signal,AbortSignal.timeout(this.config.recoveryDeadlineMs)]);
    try {
      const result: OwnedHealthRecovery = await this.buffer.recoverOwnedPage({ limit: this.config.recoveryPageSize,...(this.config.replayQueued ? { replayQueued: true } : {}) },signal);
      signal.throwIfAborted();
      for (const key of ['inspected','queued','failed'] as const) this.statusValue[key] = Math.min(ceiling,this.statusValue[key] + result[key]);
      this.statusValue.hasMore = result.hasMore;
      this.statusValue.outcome = result.ownership === 'busy' ? 'busy' : result.failed ? 'partial' : 'complete';
      this.statusValue.lastCompletedAt = new Date().toISOString();
    } catch { this.statusValue.outcome = this.controller.signal.aborted ? 'canceled' : signal.aborted ? 'timeout' : 'error'; }
    finally {
      this.active = false;
      this.statusValue.nextDelayMs = ['partial','error','timeout'].includes(this.statusValue.outcome)
        ? Math.min(300000,this.statusValue.nextDelayMs * 2) : this.config.recoveryIntervalMs;
      this.statusValue.state = this.controller.signal.aborted ? 'stopped' : 'idle';
      try { this.observe?.(this.status()); } catch { /* Diagnostics cannot change durable delivery. */ }
    }
    return this.status();
  }
  start(): void {
    if (!this.config.recoveryEnabled) return;
    if (this.task || this.active || this.controller.signal.aborted) throw new TypeError('Recovery already owned');
    this.task = this.loop();
  }
  private async loop() {
    while (!this.controller.signal.aborted) {
      await this.once();
      try { await delay(this.statusValue.nextDelayMs,undefined,{ signal: this.controller.signal }); } catch { break; }
    }
    this.statusValue.state = 'stopped';
  }
  async stop(): Promise<void> {
    if (!this.controller.signal.aborted) { this.statusValue.state = 'stopping'; this.controller.abort(); }
    if (this.task) await this.task;
    else if (this.current) await this.current;
    this.statusValue.state = 'stopped';
  }
}

import { ManagedIdentityCredential } from '@azure/identity';
import { createAzureHealthDependencies } from './azure-buffer.js';
import { buildHealthUploadServer,type HealthHttpObservation } from './server.js';
import { HealthOutboxRecovery,type RecoveryStatus } from './recovery.js';
import type { HealthHostConfig } from './host-config.js';

export type HealthDependencies = ReturnType<typeof createAzureHealthDependencies>;
export function createManagedHealthDependencies(config: HealthHostConfig): HealthDependencies {
  if (!config.enabled || !config.managedIdentityClientId) throw new TypeError('Health host not enabled');
  // No CLI/developer credential chain, human password, shared key or new permission grant.
  return createAzureHealthDependencies(config,new ManagedIdentityCredential({ clientId: config.managedIdentityClientId }));
}
export interface HealthHostStatus {
  lifecycle: 'running' | 'stopping' | 'stopped'; acceptance: 'configured' | 'inactive'; processing: 'not-configured';
  acceptedUploads: number; acceptedHeartbeats: number; pendingReceipts: number; queuedReceipts: number; duplicateReceipts: number; rejected: number;
  recovery: RecoveryStatus | null;
}
export type HealthReceiptDiagnostics = Omit<HealthHostStatus,'recovery'> & {
  event: 'health_receipt_events'; semantics: 'cumulative-receipt-events'; reason: 'interval' | 'shutdown';
};
/** Separate explicit entry point only. Existing Jarvis main is never changed. */
export async function startHealthUploadHost(config: HealthHostConfig,injected?: HealthDependencies,observeRecovery?: (status: RecoveryStatus) => void,observeDiagnostics?: (status: HealthReceiptDiagnostics) => void) {
  if (config.mode !== 'serve') throw new TypeError('Invalid host mode');
  const dependencies = config.enabled ? injected ?? createManagedHealthDependencies(config) : undefined;
  const controller = new AbortController();
  const counts = { acceptedUploads: 0,acceptedHeartbeats: 0,pendingReceipts: 0,queuedReceipts: 0,duplicateReceipts: 0,rejected: 0 };
  let lifecycle: HealthHostStatus['lifecycle'] = 'running'; let stopping: Promise<'drained' | 'deadline'> | null = null;
  const increment = (key: keyof typeof counts) => { counts[key] = Math.min(1_000_000_000,counts[key] + 1); };
  const observe = (event: HealthHttpObservation) => {
    if (event.type === 'rejected') { increment('rejected'); return; }
    increment(event.kind === 'upload' ? 'acceptedUploads' : 'acceptedHeartbeats');
    increment(event.queue === 'pending' ? 'pendingReceipts' : 'queuedReceipts');
    if (event.duplicate) increment('duplicateReceipts');
  };
  const app = buildHealthUploadServer({ enabled: config.enabled,...dependencies,shutdownSignal: controller.signal,observe,ratePolicy: config.ratePolicy,trustedProxyCidrs: config.trustedProxyCidrs });
  const recovery = dependencies ? new HealthOutboxRecovery(config,dependencies.buffer,observeRecovery) : null;
  let address: string;
  try { address = await app.listen({ host: config.host,port: config.port }); }
  catch { controller.abort(); await app.close(); throw new Error('Health host startup failed'); }
  recovery?.start();
  const diagnostics = (reason: HealthReceiptDiagnostics['reason']) => {
    try { observeDiagnostics?.({ event: 'health_receipt_events',semantics: 'cumulative-receipt-events',reason,lifecycle,
      acceptance: config.enabled ? 'configured' : 'inactive',processing: 'not-configured',...counts }); } catch { /* Telemetry cannot change durable acceptance. */ }
  };
  const diagnosticsTimer = observeDiagnostics ? setInterval(() => diagnostics('interval'),config.diagnosticsIntervalMs) : undefined;
  diagnosticsTimer?.unref();
  return {
    address,
    status: (): HealthHostStatus => ({ lifecycle,acceptance: config.enabled ? 'configured' : 'inactive',processing: 'not-configured',...counts,recovery: recovery?.status() ?? null }),
    stop(): Promise<'drained' | 'deadline'> {
      if (stopping) return stopping;
      lifecycle = 'stopping'; if (diagnosticsTimer) clearInterval(diagnosticsTimer); controller.abort();
      stopping = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = Promise.all([recovery?.stop(),app.close()]);
        const deadline = new Promise<'deadline'>(resolve => { timer = setTimeout(() => resolve('deadline'),config.shutdownMs); });
        const result = await Promise.race([cleanup.then(() => 'drained' as const).catch(() => 'deadline' as const),deadline]);
        if (timer) clearTimeout(timer);
        if (result === 'deadline') app.server.closeAllConnections();
        lifecycle = 'stopped'; diagnostics('shutdown'); return result;
      })();
      return stopping;
    },
  };
}

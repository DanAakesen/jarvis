import { readHealthHostConfig } from './host-config.js';
import { createManagedHealthDependencies,startHealthUploadHost } from './host.js';
import { HealthOutboxRecovery } from './recovery.js';

async function main() {
  const config = readHealthHostConfig(process.env);
  if (config.mode === 'recover-once') {
    const worker = new HealthOutboxRecovery(config,createManagedHealthDependencies(config).buffer);
    const cancel = () => { void worker.stop(); };
    process.once('SIGTERM',cancel); process.once('SIGINT',cancel);
    try {
      const status = await worker.once(); console.info(JSON.stringify({ event: 'health_recovery',...status }));
      if (['error','partial','timeout','canceled'].includes(status.outcome)) process.exitCode = 1;
      else if (status.outcome === 'busy') process.exitCode = 2;
    } finally { await worker.stop(); process.removeListener('SIGTERM',cancel); process.removeListener('SIGINT',cancel); }
    return;
  }
  const host = await startHealthUploadHost(config,undefined,status => console.info(JSON.stringify({ event: 'health_recovery',...status })),
    status => console.info(JSON.stringify(status)));
  console.info(JSON.stringify({ event: 'health_host_started',acceptance: host.status().acceptance,processing: 'not-configured' }));
  let closing = false;
  const stop = () => {
    if (closing) return; closing = true;
    void host.stop().then(result => {
      console.info(JSON.stringify({ event: 'health_host_stopped',result }));
      process.exitCode = result === 'drained' ? 0 : 1;
      process.removeListener('SIGTERM',stop); process.removeListener('SIGINT',stop);
    }).catch(() => { console.error('health_host_shutdown_failed'); process.exitCode = 1; });
  };
  process.once('SIGTERM',stop); process.once('SIGINT',stop);
}
void main().catch(() => { console.error('health_host_configuration_or_startup_failed'); process.exitCode = 1; });

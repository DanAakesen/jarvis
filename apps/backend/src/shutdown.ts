import type { buildApp } from './app.js';
import { safeErrorFields, type TelemetrySink } from './logging.js';

export async function shutdown(app: ReturnType<typeof buildApp>, telemetry?: TelemetrySink, timeoutMs = 5_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const state: { phase: 'server' | 'telemetry'; timedOut: boolean } = { phase: 'server', timedOut: false };
  try {
    try {
      await Promise.race([
        (async () => {
          app.log.info('server.stopping');
          await app.close();
          app.log.info('server.stopped');
          if (telemetry) {
            state.phase = 'telemetry';
            try {
              try { await telemetry.flush(); }
              finally { await telemetry.shutdown(); }
            } catch (error) {
              app.log.warn(safeErrorFields(error), 'telemetry.close_failed');
            }
          }
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            state.timedOut = true;
            reject(new Error('Backend shutdown timed out'));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (state.phase !== 'telemetry') throw error;
      app.log.warn(state.timedOut ? { kind: 'timeout' } : safeErrorFields(error), 'telemetry.close_failed');
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

import type { buildApp } from './app.js';
import type { TelemetrySink } from './logging.js';

export async function shutdown(app: ReturnType<typeof buildApp>, telemetry?: TelemetrySink, timeoutMs = 5_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      (async () => {
        app.log.info('server.stopping');
        await app.close();
        app.log.info('server.stopped');
        if (telemetry) {
          // Attempt disposal even if flushing fails.
          try { await telemetry.flush(); }
          finally { await telemetry.shutdown(); }
        }
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Backend shutdown timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

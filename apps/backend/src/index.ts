import { buildApp } from './app.js';
import { ConfigurationError, loadConfig } from './config.js';
import { createLogger, createTelemetry } from './logging.js';
import { shutdown } from './shutdown.js';
import { loadDatabaseConfig } from './database/config.js';
import { createDatabase, registerDatabase } from './database/lifecycle.js';
import { createToolCallStore } from './database/tool-call-store.js';

try {
  const config = loadConfig();
  const databaseConfig = loadDatabaseConfig();
  const telemetry = await createTelemetry(config.applicationInsightsConnectionString);
  const logger = createLogger(config, telemetry);
  const database = databaseConfig ? createDatabase(databaseConfig) : undefined;
  const app = buildApp(config, logger, {
    ...(database ? { toolCallStore: createToolCallStore(database.pool) } : {}),
  });
  if (database) registerDatabase(app, database);
  else logger.info('database.not_configured');
  if (!telemetry) logger.info('telemetry.stdout_only');

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await shutdown(app, telemetry); }
    catch { logger.error('telemetry.close_failed'); process.exitCode = 1; }
    // Enforce the shutdown deadline even if an SDK/network handle remains open.
    process.exit(process.exitCode ?? 0);
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  try {
    if (database) {
      await database.initialize();
      logger.info('database.ready');
    }
    if (!stopping) {
      await app.listen({ port: config.port, host: '0.0.0.0' });
      logger.info({ port: config.port }, 'server.listening');
    }
  } catch {
    logger.error('server.failed');
    process.exitCode = 1;
    await stop();
  }
} catch (error) {
  // Startup exceptions may contain configuration values or provider URLs.
  process.stderr.write(JSON.stringify({
    level: 60, service: 'jarvis-backend', msg: 'server.configuration_failed',
    ...(error instanceof ConfigurationError ? { reason: error.message } : {}),
  }) + '\n');
  process.exit(1);
}

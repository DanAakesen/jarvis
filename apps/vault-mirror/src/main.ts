import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readMirrorConfig } from './runner/config.js';
import { runProduction } from './runner/production.js';

async function main(): Promise<void> {
  const runId = randomUUID();
  try {
    const exitCode = await runProduction(readMirrorConfig(process.env));
    process.exitCode = exitCode;
  } catch {
    console.log(JSON.stringify({
      runId,
      outcome: 'failed',
      reason: 'unexpected',
      durationMs: 0,
      approved: 0,
      pushed: 0,
      writtenBack: 0,
      deleted: 0,
      conflicts: 0,
      skipped: 0,
      credentialMatches: 0,
      pendingWriteBack: 0,
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();

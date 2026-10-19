import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readMirrorConfig } from './runner/config.js';
import { runProduction } from './runner/production.js';
import type { MirrorConfig } from './runner/config.js';

export async function main(
  env: NodeJS.ProcessEnv = process.env,
  run: (config: MirrorConfig) => Promise<number> = runProduction,
  output: (line: string) => void = console.log,
): Promise<number> {
  const runId = randomUUID();
  try {
    return await run(readMirrorConfig(env));
  } catch {
    output(JSON.stringify({
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
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}

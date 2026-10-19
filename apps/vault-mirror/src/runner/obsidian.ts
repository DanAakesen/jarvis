import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export type ObReason = 'auth' | 'pull-failed' | 'upload-failed' | 'timeout';

export class ObCommandError extends Error {
  constructor(readonly reason: ObReason) {
    super('Obsidian Headless command failed');
  }
}

export interface ObOptions {
  readonly executable?: string;
  readonly configHome: string;
  readonly timeoutMs: number;
  readonly token: string;
  readonly password?: string;
  readonly workingCopy: string;
  readonly signal: AbortSignal;
}

const outputLimit = 32 * 1024;
const graceMs = 1_000;

function classify(text: string, timeout: boolean, operation: 'setup' | 'pull' | 'upload'): ObReason {
  if (timeout) return 'timeout';
  if (/\b(?:401|403)\b|auth(?:entication|orization)?\s+(?:failed|expired|invalid)|token\s+(?:expired|invalid)/iu.test(text)) {
    return 'auth';
  }
  return operation === 'setup' || operation === 'pull' ? 'pull-failed' : 'upload-failed';
}

export async function runOb(
  args: readonly string[],
  options: ObOptions,
  operation: 'setup' | 'pull' | 'upload',
): Promise<void> {
  if (options.signal.aborted) throw options.signal.reason;
  const executable = options.executable ?? 'ob';
  const timeoutMs = Math.min(options.timeoutMs, 60_000);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(executable, [...args], {
      cwd: options.workingCopy,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? '/home/node',
        XDG_CONFIG_HOME: resolve(options.configHome, 'headless'),
        OBSIDIAN_AUTH_TOKEN: options.token,
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new ObCommandError(classify('', false, operation));
  }
  return new Promise<void>((resolvePromise, reject) => {
    const output: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const capture = (chunk: Buffer): void => {
      if (size >= outputLimit) return;
      const kept = chunk.subarray(0, outputLimit - size);
      size += kept.byteLength;
      output.push(kept);
    };
    const terminate = (): void => {
      if (settled || !child.pid) return;
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch { child.kill('SIGTERM'); }
      killTimer ??= setTimeout(() => {
        if (child.pid && !settled) {
          try { process.kill(-child.pid, 'SIGKILL'); }
          catch { child.kill('SIGKILL'); }
        }
      }, graceMs);
      killTimer.unref();
    };
    const abort = (): void => {
      timedOut = true;
      terminate();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref();
    const cleanup = (): void => {
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal.removeEventListener('abort', abort);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    options.signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => {
      if (settled) return;
      cleanup();
      reject(new ObCommandError(classify('', timedOut, operation)));
    });
    child.once('close', code => {
      if (settled) return;
      cleanup();
      if (code === 0 && !timedOut) resolvePromise();
      else reject(new ObCommandError(classify(Buffer.concat(output).toString('utf8'), timedOut, operation)));
    });
  });
}

export function createObsidianClient(options: ObOptions) {
  const path = resolve(options.workingCopy);
  const common = ['--path', path, '--config-dir', '.obsidian'];
  return {
    async setup(vault: string, beforeWrite: () => Promise<void>): Promise<void> {
      const args = ['sync-setup', '--vault', vault, '--device-name', 'jarvis-vault-mirror',
        ...common, '--json'];
      if (options.password !== undefined) args.push('--password', options.password);
      await beforeWrite();
      await runOb(args, options, 'setup');
    },
    async sync(
      mode: 'pull-only' | 'bidirectional',
      operation: 'pull' | 'upload',
      beforeWrite: () => Promise<void>,
    ): Promise<void> {
      await beforeWrite();
      await runOb(['sync-config', '--mode', mode, ...common, '--json'], options, operation);
      await beforeWrite();
      await runOb(['sync', ...common.slice(0, 2)], options, operation);
    },
    async setMode(mode: 'pull-only' | 'bidirectional', beforeWrite: () => Promise<void>): Promise<void> {
      await beforeWrite();
      await runOb(['sync-config', '--mode', mode, ...common, '--json'], options, 'upload');
    },
  };
}

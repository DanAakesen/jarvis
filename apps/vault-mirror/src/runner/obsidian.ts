import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type ObReason = 'auth' | 'pull-failed' | 'upload-failed' | 'timeout';

export class ObCommandError extends Error {
  constructor(readonly reason: ObReason) {
    super('Obsidian Headless command failed');
  }
}

export interface ObOptions {
  readonly executable?: string;
  readonly configHome: string;
  readonly timeoutMs: number | (() => number);
  readonly token: string;
  readonly password?: string;
  readonly workingCopy: string;
  readonly signal: AbortSignal;
  readonly excludedFolders?: readonly string[];
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
  const timeoutMs = typeof options.timeoutMs === 'function' ? options.timeoutMs() : options.timeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ObCommandError('timeout');
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
  const configure = async (
    mode: 'pull-only' | 'bidirectional',
    operation: 'setup' | 'pull' | 'upload',
    beforeWrite: () => Promise<void>,
  ): Promise<void> => {
    await beforeWrite();
    await runOb([
      'sync-config', '--mode', mode, '--excluded-folders',
      options.excludedFolders?.join(',') ?? '', '--configs', '', ...common, '--json',
    ], options, operation);
    const syncRoot = resolve(options.configHome, 'headless', 'obsidian-headless', 'sync');
    try {
      const rootInfo = await lstat(syncRoot);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new TypeError();
      const configs = await Promise.all((await readdir(syncRoot, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
        .map(async entry => {
          const configPath = resolve(syncRoot, entry.name, 'config.json');
          const info = await lstat(configPath);
          if (!info.isFile() || info.isSymbolicLink()) return undefined;
          const config = JSON.parse(await readFile(configPath, 'utf8')) as { vaultPath?: unknown };
          return config.vaultPath === path ? configPath : undefined;
        }));
      const matches = configs.filter((configPath): configPath is string => configPath !== undefined);
      if (matches.length !== 1) throw new TypeError();
      const configPath = matches[0]!;
      const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
      if (config.vaultPath !== path) throw new TypeError();
      config.allowTypes = [];
      const temporary = resolve(dirname(configPath), `.config-${randomUUID()}`);
      try {
        await writeFile(temporary, JSON.stringify(config), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, configPath);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    } catch {
      throw new ObCommandError(operation === 'upload' ? 'upload-failed' : 'pull-failed');
    }
  };
  return {
    async setup(vault: string, beforeWrite: () => Promise<void>): Promise<void> {
      const args = ['sync-setup', '--vault', vault, '--device-name', 'jarvis-vault-mirror',
        ...common, '--json'];
      if (options.password !== undefined) args.push('--password', options.password);
      await beforeWrite();
      await runOb(args, options, 'setup');
      await configure('pull-only', 'setup', beforeWrite);
    },
    async sync(
      mode: 'pull-only' | 'bidirectional',
      operation: 'pull' | 'upload',
      beforeWrite: () => Promise<void>,
    ): Promise<void> {
      await configure(mode, operation, beforeWrite);
      await beforeWrite();
      await runOb(['sync', ...common.slice(0, 2)], options, operation);
    },
    async setMode(mode: 'pull-only' | 'bidirectional', beforeWrite: () => Promise<void>): Promise<void> {
      await configure(mode, 'upload', beforeWrite);
    },
  };
}

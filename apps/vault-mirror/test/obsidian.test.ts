import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createObsidianClient } from '../src/runner/obsidian.js';

describe('Obsidian CLI configuration', () => {
  it('uses argv ordering and stores no synced attachments or config categories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ob-configuration-test-'));
    const workingCopy = resolve(root, 'working-copy');
    const configHome = resolve(root, 'state');
    const executable = resolve(root, 'fake-ob');
    await mkdir(workingCopy);
    const source = `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const args = process.argv.slice(2);
const callsPath = join(process.cwd(), 'calls.json');
const calls = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, 'utf8')) : [];
calls.push(args);
writeFileSync(callsPath, JSON.stringify(calls));
const value = name => args[args.indexOf(name) + 1];
const configPath = join(process.env.XDG_CONFIG_HOME, 'obsidian-headless', 'sync',
  args[0] === 'sync-setup' ? value('--vault') : 'synthetic-vault', 'config.json');
if (args[0] === 'sync-setup') {
  mkdirSync(resolve(configPath, '..'), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ vaultId: 'synthetic-vault', vaultPath: value('--path') }));
} else if (args[0] === 'sync-config') {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.syncMode = value('--mode') === 'bidirectional' ? undefined : value('--mode');
  if (value('--mode') === 'bidirectional') delete config.syncMode;
  config.ignoreFolders = value('--excluded-folders') ? value('--excluded-folders').split(',') : undefined;
  if (!config.ignoreFolders) delete config.ignoreFolders;
  if (value('--configs') === '') delete config.allowSpecialFiles;
  writeFileSync(configPath, JSON.stringify(config));
}
`;
    try {
      await writeFile(executable, source, { mode: 0o700 });
      await chmod(executable, 0o700);
      const client = createObsidianClient({
        executable,
        configHome,
        workingCopy,
        timeoutMs: 5_000,
        token: 'synthetic-token',
        signal: new AbortController().signal,
        excludedFolders: ['Notes/private'],
      });
      const beforeWrite = async () => {};
      await client.setup('synthetic-vault', beforeWrite);
      await client.sync('pull-only', 'pull', beforeWrite);
      await client.sync('bidirectional', 'upload', beforeWrite);
      await client.setMode('pull-only', beforeWrite);

      const calls = JSON.parse(await readFile(join(workingCopy, 'calls.json'), 'utf8')) as string[][];
      const config = JSON.parse(await readFile(
        join(configHome, 'headless', 'obsidian-headless', 'sync', 'synthetic-vault', 'config.json'),
        'utf8',
      )) as Record<string, unknown>;
      expect(calls[0]).toEqual([
        'sync-setup', '--vault', 'synthetic-vault', '--device-name', 'jarvis-vault-mirror',
        '--path', workingCopy, '--config-dir', '.obsidian', '--json',
      ]);
      expect(calls.filter(args => args[0] === 'sync-config').map(args => [
        args[0], args[args.indexOf('--mode') + 1], args[args.indexOf('--excluded-folders') + 1],
        args[args.indexOf('--configs') + 1],
      ])).toEqual([
        ['sync-config', 'pull-only', 'Notes/private', ''],
        ['sync-config', 'pull-only', 'Notes/private', ''],
        ['sync-config', 'bidirectional', 'Notes/private', ''],
        ['sync-config', 'pull-only', 'Notes/private', ''],
      ]);
      expect(calls.filter(args => args[0] === 'sync')).toEqual([
        ['sync', '--path', workingCopy],
        ['sync', '--path', workingCopy],
      ]);
      expect(config.allowTypes).toEqual([]);
      expect(config.allowSpecialFiles).toBeUndefined();
      expect(config.ignoreFolders).toEqual(['Notes/private']);
      expect(config.syncMode).toBe('pull-only');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

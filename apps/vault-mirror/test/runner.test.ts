import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { contentHash, contentSize, normalizeContent } from '../src/engine/normalize.js';
import { validatePolicy } from '../src/engine/policy.js';
import type { ValidatedPolicy } from '../src/engine/policy.js';
import { GitHubMirrorError, createGitHubMirrorClient } from '../src/runner/github.js';
import { mergeThreeWay } from '../src/runner/merge.js';
import { ObCommandError, runOb } from '../src/runner/obsidian.js';
import { runMirror } from '../src/runner/run.js';
import { checksum, decodeState, emptyState, encodeState } from '../src/runner/state.js';
import type { MirrorStorage, MirrorSecrets, RemoteFile, RunDependencies, StateLease } from '../src/runner/types.js';
import { VAULT_BRANCH, VAULT_REPOSITORY } from '../src/runner/types.js';
import { snapshotWorkspace, writeWorkspaceFile } from '../src/runner/workspace.js';
import { policyData } from './fixtures.js';

const validated = validatePolicy(policyData);
if (!validated.success) throw new Error('fixture-policy-invalid');
const policy: ValidatedPolicy = validated.policy;
const fakeSecrets: MirrorSecrets = {
  obsidianToken: 'synthetic-obsidian-token',
  vaultName: 'Synthetic Vault',
  policy,
  githubPrivateKey: 'synthetic-github-key',
};

class FakeStorage implements MirrorStorage {
  archive: Uint8Array | null = null;
  status: import('@jarvis/contracts').VaultMirrorStatus | undefined;
  busy = false;
  held = false;
  lost = false;
  renewCount = 0;
  loseOnRenew = -1;
  failStateUpload = false;
  corruptChecksum = false;

  async acquireLease(): Promise<{ busy: true } | { busy: false; lease: StateLease }> {
    if (this.busy || this.held) return { busy: true };
    this.held = true;
    const archive = this.archive;
    const etag = archive === null ? 'etag-initial' : `etag-${archive.byteLength}`;
    const expected = archive === null ? null : this.corruptChecksum ? '0'.repeat(64) : checksum(archive);
    return {
      busy: false,
      lease: {
        archive,
        etag,
        checksum: expected,
        renew: async () => {
          this.renewCount++;
          if (this.lost || this.renewCount === this.loseOnRenew) throw new Error('lease lost');
        },
        upload: async (bytes, digest) => {
          if (!this.held || this.lost || this.failStateUpload) throw new Error('state upload failed');
          if (checksum(bytes) !== digest) throw new Error('checksum mismatch');
          this.archive = bytes;
        },
        release: async () => { this.held = false; },
      },
    };
  }

  async writeStatus(status: import('@jarvis/contracts').VaultMirrorStatus): Promise<void> {
    this.status = status;
  }
}

class FakeGitHub {
  readonly files = new Map<string, string>();
  snapshots = 0;
  commits = 0;
  failNextRefUpdate = false;
  private head = 1;

  async verifyRepository(): Promise<void> {}

  async snapshot(): Promise<{ head: string; tree: string; files: Map<string, RemoteFile> }> {
    this.snapshots++;
    const files = new Map<string, RemoteFile>();
    for (const [path, text] of this.files) {
      const normalized = normalizeContent(text);
      files.set(path, {
        sha: this.sha(this.head + files.size + 1),
        hash: contentHash(normalized),
        size: contentSize(text),
        mode: '100644',
        text,
      });
    }
    return { head: this.sha(this.head), tree: this.sha(this.head + 100), files };
  }

  async readFile(file: RemoteFile): Promise<string> {
    return file.text ?? '';
  }

  async commit(
    _snapshot: { head: string; tree: string; files: ReadonlyMap<string, RemoteFile> },
    actions: readonly import('../src/engine/types.js').Action[],
    _signal: AbortSignal,
    beforeWrite: () => Promise<void>,
  ): Promise<void> {
    await beforeWrite();
    this.commits++;
    if (this.failNextRefUpdate) {
      this.failNextRefUpdate = false;
      this.files.set('Notes/branch-moved.md', 'new branch content');
      this.head++;
      throw new GitHubMirrorError('push-rejected');
    }
    for (const action of actions) {
      if (action.kind === 'deleteOnG') this.files.delete(action.path);
      else if (action.kind === 'createOnG' || action.kind === 'updateOnG') {
        this.files.set(action.path, action.text);
      }
    }
    this.head++;
  }

  private sha(value: number): string {
    return value.toString(16).padStart(40, '0');
  }
}

class FakeObsidian {
  readonly modes: string[] = [];
  setupCalls = 0;
  uploadCalls = 0;
  failNextUpload = false;
  readonly remote = new Map<string, string>();
  private knownRemotePaths = new Set<string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, text] of Object.entries(initial)) this.remote.set(path, text);
    this.knownRemotePaths = new Set(this.remote.keys());
  }

  client(workingCopy: string) {
    return {
      setup: async (_vault: string, beforeWrite: () => Promise<void>) => {
        await beforeWrite();
        this.setupCalls++;
      },
      setMode: async (mode: 'pull-only' | 'bidirectional', beforeWrite: () => Promise<void>) => {
        await beforeWrite();
        this.modes.push(mode);
      },
      sync: async (
        mode: 'pull-only' | 'bidirectional',
        operation: 'pull' | 'upload',
        beforeWrite: () => Promise<void>,
      ) => {
        await beforeWrite();
        this.modes.push(mode);
        if (operation === 'pull') {
          for (const oldPath of this.knownRemotePaths) {
            if (!this.remote.has(oldPath)) {
              const target = resolve(workingCopy, ...oldPath.split('/'));
              await rm(target, { force: true });
            }
          }
          for (const [path, text] of this.remote) await writeWorkspaceFile(workingCopy, path, text);
          this.knownRemotePaths = new Set(this.remote.keys());
          return;
        }
        this.uploadCalls++;
        if (this.failNextUpload) {
          this.failNextUpload = false;
          throw new ObCommandError('upload-failed');
        }
        const snapshot = await snapshotWorkspace(workingCopy);
        this.remote.clear();
        for (const [path, file] of snapshot.files) {
          if (file.text !== undefined) this.remote.set(path, file.text);
        }
        this.knownRemotePaths = new Set(this.remote.keys());
      },
    };
  }
}

function dependencies(
  github: FakeGitHub,
  obsidian: FakeObsidian,
  storage = new FakeStorage(),
  extra: Partial<RunDependencies> = {},
): RunDependencies {
  return {
    readSecrets: async () => fakeSecrets,
    createGitHub: () => github,
    storage,
    async createWorkspace() {
      const root = await mkdtemp(join(tmpdir(), 'mirror-run-test-'));
      const workingCopy = resolve(root, 'working-copy');
      const configHome = resolve(root, 'config-home');
      await Promise.all([
        mkdir(workingCopy, { recursive: true, mode: 0o700 }),
        mkdir(configHome, { recursive: true, mode: 0o700 }),
      ]);
      return { workingCopy, configHome, cleanup: () => rm(root, { recursive: true, force: true }) };
    },
    createObsidian: options => obsidian.client(options.workingCopy),
    ...extra,
  };
}

function options(deps: RunDependencies, writeBack: 'on' | 'dry-run' = 'on') {
  return {
    config: { githubAppId: '123456', writeBack, maxChanged: 25, maxDeletes: 3 },
    dependencies: deps,
  } as const;
}

async function initialized(
  github: FakeGitHub,
  obsidian: FakeObsidian,
  storage: FakeStorage,
  files: Record<string, string>,
): Promise<RunDependencies> {
  for (const [path, text] of Object.entries(files)) {
    github.files.set(path, text);
    obsidian.remote.set(path, text);
  }
  const deps = dependencies(github, obsidian, storage);
  const result = await runMirror(options(deps));
  expect(result.exitCode).toBe(0);
  expect(storage.archive).not.toBeNull();
  return deps;
}

describe('vault mirror runner', () => {
  it('reconciles changes in both directions through one GitHub commit and one Obsidian upload', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    const files = {
      'Notes/from-obsidian.md': 'old O',
      'Notes/from-github.md': 'old G',
    };
    const deps = await initialized(github, obsidian, storage, files);
    obsidian.remote.set('Notes/from-obsidian.md', 'new O');
    github.files.set('Notes/from-github.md', 'new G');

    const result = await runMirror(options(deps));

    expect(result.exitCode).toBe(0);
    expect(github.files.get('Notes/from-obsidian.md')).toBe('new O');
    expect(obsidian.remote.get('Notes/from-github.md')).toBe('new G');
    expect(github.commits).toBe(1);
    expect(obsidian.uploadCalls).toBe(1);
    expect(result.status.pushed).toBe(1);
    expect(result.status.writtenBack).toBe(1);
    expect(result.status.pendingWriteBack).toBe(0);
  });

  it('keeps dry-run pull-only and reports proposed write-back as pending', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    const deps = await initialized(github, obsidian, storage, { 'Notes/plan.md': 'old' });
    github.files.set('Notes/plan.md', 'new');

    const result = await runMirror(options(deps, 'dry-run'));

    expect(result.exitCode).toBe(0);
    expect(obsidian.remote.get('Notes/plan.md')).toBe('old');
    expect(obsidian.uploadCalls).toBe(0);
    expect(obsidian.modes.every(mode => mode === 'pull-only')).toBe(true);
    expect(result.status.writtenBack).toBe(0);
    expect(result.status.pendingWriteBack).toBe(1);
  });

  it('reports first-run write-back suppressed until a common base exists', async () => {
    const github = new FakeGitHub();
    github.files.set('Notes/first-run.md', 'from GitHub');
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    const deps = dependencies(github, obsidian, storage);

    const first = await runMirror(options(deps));
    expect(first.exitCode).toBe(0);
    expect(first.status.pendingWriteBack).toBe(1);
    expect(obsidian.uploadCalls).toBe(0);
    expect(obsidian.remote.has('Notes/first-run.md')).toBe(false);

    const second = await runMirror(options(deps));
    expect(second.exitCode).toBe(0);
    expect(second.status.pendingWriteBack).toBe(0);
    expect(obsidian.remote.get('Notes/first-run.md')).toBe('from GitHub');
  });

  it('persists failed write-back and retries it before the next plan', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    const deps = await initialized(github, obsidian, storage, { 'Notes/retry.md': 'old' });
    github.files.set('Notes/retry.md', 'new');
    obsidian.failNextUpload = true;

    const failed = await runMirror(options(deps));

    expect(failed.exitCode).toBe(1);
    expect(failed.status.reason).toBe('upload-failed');
    expect(failed.status.pendingWriteBack).toBe(1);
    expect(obsidian.remote.get('Notes/retry.md')).toBe('old');

    const next = await runMirror(options(deps));
    expect(next.exitCode).toBe(0);
    expect(obsidian.remote.get('Notes/retry.md')).toBe('new');
    expect(next.status.pendingWriteBack).toBe(0);
    expect(next.status.writtenBack).toBe(0);
  });

  it('replans safely if a crash follows the GitHub commit but precedes state persistence', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    const deps = await initialized(github, obsidian, storage, { 'Notes/crash.md': 'base' });
    obsidian.remote.set('Notes/crash.md', 'committed before crash');
    storage.failStateUpload = true;

    const interrupted = await runMirror(options(deps));
    expect(interrupted.exitCode).toBe(1);
    expect(interrupted.status.reason).toBe('upload-failed');
    expect(github.files.get('Notes/crash.md')).toBe('committed before crash');
    const committed = github.commits;

    storage.failStateUpload = false;
    const recovered = await runMirror(options(deps));
    expect(recovered.exitCode).toBe(0);
    expect(github.commits).toBe(committed);
    expect(recovered.status.pendingWriteBack).toBe(0);
  });

  it('deletes within the configured cap and trips the guard above it', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    const files = Object.fromEntries(Array.from({ length: 40 }, (_, index) =>
      [`Notes/item-${index}.md`, `text-${index}`]));
    const deps = await initialized(github, obsidian, storage, files);
    for (let index = 0; index < 3; index++) obsidian.remote.delete(`Notes/item-${index}.md`);

    const allowed = await runMirror(options(deps));
    expect(allowed.exitCode).toBe(0);
    expect(allowed.status.deleted).toBe(3);
    expect([...github.files.keys()].filter(path => path.startsWith('Notes/item-')).length).toBe(37);

    for (let index = 3; index < 7; index++) obsidian.remote.delete(`Notes/item-${index}.md`);
    const commits = github.commits;
    const guarded = await runMirror(options(deps));
    expect(guarded.exitCode).toBe(1);
    expect(guarded.status.reason).toBe('guard-tripped');
    expect(github.commits).toBe(commits);
  });

  it('applies a clean three-way merge and leaves a conflicting edit untouched', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    const deps = await initialized(github, obsidian, storage, {
      'Notes/merge.md': 'a\nb\nc\n',
      'Notes/conflict.md': 'one\ntwo\nthree\n',
    });
    obsidian.remote.set('Notes/merge.md', 'A\nb\nc\n');
    github.files.set('Notes/merge.md', 'a\nb\nC\n');
    obsidian.remote.set('Notes/conflict.md', 'one\nours\nthree\n');
    github.files.set('Notes/conflict.md', 'one\ntheirs\nthree\n');
    const logs: Readonly<Record<string, string | number>>[] = [];
    const withLogs = {
      ...deps,
      log: (entry: Readonly<Record<string, string | number>>) => { logs.push(entry); },
    };

    const result = await runMirror(options(withLogs));

    expect(result.exitCode).toBe(1);
    expect(result.status.reason).toBe('conflict');
    expect(result.status.conflictPaths).toEqual(['Notes/conflict.md']);
    expect(github.files.get('Notes/merge.md')).toBe('A\nb\nC\n');
    expect(obsidian.remote.get('Notes/merge.md')).toBe('A\nb\nC\n');
    expect(obsidian.remote.get('Notes/conflict.md')).toBe('one\nours\nthree\n');
    expect(JSON.stringify(logs)).not.toContain('Notes/');
    expect(JSON.stringify(logs)).not.toContain('synthetic-obsidian-token');
    expect(JSON.stringify(logs)).not.toContain('one\nours');
  });

  it('restores a write-back if the working-copy difference exceeds the plan', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    await initialized(github, obsidian, storage, { 'Notes/guard.md': 'old' });
    github.files.set('Notes/guard.md', 'new');
    const guardedDependencies = dependencies(github, obsidian, storage, {
      afterWriteBack: async workingCopy => writeFile(join(workingCopy, 'unexpected.md'), 'unexpected'),
    });

    const result = await runMirror(options(guardedDependencies));

    expect(result.exitCode).toBe(1);
    expect(result.status.reason).toBe('guard-tripped');
    expect(obsidian.remote.get('Notes/guard.md')).toBe('old');
  });

  it('re-reads and replans once if the GitHub ref moved', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    const deps = await initialized(github, obsidian, storage, { 'Notes/source.md': 'base' });
    obsidian.remote.set('Notes/source.md', 'local edit');
    github.failNextRefUpdate = true;

    const result = await runMirror(options(deps));

    expect(result.exitCode).toBe(0);
    expect(github.snapshots).toBeGreaterThanOrEqual(3);
    expect(github.files.get('Notes/source.md')).toBe('local edit');
    expect(obsidian.remote.get('Notes/branch-moved.md')).toBe('new branch content');
  });

  it('rejects a lost lease before a GitHub or Obsidian write', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();
    const storage = new FakeStorage();
    const deps = await initialized(github, obsidian, storage, { 'Notes/lease.md': 'old' });
    obsidian.remote.set('Notes/lease.md', 'new');
    const prior = github.files.get('Notes/lease.md');
    storage.loseOnRenew = storage.renewCount + 3;

    const result = await runMirror(options(deps));

    expect(result.exitCode).toBe(1);
    expect(github.files.get('Notes/lease.md')).toBe(prior);
    expect(obsidian.remote.get('Notes/lease.md')).toBe('new');
    expect(obsidian.uploadCalls).toBe(0);
  });

  it('stops on a corrupt state archive before syncing or pushing', async () => {
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian({ 'Notes/state.md': 'old' });
    const storage = new FakeStorage();
    storage.archive = new Uint8Array([1, 2, 3]);
    storage.corruptChecksum = true;
    const deps = dependencies(github, obsidian, storage);

    const result = await runMirror(options(deps));

    expect(result.exitCode).toBe(1);
    expect(result.status.reason).toBe('state-corrupt');
    expect(github.commits).toBe(0);
    expect(obsidian.uploadCalls).toBe(0);
  });

  it('returns skipped-busy without acquiring or writing state', async () => {
    const storage = new FakeStorage();
    storage.busy = true;
    const github = new FakeGitHub();
    const obsidian = new FakeObsidian();

    const result = await runMirror(options(dependencies(github, obsidian, storage)));

    expect(result.exitCode).toBe(0);
    expect(result.status.outcome).toBe('skipped-busy');
    expect(storage.archive).toBeNull();
    expect(obsidian.setupCalls).toBe(0);
  });
});

describe('Obsidian wrapper and merge', () => {
  it('passes the token only through the child environment and classifies without output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ob-wrapper-test-'));
    const workingCopy = resolve(root, 'working-copy');
    await mkdir(workingCopy);
    const controller = new AbortController();
    const resultPath = resolve(workingCopy, 'result.json');
    try {
      const args = ['-e', 'require("node:fs").writeFileSync("result.json", JSON.stringify({ token: process.env.OBSIDIAN_AUTH_TOKEN, args: process.argv }));'];
      await runOb(args, {
        executable: process.execPath,
        configHome: root,
        workingCopy,
        timeoutMs: 2_000,
        token: fakeSecrets.obsidianToken,
        signal: controller.signal,
      }, 'pull');
      const child = JSON.parse(await readFile(resultPath, 'utf8')) as { token: string; args: string[] };
      expect(child.token).toBe(fakeSecrets.obsidianToken);
      expect(child.args.join(' ')).not.toContain(fakeSecrets.obsidianToken);
      expect(args.join(' ')).not.toContain(fakeSecrets.obsidianToken);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('merges non-overlapping line edits and refuses overlapping changes', () => {
    expect(mergeThreeWay('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n'))
      .toEqual({ clean: true, text: 'A\nb\nC\n' });
    expect(mergeThreeWay('a\nb\n', 'a\nours\n', 'a\ntheirs\n')).toEqual({ clean: false });
  });

  it('retries an expired GitHub App installation token once', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    let tokenNumber = 0;
    let repositoryRequests = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/installation')) return Response.json({ id: 7 });
      if (url.endsWith('/access_tokens')) {
        tokenNumber++;
        return Response.json({
          token: `synthetic-token-${tokenNumber}`,
          permissions: { contents: 'write' },
          repositories: [{ full_name: VAULT_REPOSITORY }],
        });
      }
      repositoryRequests++;
      if (repositoryRequests === 1) return new Response(null, { status: 401 });
      expect(new Headers(init?.headers).get('authorization')).toBe(`${['Bear', 'er'].join('')} synthetic-token-2`);
      return Response.json({ private: true, default_branch: VAULT_BRANCH });
    };
    const client = createGitHubMirrorClient({
      appId: '123456',
      privateKey: pem,
      policy,
      fetcher,
    });

    await expect(client.verifyRepository(new AbortController().signal)).resolves.toBeUndefined();
    expect(tokenNumber).toBe(2);
    expect(repositoryRequests).toBe(2);
  });

  it('applies GitHub file mutations in one non-force Git Data ref update', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const mutations: { url: string; method: string; body?: Record<string, unknown> }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      if (url.endsWith('/installation')) return Response.json({ id: 7 });
      if (url.endsWith('/access_tokens')) {
        return Response.json({
          token: 'synthetic-content-token',
          permissions: { contents: 'write' },
          repositories: [{ full_name: VAULT_REPOSITORY }],
        });
      }
      if (url.endsWith('/git/ref/heads/master')) {
        return Response.json({ object: { sha: '1'.repeat(40), type: 'commit' } });
      }
      if (url.includes('/git/trees/') && method === 'GET') {
        return Response.json({ sha: '2'.repeat(40), truncated: false, tree: [] });
      }
      if (url.endsWith('/git/blobs') || url.endsWith('/git/trees') ||
        url.endsWith('/git/commits') || url.endsWith('/git/refs/heads/master')) {
        mutations.push({ url, method, ...(body === undefined ? {} : { body }) });
        const sha = url.endsWith('/git/blobs') ? '3'.repeat(40)
          : url.endsWith('/git/trees') ? '4'.repeat(40) : '5'.repeat(40);
        return Response.json({ sha });
      }
      if (url.endsWith(`/repos/${VAULT_REPOSITORY}`)) {
        return Response.json({ private: true, default_branch: VAULT_BRANCH });
      }
      throw new Error('unexpected fake GitHub request');
    };
    const client = createGitHubMirrorClient({ appId: '123456', privateKey: pem, policy, fetcher });
    const signal = new AbortController().signal;
    await client.verifyRepository(signal);
    const snapshot = await client.snapshot(signal);
    await client.commit(snapshot, [{
      kind: 'updateOnG',
      path: 'Notes/atomic.md',
      text: 'synthetic content',
      record: { hash: contentHash('synthetic content'), size: 17, mode: '100644' },
    }], signal, async () => {});

    expect(mutations.map(item => item.url.split('/').at(-1))).toEqual(['blobs', 'trees', 'commits', 'master']);
    expect(mutations.map(item => item.method)).toEqual(['POST', 'POST', 'POST', 'PATCH']);
    expect(mutations[1]?.body?.tree).toEqual([
      { path: 'Notes/atomic.md', mode: '100644', type: 'blob', sha: '3'.repeat(40) },
    ]);
    expect(mutations[2]?.body).toMatchObject({
      message: 'Update vault mirror', tree: '4'.repeat(40), parents: ['1'.repeat(40)],
    });
    expect(mutations[3]?.body).toEqual({ sha: '5'.repeat(40), force: false });
  });

  it('classifies expired Obsidian credentials without exposing CLI output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ob-expired-token-'));
    const workingCopy = resolve(root, 'working-copy');
    await mkdir(workingCopy);
    try {
      const error = await runOb(['-e', 'process.stderr.write("Authentication token expired at /private/Notes/example.md"); process.exitCode = 1;'], {
        executable: process.execPath,
        configHome: root,
        workingCopy,
        timeoutMs: 2_000,
        token: fakeSecrets.obsidianToken,
        signal: new AbortController().signal,
      }, 'pull').then(() => undefined, value => value);
      expect(error).toBeInstanceOf(ObCommandError);
      expect((error as ObCommandError).reason).toBe('auth');
      expect((error as Error).message).not.toContain('/private/Notes');
      expect((error as Error).message).not.toContain(fakeSecrets.obsidianToken);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('kills a timed-out CLI process and reports only the fixed timeout reason', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ob-timeout-'));
    const workingCopy = resolve(root, 'working-copy');
    await mkdir(workingCopy);
    try {
      await expect(runOb(['-e', 'setInterval(() => {}, 1000);'], {
        executable: process.execPath,
        configHome: root,
        workingCopy,
        timeoutMs: 20,
        token: fakeSecrets.obsidianToken,
        signal: new AbortController().signal,
      }, 'pull')).rejects.toMatchObject({ reason: 'timeout' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves executable mode when archiving and restoring the working copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-mode-'));
    const original = resolve(root, 'original');
    const originalConfig = resolve(root, 'original-config');
    const restored = resolve(root, 'restored');
    const restoredConfig = resolve(root, 'restored-config');
    const executable = resolve(original, 'Notes/executable.md');
    await mkdir(resolve(original, 'Notes'), { recursive: true });
    await mkdir(originalConfig, { recursive: true });
    await writeFile(executable, 'synthetic note', { mode: 0o700 });
    await chmod(executable, 0o700);
    try {
      const archive = await encodeState(emptyState(), original, originalConfig);
      await decodeState(archive, restored, restoredConfig);
      expect((await stat(resolve(restored, 'Notes/executable.md'))).mode & 0o111).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a malicious archive path before extraction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-archive-test-'));
    const workspace = resolve(root, 'working-copy');
    const configHome = resolve(root, 'config');
    const archive = zipSync({
      'mirror.json': strToU8(JSON.stringify(emptyState())),
      '../outside.txt': strToU8('no'),
    });
    try {
      await expect(decodeState(archive, workspace, configHome)).rejects.toThrow('Corrupt mirror archive');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

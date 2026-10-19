import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMirror } from '/app/apps/vault-mirror/dist/runner/run.js';
import { validatePolicy } from '/app/apps/vault-mirror/dist/engine/policy.js';

const policy = validatePolicy({
  allowedRoots: ['Notes'],
  allowedExtensions: ['.md'],
  excludedPrefixes: [],
  excludedNames: [],
  excludedNamePattern: '',
  secretPatterns: [],
  maxNoteBytes: 1024,
});
assert.equal(policy.success, true);

let archive = null;
let locked = false;
let status;
const storage = {
  async acquireLease() {
    if (locked) return { busy: true };
    locked = true;
    return {
      busy: false,
      lease: {
        archive,
        etag: 'synthetic-etag',
        checksum: null,
        async renew() {},
        async upload(bytes) { archive = bytes; },
        async release() { locked = false; },
      },
    };
  },
  async writeStatus(value) { status = value; },
};

const root = await mkdtemp(join(tmpdir(), 'vault-mirror-image-smoke-'));
const workingCopy = resolve(root, 'working-copy');
const configHome = resolve(root, 'config');
await Promise.all([
  mkdir(workingCopy, { recursive: true }),
  mkdir(configHome, { recursive: true }),
]);
try {
  const result = await runMirror({
    config: { githubAppId: '123456', writeBack: 'dry-run', maxChanged: 25, maxDeletes: 3 },
    dependencies: {
      async readSecrets() {
        return {
          obsidianToken: 'synthetic-image-token',
          vaultName: 'Synthetic Vault',
          githubPrivateKey: 'synthetic-key',
          policy: policy.policy,
        };
      },
      createGitHub() {
        return {
          async verifyRepository() {},
          async snapshot() { return { head: 'a'.repeat(40), tree: 'b'.repeat(40), files: new Map() }; },
          async readFile() { throw new Error('No files expected in smoke test'); },
          async commit() { throw new Error('No commit expected in smoke test'); },
        };
      },
      storage,
      async createWorkspace() {
        return {
          workingCopy,
          configHome,
          cleanup: async () => {},
        };
      },
      createObsidian() {
        return {
          async setup() {},
          async setMode(mode) { assert.equal(mode, 'pull-only'); },
          async sync(mode) { assert.equal(mode, 'pull-only'); },
        };
      },
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status.outcome, 'ok-noop');
  assert.equal(status?.outcome, 'ok-noop');
  assert.ok(archive instanceof Uint8Array);
} finally {
  await rm(root, { recursive: true, force: true });
}

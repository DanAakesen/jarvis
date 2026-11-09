import subprocess
import unittest
from pathlib import Path


class DiagnosticsTests(unittest.TestCase):
    def test_unknown_messages_and_stack_paths_cannot_disclose_credentials(self):
        root = Path(__file__).resolve().parents[3]
        code = '''
import assert from 'node:assert/strict';
import {safeError, workerInspection} from './scripts/factory-sandboxes/diagnostics.mjs';
const secret = new Error('Bearer secret-value https://example.invalid?sig=credential');
secret.stack += '\\n at run (/private/secret-directory/worker.js:12:4)';
const value = safeError(secret);
assert.equal(value.code, null);
assert.equal(value.location, 'worker.js:12:4');
assert.ok(!JSON.stringify(value).includes('secret'));
assert.ok(!JSON.stringify(value).includes('credential'));
assert.equal(safeError(new Error('Sandbox worker boot failed')).code, 'worker_boot_failed');
assert.ok(!workerInspection.includes('os.environ'));
'''
        subprocess.run(['node', '--input-type=module', '-e', code], cwd=root, check=True, capture_output=True)

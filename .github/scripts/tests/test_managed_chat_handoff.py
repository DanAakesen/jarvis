import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HANDOFF = ROOT / ".github/scripts/provision_managed_chat_handoff.sh"
FAKE = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
name, args = Path(sys.argv[0]).name, sys.argv[1:]
state = Path(os.environ['FAKE_STATE'])
with (state / 'calls.jsonl').open('a') as out:
    out.write(json.dumps([name, args]) + '\\n')
if name == 'sleep':
    sys.exit(0)
if name == 'python':
    output = Path(args[args.index('--output') + 1])
    endpoint = args[args.index('--project-endpoint') + 1]
    value = {'projectEndpoint':endpoint,'agentName':'jarvis-main-copilot-preview','version':'1','fingerprint':'a'*64}
    if os.environ.get('BAD_ACTIVATION'):
        value['fingerprint'] = 'invalid'
    fd = os.open(output, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd,'w') as stream:
        json.dump(value,stream)
    print('managed_chat_provisioned')
    sys.exit(0)
if args[:3] == ['deployment','group','show']:
    print(json.dumps({key:{'value':value} for key,value in {
        'foundryAdminEndpoint':'https://synthetic.services.ai.azure.com/api/projects/synthetic',
        'backendAppName':'synthetic-backend','foundryAccountName':'synthetic','foundryProjectName':'synthetic'
    }.items()}))
elif args[:2] == ['rest','--method']:
    body_path = Path(args[args.index('--body')+1][1:])
    operation = json.loads(body_path.read_text())
    assert body_path.stat().st_mode & 0o777 == 0o600
    assert set(operation) == {'operation'}
    if operation['operation'] == 'managed_definition_manifest':
        print(json.dumps({'instructions':'private synthetic instruction','tools':[]}))
    else:
        assert operation == {'operation':'managed_text_canary'}
        if os.environ.get('CANARY_HTTP_FAILURE'):
            print('private provider content',file=sys.stderr)
            sys.exit(1)
        print(json.dumps({'status':'ok','model':'other' if os.environ.get('BAD_CANARY') else 'gpt-6.1-terra','reasoningEffort':'high'}))
elif args[:2] == ['containerapp','update']:
    assert '--set-env-vars' in args
    names = [arg.split('=',1)[0] for arg in args if arg.startswith('FOUNDRY_')]
    assert names == ['FOUNDRY_COPILOT_AGENT_NAME','FOUNDRY_COPILOT_AGENT_VERSION','FOUNDRY_COPILOT_DEFINITION_SHA256']
elif args[:2] == ['containerapp','show']:
    print(json.dumps({'latest':'synthetic-new','ready':'synthetic-old' if os.environ.get('NOT_READY') else 'synthetic-new'}))
else:
    sys.exit(91)
'''


class ManagedHandoffTests(unittest.TestCase):
    def run_handoff(self, **extra):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            bin_dir = base / "bin"
            bin_dir.mkdir()
            for name in ["az", "python", "sleep"]:
                command = bin_dir / name
                command.write_text(FAKE)
                command.chmod(0o700)
            env = {**os.environ, "PATH": str(bin_dir) + ":" + os.environ["PATH"], "RUNNER_TEMP": directory,
                   "FAKE_STATE": directory, "INFRA_DEPLOYMENT": "synthetic", "RESOURCE_GROUP": "rg-synthetic",
                   "SUBSCRIPTION_ID": "11111111-2222-4333-8444-555555555555", **extra}
            result = subprocess.run(["bash", str(HANDOFF)], cwd=ROOT, env=env,
                                    capture_output=True, text=True, timeout=15, check=False)
            calls = [json.loads(line) for line in (base / "calls.jsonl").read_text().splitlines()]
            self.assertEqual(list(base.glob("managed-chat.*")), [])
            return result, calls

    def test_explicit_job_is_default_off_main_only_and_preserves_acceptance(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text()
        input_block = workflow.split("  workflow_dispatch:", 1)[1].split("\npermissions:", 1)[0]
        self.assertIn("provision_managed_chat:", input_block)
        self.assertIn("type: boolean", input_block)
        self.assertIn("default: false", input_block)
        job = workflow.split("  managed-chat-comparison:", 1)[1].split("\n  acceptance:", 1)[0]
        for guard in ["github.event_name == 'workflow_dispatch'", "inputs.provision_managed_chat == true",
                      "github.ref == 'refs/heads/main'", "needs.plan.result == 'success'",
                      "needs.smoke.result == 'success'", "needs.plan.outputs.superseded != 'true'"]:
            self.assertIn(guard, job)
        self.assertIn("needs: [plan, infra, backend, agent, smoke]", job)
        self.assertIn("timeout-minutes: 20", job)
        self.assertIn("contents: read\n      id-token: write", job)
        for dependency in ["infra", "backend", "agent"]:
            self.assertIn(f"(needs.{dependency}.result == 'success' || needs.{dependency}.result == 'skipped')", job)
        self.assertNotIn("needs.acceptance", job)
        self.assertNotIn("status/smoke", job)
        self.assertNotIn("release_state.py record", job)
        self.assertNotIn("role assignment", job)
        self.assertNotIn("upload-artifact", job)
        self.assertIn("group: jarvis-production-deploy", workflow)
        self.assertEqual(workflow.count("provision_managed_chat_handoff.sh"), 1)
        self.assertIn("needs: [plan, infra, backend, web, agent, smoke, acceptance]", workflow)

    def test_private_manifest_provision_exact_three_env_and_canary_order(self):
        result, calls = self.run_handoff()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("managed_chat_comparison_canary_ok", result.stdout)
        names = [(name, args[:2]) for name, args in calls if name != "sleep"]
        self.assertEqual(names, [("az", ["deployment", "group"]), ("az", ["rest", "--method"]),
                                 ("python", [".github/scripts/provision_managed_chat.py", "--project-id"]),
                                 ("az", ["containerapp", "update"]), ("az", ["containerapp", "show"]),
                                 ("az", ["rest", "--method"])])
        self.assertNotIn("private", result.stdout + result.stderr)
        update = next(args for name, args in calls if args[:2] == ["containerapp", "update"])
        self.assertNotIn("--replace-env-vars", update)
        self.assertNotIn("--remove-env-vars", update)

    def test_invalid_activation_never_updates_backend(self):
        result, calls = self.run_handoff(BAD_ACTIVATION="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("managed_chat_activation_invalid", result.stdout)
        self.assertFalse(any(args[:2] == ["containerapp", "update"] for _, args in calls))

    def test_readiness_failure_is_bounded_and_never_calls_canary(self):
        result, calls = self.run_handoff(NOT_READY="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("managed_chat_backend_not_ready", result.stdout)
        self.assertEqual(sum(args[:2] == ["containerapp", "show"] for _, args in calls), 30)
        self.assertEqual(sum(args[:2] == ["rest", "--method"] for _, args in calls), 1)

    def test_canary_failure_never_prints_raw_provider_body_or_claims_release_success(self):
        for extra, code in [({"BAD_CANARY": "1"}, "managed_chat_canary_failed"),
                            ({"CANARY_HTTP_FAILURE": "1"}, "managed_chat_canary_unavailable")]:
            result, _ = self.run_handoff(**extra)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(code, result.stdout)
            self.assertNotIn("private provider", result.stdout + result.stderr)
            self.assertNotIn("canary_ok", result.stdout)


if __name__ == "__main__":
    unittest.main()

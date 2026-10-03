import httpx
import pytest

from scripts import deploy


class FakeFoundry:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def request(self, method, url, body=None):
        self.calls.append((method, url, body))
        if url.endswith('/sessions?api-version=v1'):
            return {"session_id": "probe-session"}
        if method == "DELETE":
            return {}
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.mark.parametrize("tier,cpu,memory", [("1x2", "1", "2Gi"), ("2x4", "2", "4Gi")])
def test_definition_uses_small_tiers_and_nonsecret_settings(tier, cpu, memory):
    definition = deploy.definition("registry/runner@sha256:digest", tier, "https://vault.vault.azure.net/")
    assert (definition["cpu"], definition["memory"]) == (cpu, memory)
    assert definition["protocol_versions"] == [{"protocol": "invocations", "version": "2.0.0"}]
    assert definition["session_configuration"] == {"idle_timeout_seconds": 120}
    assert set(definition["environment_variables"]) == {"KEY_VAULT_URI", "JARVIS_WORK_ROOT"}


def test_successful_probe_checks_both_providers_and_deletes_session():
    foundry = FakeFoundry({"key_vault_access": True})
    deploy.probe(foundry, "https://runtime/api/projects/jarvis", "runner")
    assert [call[0] for call in foundry.calls] == ["POST", "POST", "POST", "DELETE"]
    assert [call[2]["agent"] for call in foundry.calls[1:3]] == ["copilot", "codex"]
    assert all("agent_session_id=probe-session" in call[1] for call in foundry.calls[1:3])
    assert foundry.calls[-1][1].endswith("/sessions/probe-session?api-version=v1")


@pytest.mark.parametrize("result", [{"key_vault_access": False}, {}, httpx.HTTPStatusError(
    "HTTP 503", request=httpx.Request("POST", "https://runtime"), response=httpx.Response(503)
)])
def test_probe_failure_still_deletes_the_owned_session(result):
    foundry = FakeFoundry(result)
    with pytest.raises((RuntimeError, httpx.HTTPStatusError)):
        deploy.probe(foundry, "https://runtime/api/projects/jarvis", "runner")
    assert foundry.calls[-1][0] == "DELETE"


def test_cli_failure_is_sanitized(monkeypatch):
    class Result:
        returncode = 1
        stdout = 'private credential'
        stderr = 'private credential'

    monkeypatch.setattr(deploy.subprocess, "run", lambda *args, **kwargs: Result())
    with pytest.raises(RuntimeError, match="Azure CLI account command failed") as error:
        deploy.az("subscription", "account", "get-access-token")
    assert "private credential" not in str(error.value)


def test_main_ref_is_required_before_any_cloud_call(monkeypatch):
    monkeypatch.setenv("GITHUB_REF", "refs/heads/task")
    with pytest.raises(RuntimeError, match="only from main"):
        deploy.main()


def test_secret_grants_are_idempotent_and_scope_specific(monkeypatch):
    calls = []

    def az(subscription, *arguments):
        calls.append(arguments)
        return [{"principalId": "identity", "roleDefinitionId": f"/roles/{deploy.READ_SECRET_ROLE}",
                 "scope": "vault/secrets/codex-login"}]

    monkeypatch.setattr(deploy, "az", az)
    deploy.grant("subscription", "identity", deploy.READ_SECRET_ROLE, "vault/secrets/codex-login")
    assert len(calls) == 1
    deploy.grant("subscription", "identity", deploy.READ_SECRET_ROLE, "vault/secrets/copilot-token")
    assert calls[-1][0:3] == ("role", "assignment", "create")
    assert calls[-1][-1] == "vault/secrets/copilot-token"


def test_deploy_selects_version_grants_only_credential_scopes_and_probes(monkeypatch):
    grants = []
    monkeypatch.setattr(deploy, "grant", lambda *args: grants.append(args))

    def az(subscription, *arguments):
        if arguments[:2] == ("keyvault", "show"):
            return {"id": "vault", "properties": {"vaultUri": "https://vault.vault.azure.net/"}}
        return [{"id": "insights"}]

    monkeypatch.setattr(deploy, "az", az)

    class DeployedFoundry(FakeFoundry):
        def wait_for_route(self, url):
            self.calls.append(("WAIT", url, None))

        def request(self, method, url, body=None, merge=False):
            if "/versions" in url:
                self.calls.append((method, url, body))
                if method == "POST":
                    return {"version": "7"}
                return {"status": "active", "definition": {"session_configuration": {
                    "idle_timeout_seconds": 120}}}
            if "/endpoint/" not in url:
                self.calls.append((method, url, body))
                return {"instance_identity": {"principal_id": "agent-identity"}}
            return super().request(method, url, body)

    outputs = {"foundryAdminEndpoint": {"value": "https://admin/api/projects/jarvis"},
               "foundryRuntimeEndpoint": {"value": "https://runtime/api/projects/jarvis"},
               "keyVaultName": {"value": "vault"}}
    foundry = DeployedFoundry({"key_vault_access": True})
    result = deploy.deploy(foundry, "subscription", outputs, "registry/runner@sha256:digest", "runner", "2x4")
    assert result["version"] == "7" and result["key_vault_probe"] is True
    assert {row[-1] for row in grants if row[-2] == deploy.READ_SECRET_ROLE} == {
        "vault/secrets/github-token", "vault/secrets/copilot-token", "vault/secrets/codex-login"}
    assert [row[-1] for row in grants if row[-2] == deploy.WRITE_SECRET_ROLE] == ["vault/secrets/codex-login"]
    patch = next(body for method, url, body in foundry.calls if method == "PATCH")
    assert patch["agent_endpoint"]["protocol_configuration"] == {"invocations": {}}
    assert foundry.calls[-1][0] == "DELETE"

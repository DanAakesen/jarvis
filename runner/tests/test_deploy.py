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
            return {"agent_session_id": "probe-session", "status": "active"}
        if method == "DELETE":
            return {}
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.mark.parametrize("tier,cpu,memory", [("1x2", "1", "2Gi"), ("2x4", "2", "4Gi")])
def test_definition_uses_small_tiers_and_nonsecret_settings(tier, cpu, memory):
    definition = deploy.definition(
        "registry/runner@sha256:digest", tier, "https://vault.vault.azure.net/",
        "https://backend.example", "api://00000000-0000-4000-8000-000000000000/.default",
    )
    assert (definition["cpu"], definition["memory"]) == (cpu, memory)
    assert definition["protocol_versions"] == [{"protocol": "invocations", "version": "2.0.0"}]
    assert definition["session_configuration"] == {"idle_timeout_seconds": 120}
    assert definition["environment_variables"] == {
        "KEY_VAULT_URI": "https://vault.vault.azure.net/",
        "JARVIS_WORK_ROOT": "/files/jarvis",
        "JARVIS_BACKEND_URL": "https://backend.example",
        "JARVIS_API_SCOPE": "api://00000000-0000-4000-8000-000000000000/.default",
        "JARVIS_DISK_LOW_THRESHOLD_BYTES": str(1024**3),
    }


def test_disk_low_threshold_setting_is_forwarded_and_validated(monkeypatch):
    monkeypatch.setenv("JARVIS_DISK_LOW_THRESHOLD_BYTES", "2048")
    assert deploy._disk_low_threshold_bytes() == 2048
    configured = deploy.definition(
        "registry/runner@sha256:digest", "1x2", "https://vault.vault.azure.net/",
        "https://backend.example", "api://00000000-0000-4000-8000-000000000000/.default",
        deploy._disk_low_threshold_bytes(),
    )
    assert configured["environment_variables"]["JARVIS_DISK_LOW_THRESHOLD_BYTES"] == "2048"
    for invalid in ("0", "-1", "one"):
        with pytest.raises(ValueError, match="positive integer"):
            deploy._disk_low_threshold_bytes(invalid)


def test_backend_settings_use_the_production_api_origin_and_scope():
    assert deploy.backend_settings(
        {"backendFqdn": {"value": "jarvis.example.azurecontainerapps.io"}},
        {"api": {"identifierUri": "api://00000000-0000-4000-8000-000000000000"}},
    ) == (
        "https://jarvis.example.azurecontainerapps.io",
        "api://00000000-0000-4000-8000-000000000000/.default",
    )
    with pytest.raises(ValueError, match="Invalid backend URL"):
        deploy.backend_settings(
            {"backendFqdn": {"value": "bad.example/path"}},
            {"api": {"identifierUri": "api://00000000-0000-4000-8000-000000000000"}},
        )


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
    deploy.grant("subscription", "identity", deploy.READ_SECRET_ROLE, "vault/secrets/jarvis-copilot")
    assert calls[-1][0:3] == ("role", "assignment", "create")
    assert calls[-1][-1] == "vault/secrets/jarvis-copilot"


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
               "backendFqdn": {"value": "backend.example"},
               "keyVaultName": {"value": "vault"}}
    foundry = DeployedFoundry({"key_vault_access": True})
    result = deploy.deploy(
        foundry, "subscription", outputs, "registry/runner@sha256:digest", "runner", "2x4",
        "https://backend.example", "api://00000000-0000-4000-8000-000000000000/.default",
    )
    assert result["version"] == "7" and result["key_vault_probe"] is True
    assert {row[-1] for row in grants if row[-2] == deploy.READ_SECRET_ROLE} == {
        "vault/secrets/jarvis-github", "vault/secrets/jarvis-copilot", "vault/secrets/codex-login"}
    assert [row[-1] for row in grants if row[-2] == deploy.WRITE_SECRET_ROLE] == ["vault/secrets/codex-login"]
    patch = next(body for method, url, body in foundry.calls if method == "PATCH")
    assert patch["agent_endpoint"]["protocol_configuration"] == {"invocations": {}}
    version_body = next(body for method, url, body in foundry.calls
                        if method == "POST" and "/versions?" in url)
    assert version_body["definition"]["environment_variables"]["JARVIS_BACKEND_URL"] == "https://backend.example"
    assert foundry.calls[-1][0] == "DELETE"


def test_acr_workflow_dockerfiles_resolve_from_the_workflow_working_directory():
    import shlex
    from pathlib import Path

    repo = Path(__file__).parents[2]
    workflow = repo.joinpath(".github/workflows/runner-deploy.yml").read_text()
    commands = [shlex.split(line.strip()) for line in workflow.splitlines()
                if line.strip().startswith("az acr build ")]
    assert len(commands) == 2
    files = []
    for command in commands:
        context = repo / command[-1]
        dockerfile = command[command.index("--file") + 1]
        # az acr build checks --file from the working directory (the repository
        # root in the workflow), not from the context argument (L53).
        assert context == repo / "runner"
        assert (repo / dockerfile).is_file()
        files.append(dockerfile)
    assert set(files) == {"runner/Dockerfile", "runner/Dockerfile.dotnet"}

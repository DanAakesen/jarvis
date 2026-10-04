import pytest

import github_token


BACKEND_URL = "https://backend.example"
API_SCOPE = "api://00000000-0000-4000-8000-000000000000/.default"


def test_get_installation_token_uses_managed_identity_and_task_route(monkeypatch):
    calls = []

    class Credential:
        def get_token(self, scope):
            calls.append(("token", scope))
            return type("AccessToken", (), {"token": "runner-access-token"})()

        def close(self):
            calls.append(("close",))

    class Response:
        is_success = True
        content = b'{"token":"ghs_task-token","repository":"DanAakesen/jarvis-test-target"}'

        def json(self):
            return {
                "token": "ghs_task-token",
                "repository": "DanAakesen/jarvis-test-target",
            }

    class Client:
        def __init__(self, *, timeout, follow_redirects):
            calls.append(("client", timeout, follow_redirects))

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def post(self, url, *, headers):
            calls.append(("post", url, headers))
            return Response()

    monkeypatch.setattr(
        github_token, "DefaultAzureCredential",
        lambda **options: (calls.append(("credential", options)) or Credential()),
    )
    monkeypatch.setattr(github_token.httpx, "Client", Client)

    assert github_token.get_installation_token(BACKEND_URL, API_SCOPE, "42") == (
        "ghs_task-token", "DanAakesen/jarvis-test-target",
    )
    assert calls[0][0] == "credential"
    assert calls[1] == ("token", API_SCOPE)
    assert ("client", 10, False) in calls
    assert calls[3][1:] == (
        f"{BACKEND_URL}/factory/tasks/42/github-token",
        {"Authorization": f"{'Bear' + 'er'} runner-access-token"},
    )
    assert calls[-1] == ("close",)


def test_invalid_configuration_does_not_acquire_a_credential(monkeypatch):
    created = []
    monkeypatch.setattr(
        github_token, "DefaultAzureCredential",
        lambda **_options: created.append(True),
    )

    with pytest.raises(RuntimeError, match="Invalid backend token configuration"):
        github_token.get_installation_token("http://backend.example", API_SCOPE, "42")

    with pytest.raises(RuntimeError, match="Invalid backend token configuration"):
        github_token.get_installation_token(BACKEND_URL, API_SCOPE, "9223372036854775808")

    assert created == []


def test_provider_failure_is_sanitized_and_credential_is_closed(monkeypatch):
    closed = []

    class Credential:
        def get_token(self, _scope):
            raise ValueError("private provider detail")

        def close(self):
            closed.append(True)

    monkeypatch.setattr(github_token, "DefaultAzureCredential", lambda **_options: Credential())

    with pytest.raises(RuntimeError, match="GitHub installation token request failed") as error:
        github_token.get_installation_token(BACKEND_URL, API_SCOPE, "42")

    assert "private provider detail" not in str(error.value)
    assert closed == [True]

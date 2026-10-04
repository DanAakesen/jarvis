from io import StringIO

import git_credential_helper as helper


def _request(path="DanAakesen/jarvis-test-target.git", host="github.com"):
    return StringIO(f"protocol=https\nhost={host}\npath={path}\n\n")


def test_app_tokens_are_requested_for_each_matching_github_credential(monkeypatch, capsys):
    requests = []

    def get_token(backend_url, api_scope, task_id):
        requests.append((backend_url, api_scope, task_id))
        return "ghs_installation-token", "DanAakesen/jarvis-test-target"

    monkeypatch.setenv("JARVIS_GITHUB_APP_TOKEN_ENABLED", "true")
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    monkeypatch.setenv("JARVIS_TASK_ID", "42")
    monkeypatch.setattr(helper, "get_installation_token", get_token)
    for _ in range(2):
        monkeypatch.setattr("sys.stdin", _request())
        assert helper.main(["get"]) == 0
        assert capsys.readouterr().out == "username=x-access-token\npassword=ghs_installation-token\n\n"
    assert requests == [
        ("https://backend.example", "api://00000000-0000-4000-8000-000000000000/.default", "42"),
        ("https://backend.example", "api://00000000-0000-4000-8000-000000000000/.default", "42"),
    ]


def test_app_token_is_not_returned_for_another_repository_or_host(monkeypatch, capsys):
    calls = []
    monkeypatch.setenv("JARVIS_GITHUB_APP_TOKEN_ENABLED", "true")
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    monkeypatch.setenv("JARVIS_TASK_ID", "42")
    monkeypatch.setattr(
        helper, "get_installation_token",
        lambda *_args: (calls.append(True) or "ghs_installation-token", "DanAakesen/jarvis-test-target"),
    )
    monkeypatch.setattr("sys.stdin", _request("DanAakesen/another-repo.git"))
    assert helper.main(["get"]) == 0
    assert capsys.readouterr().out == ""
    assert calls == [True]

    monkeypatch.setattr("sys.stdin", _request("DanAakesen/jarvis-test-target.git", "example.com"))
    assert helper.main(["get"]) == 0
    assert capsys.readouterr().out == ""
    assert calls == [True]


def test_static_token_remains_available_until_app_tokens_are_enabled(monkeypatch, capsys):
    monkeypatch.delenv("JARVIS_GITHUB_APP_TOKEN_ENABLED", raising=False)
    monkeypatch.setenv("GH_TOKEN", "legacy-test-token")
    monkeypatch.setattr("sys.stdin", _request())
    assert helper.main(["get"]) == 0
    assert capsys.readouterr().out == "username=x-access-token\npassword=legacy-test-token\n\n"


def test_app_token_failure_is_visible_without_exposing_provider_details(monkeypatch, capsys):
    monkeypatch.setenv("JARVIS_GITHUB_APP_TOKEN_ENABLED", "true")
    monkeypatch.setenv("JARVIS_BACKEND_URL", "https://backend.example")
    monkeypatch.setenv("JARVIS_API_SCOPE", "api://00000000-0000-4000-8000-000000000000/.default")
    monkeypatch.setenv("JARVIS_TASK_ID", "42")

    def fail(*_args):
        raise RuntimeError("private token detail")

    monkeypatch.setattr(helper, "get_installation_token", fail)
    monkeypatch.setattr("sys.stdin", _request())
    assert helper.main(["get"]) == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err == "GitHub credential request failed\n"
    assert "private token detail" not in output.err

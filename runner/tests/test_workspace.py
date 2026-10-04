import asyncio
import json
import os
import shutil
import subprocess
import sys

import pytest
from starlette.requests import Request

import app


CONFIG = {"repository": "owner/project", "defaultBranch": "main", "branch": "jarvis/task-42"}


def task(invocation="turn", session="session"):
    return app.TaskState(
        invocation, session, "copilot", "Work", repository=CONFIG["repository"],
        default_branch=CONFIG["defaultBranch"], branch=CONFIG["branch"],
    )


@pytest.mark.parametrize("existing", [False, True])
def test_clone_checks_out_existing_task_branch_or_creates_from_default(
    tmp_path, monkeypatch, git_repository, existing,
):
    source, env, git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    if existing:
        git(source, "checkout", "-b", CONFIG["branch"])
        (source / "README").write_text("Existing task work\n")
        git(source, "commit", "-am", "Task work")
        git(source, "checkout", "main")
    expected = git(source, "rev-parse", CONFIG["branch"] if existing else "main")
    root = tmp_path / "session"
    root.mkdir()
    project, head = asyncio.run(app._prepare_workspace(task(), root, env))
    assert project == root / "project"
    assert head == expected
    assert git(project, "branch", "--show-current") == CONFIG["branch"]
    assert git(project, "config", f"branch.{CONFIG['branch']}.merge") == f"refs/heads/{CONFIG['branch']}"
    assert json.loads((root / app.WORKSPACE_FILE).read_text()) == CONFIG
    assert (project / "README").read_text() == ("Existing task work\n" if existing else "Project fixture\n")


def test_plain_push_of_new_task_branch_never_updates_default(tmp_path, monkeypatch, git_repository):
    source, env, git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    original_default = git(source, "rev-parse", "main")
    root = tmp_path / "session"
    root.mkdir()
    project, _before = asyncio.run(app._prepare_workspace(task(), root, env))
    (project / "README").write_text("Task progress\n")
    git(project, "commit", "-am", "Task progress")
    git(project, "push")
    assert git(source, "rev-parse", CONFIG["branch"]) == git(project, "rev-parse", "HEAD")
    assert git(source, "rev-parse", "main") == original_default


@pytest.mark.parametrize(("default_branch", "branch"), [
    ("release/été+v2", "jarvis/修正+build"),
    ("topic+release", "task./fix"),
])
def test_clone_accepts_valid_unicode_and_punctuation_branch_names(
    tmp_path, monkeypatch, git_repository, default_branch, branch,
):
    source, env, git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    git(source, "branch", "-m", "main", default_branch)
    state = task()
    state.default_branch = default_branch
    state.branch = branch
    root = tmp_path / "session"
    root.mkdir()
    project, head = asyncio.run(app._prepare_workspace(state, root, env))
    assert head == git(source, "rev-parse", default_branch)
    assert git(project, "branch", "--show-current") == branch
    assert git(project, "config", f"branch.{branch}.merge") == f"refs/heads/{branch}"


def test_cloned_project_can_commit_with_empty_home_and_no_author_environment(
    tmp_path, monkeypatch, git_repository,
):
    _source, env, _git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    clean_env = {
        key: value for key, value in env.items()
        if not key.startswith(("GIT_AUTHOR_", "GIT_COMMITTER_"))
    }
    root = tmp_path / "session"
    root.mkdir()
    clean_env["HOME"] = str(root)
    project, before = asyncio.run(app._prepare_workspace(task(), root, clean_env))
    (project / "README").write_text("Commit without provider identity setup\n")
    subprocess.run(
        ["git", "commit", "-am", "Runner checkpoint"], cwd=project, env=clean_env,
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
    )
    identity = subprocess.check_output(
        ["git", "show", "-s", "--format=%an <%ae>"], cwd=project, env=clean_env, timeout=10,
    ).decode().strip()
    assert identity == "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>"
    assert asyncio.run(app._turn_has_commit(task(), project, clean_env, before))


def test_resume_preserves_custom_repository_author(tmp_path, monkeypatch, git_repository):
    _source, env, git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    root = tmp_path / "session"
    root.mkdir()
    project, _before = asyncio.run(app._prepare_workspace(task(), root, env))
    git(project, "config", "--local", "user.name", "Project automation")
    git(project, "config", "--local", "user.email", "project-automation@example.invalid")
    asyncio.run(app._prepare_workspace(task("resume"), root, env))
    assert git(project, "config", "--local", "user.name") == "Project automation"
    assert git(project, "config", "--local", "user.email") == "project-automation@example.invalid"


def test_workspace_resume_preserves_local_commits_and_dirty_files(tmp_path, monkeypatch, git_repository):
    _source, env, git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    root = tmp_path / "session"
    root.mkdir()
    project, before = asyncio.run(app._prepare_workspace(task(), root, env))
    (project / "README").write_text("Committed progress\n")
    git(project, "commit", "-am", "Progress")
    (project / "README").write_text("Uncommitted progress\n")
    _project, after = asyncio.run(app._prepare_workspace(task("resumed"), root, env))
    assert after != before
    assert (project / "README").read_text() == "Uncommitted progress\n"
    assert app._session_workspace("session", {}) == CONFIG
    with pytest.raises(ValueError, match="cannot change"):
        app._session_workspace("session", {**CONFIG, "branch": "jarvis/another"})


def test_recovery_clones_pushed_task_branch_in_new_session(tmp_path, monkeypatch, git_repository):
    source, env, git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    git(source, "config", "receive.denyCurrentBranch", "ignore")
    first_root = tmp_path / "first"
    first_root.mkdir()
    project, _before = asyncio.run(app._prepare_workspace(task(session="first"), first_root, env))
    (project / "README").write_text("Checkpoint\n")
    git(project, "commit", "-am", "Checkpoint")
    git(project, "push", "origin", CONFIG["branch"])
    expected = git(project, "rev-parse", "HEAD")
    recovery_root = tmp_path / "recovered"
    recovery_root.mkdir()
    recovered, head = asyncio.run(app._prepare_workspace(task(session="recovered"), recovery_root, env))
    assert head == expected
    assert (recovered / "README").read_text() == "Checkpoint\n"


@pytest.mark.parametrize("failure", ["wrong_branch", "no_git", "wrong_origin", "rewritten_branch", "reset"])
def test_invalid_workspace_never_reports_a_commit(tmp_path, monkeypatch, git_repository, failure):
    source, env, git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    root = tmp_path / "session"
    root.mkdir()
    project, before = asyncio.run(app._prepare_workspace(task(), root, env))
    if failure == "wrong_branch":
        git(project, "checkout", "-b", "other")
    elif failure == "no_git":
        shutil.rmtree(project / ".git")
    elif failure == "wrong_origin":
        git(project, "remote", "set-url", "origin", str(source / "other"))
    elif failure == "reset":
        (project / "README").write_text("Prior turn checkpoint\n")
        git(project, "commit", "-am", "Prior checkpoint")
        before = git(project, "rev-parse", "HEAD")
        git(project, "reset", "--hard", "HEAD^")
    else:
        git(project, "checkout", "--orphan", "rewritten")
        git(project, "commit", "-m", "Unrelated history")
        git(project, "branch", "-D", CONFIG["branch"])
        git(project, "branch", "-m", CONFIG["branch"])
    with pytest.raises(app.WorkspaceError):
        if failure == "wrong_origin":
            asyncio.run(app._prepare_workspace(task(), root, env))
        else:
            asyncio.run(app._turn_has_commit(task(), project, env, before))


@pytest.mark.parametrize("action", ["question", "commit", "wrong_branch", "no_git"])
def test_end_turn_emits_question_without_commit_and_completed_with_commit(
    tmp_path, monkeypatch, git_repository, action,
):
    _source, _env, git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    monkeypatch.delenv("JARVIS_BACKEND_URL", raising=False)
    cwd_seen = []
    usage = {"input_tokens": 123, "output_tokens": 45, "premium_requests": 1}

    class Client:
        def __init__(self, _command, cwd, state, env, persisted_session_id=None):
            self.cwd = cwd
            self.state = state
            cwd_seen.append(cwd)

        async def start(self):
            pass

        async def run(self, _prompt):
            self.state.last_agent_message = "Which behaviour do you want?"
            if action == "commit":
                (self.cwd / "README").write_text("Done\n")
                git(self.cwd, "commit", "-am", "Done")
            elif action == "wrong_branch":
                git(self.cwd, "checkout", "-b", "other")
            elif action == "no_git":
                shutil.rmtree(self.cwd / ".git")
            return {"response": {"stopReason": "end_turn", "usage": usage}}

        async def stop(self):
            pass

    async def credentials(_agent):
        return {"github_token": "fixture-git-token", "copilot_token": "fixture-seat-token"}

    monkeypatch.setattr(app, "ACPClient", Client)
    monkeypatch.setattr(app, "_credentials_for", credentials)
    state = task()
    asyncio.run(app._run_task(state))
    assert cwd_seen == [tmp_path / "session" / "project"]
    if action in {"wrong_branch", "no_git"}:
        assert state.status == "failed"
        assert not any(event["kind"] in {"completed", "session_question"} for event in state.events)
        return
    assert state.status == "completed"
    questions = [event["data"] for event in state.events if event["kind"] == "session_question"]
    assert questions == ([] if action == "commit" else [{
        "question": "Which behaviour do you want?",
        "result": {"response": {"stopReason": "end_turn", "usage": usage}},
    }])
    terminal_event = next(
        event for event in state.events if event["kind"] in {"completed", "session_question"}
    )
    assert terminal_event["data"]["result"]["response"]["usage"] == usage
    assert any(event["kind"] == "completed" for event in state.events) == (action == "commit")
    assert ".git-credential-helper" not in git(cwd_seen[0], "ls-files")


def test_missing_repository_access_is_reported_without_git_diagnostics(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    monkeypatch.setattr(app, "_repository_url", lambda _repo: str(tmp_path / "PRIVATE-credential-detail"))
    started = []
    monkeypatch.setattr(app, "_agent_command", lambda *args: started.append(args))

    async def credentials(_agent):
        return {"github_token": "PRIVATE-secret-token", "copilot_token": "PRIVATE-seat-token"}

    monkeypatch.setattr(app, "_credentials_for", credentials)
    state = task()
    asyncio.run(app._run_task(state))
    assert state.status == "failed"
    assert state.error == "Task repository clone failed; verify repository access"
    assert started == []
    assert not (tmp_path / "session" / "project").exists()
    assert "PRIVATE" not in json.dumps(state.events)


def test_failed_clone_can_retry_without_a_partial_checkout(tmp_path, monkeypatch, git_repository):
    source, env, _git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    root = tmp_path / "session"
    root.mkdir()
    monkeypatch.setattr(app, "_repository_url", lambda _repository: str(source / "missing"))
    with pytest.raises(app.WorkspaceError, match="verify repository access"):
        asyncio.run(app._prepare_workspace(task(), root, env))
    assert not (root / "project").exists()
    monkeypatch.setattr(app, "_repository_url", lambda _repository: str(source))
    project, head = asyncio.run(app._prepare_workspace(task("retry"), root, env))
    assert head
    assert (project / "README").read_text() == "Project fixture\n"


def test_checkout_failure_preserves_configuration_and_allows_same_workspace_retry(
    tmp_path, monkeypatch, git_repository,
):
    _source, env, _git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    original_git = app._git
    checkout_failed = False

    async def fail_checkout_once(cwd, env, *args, **kwargs):
        nonlocal checkout_failed
        if args[0] == "checkout" and not checkout_failed:
            checkout_failed = True
            raise app.WorkspaceError("Task repository Git operation failed")
        return await original_git(cwd, env, *args, **kwargs)

    monkeypatch.setattr(app, "_git", fail_checkout_once)
    root = tmp_path / "session"
    root.mkdir()
    with pytest.raises(app.WorkspaceError):
        asyncio.run(app._prepare_workspace(task(), root, env))
    assert not (root / "project").exists()
    assert json.loads((root / app.WORKSPACE_FILE).read_text()) == CONFIG
    changed = task("changed")
    changed.default_branch = "another"
    with pytest.raises(app.WorkspaceError, match="configuration is invalid"):
        asyncio.run(app._prepare_workspace(changed, root, env))
    project, _head = asyncio.run(app._prepare_workspace(task("retry"), root, env))
    assert (project / "README").read_text() == "Project fixture\n"


def test_existing_checkout_without_saved_configuration_is_not_adopted(
    tmp_path, monkeypatch, git_repository,
):
    _source, env, _git = git_repository
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    root = tmp_path / "session"
    root.mkdir()
    project, _head = asyncio.run(app._prepare_workspace(task(), root, env))
    (root / app.WORKSPACE_FILE).unlink()
    changed = task("changed")
    changed.default_branch = "another"
    with pytest.raises(app.WorkspaceError, match="no persisted workspace configuration"):
        asyncio.run(app._prepare_workspace(changed, root, env))
    assert (project / "README").read_text() == "Project fixture\n"


def test_codex_credentials_are_cleaned_up_when_clone_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    monkeypatch.setattr(app, "_repository_url", lambda _repo: str(tmp_path / "missing"))
    root = tmp_path / "session"
    auth_path = app._write_codex_home(root / ".codex", "{}")

    async def credentials(_agent):
        return {"github_token": "PRIVATE-secret-token", "codex_login": "{}"}

    async def store(_login):
        return False

    monkeypatch.setattr(app, "_credentials_for", credentials)
    monkeypatch.setattr(app, "_store_codex_login_if_newer", store)
    state = task()
    state.agent = "codex"
    asyncio.run(app._run_task(state))
    assert state.status == "failed"
    assert not auth_path.exists()
    assert "PRIVATE-secret-token" not in (root / ".git-credential-helper").read_text()
    assert "PRIVATE-secret-token" not in json.dumps(state.events)


@pytest.mark.parametrize(("key", "value"), [
    ("repository", "https://github.com/owner/project"), ("repository", "../project"),
    ("repository", "owner/../project"), ("repository", "owner/project?token=secret"),
    ("repository", "owner/project\n"), ("repository", "owner/.."),
    ("branch", "--upload-pack=command"), ("branch", "task..ref"), ("branch", "refs/heads/x.lock"),
    ("branch", "task@{1}"), ("branch", "task\\x"), ("branch", "task//x"),
    ("branch", "main"), ("branch", "HEAD"),         ("branch", "task/x/"), ("branch", "/task"), ("branch", "task?x"),
    ("branch", "task:x"), ("branch", "task*x"), ("branch", "task[x"),
    ("branch", "task^x"), ("branch", "task~x"), ("branch", "task x"),
    ("defaultBranch", "-main"), ("defaultBranch", "main\ninjected"),
])
def test_untrusted_workspace_configuration_is_rejected(key, value):
    with pytest.raises(ValueError):
        app._workspace_config({**CONFIG, key: value})


@pytest.mark.parametrize("saved", ["not JSON", "[]", '{"repository":"owner/project"}'])
def test_invalid_saved_workspace_fails_closed(tmp_path, monkeypatch, saved):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    root = tmp_path / "session"
    root.mkdir()
    (root / app.WORKSPACE_FILE).write_text(saved)
    with pytest.raises(ValueError, match="unreadable"):
        app._session_workspace("session", CONFIG)


@pytest.mark.parametrize("missing", ["repository", "defaultBranch", "branch"])
def test_start_requires_workspace_fields_at_http_boundary(tmp_path, monkeypatch, missing):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "tasks", {})
    payload = {"agent": "copilot", "task": "Work", **CONFIG}
    del payload[missing]
    request = Request({
        "type": "http", "method": "POST", "headers": [], "path": "/invocations",
        "state": {"session_id": "new", "invocation_id": "turn"},
    })

    async def body():
        return payload

    request.json = body
    response = asyncio.run(app.invoke(request))
    assert response.status_code == 400
    assert app.tasks == {}


@pytest.mark.parametrize("mode", ["task", "steer"])
def test_resume_and_steer_load_saved_workspace_fields(tmp_path, monkeypatch, mode):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "tasks", {})
    monkeypatch.setattr(app, "tasks_lock", asyncio.Lock())
    monkeypatch.setattr(app.asyncio, "create_task", lambda coroutine: coroutine.close())
    app._write_json(tmp_path / "session" / app.WORKSPACE_FILE, CONFIG)
    request = Request({
        "type": "http", "method": "POST", "headers": [], "path": "/invocations",
        "state": {"session_id": "session", "invocation_id": "turn"},
    })

    async def body():
        return {"agent": "copilot", "mode": mode, "task": "Continue", "message": "Correction"}

    request.json = body
    response = asyncio.run(app.invoke(request))
    assert response.status_code == 200
    state = app.tasks["turn"]
    assert (state.repository, state.default_branch, state.branch) == (
        CONFIG["repository"], CONFIG["defaultBranch"], CONFIG["branch"],
    )


def test_acp_question_captures_redacted_streamed_agent_message(tmp_path, monkeypatch, git_repository):
    monkeypatch.setattr(app, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(app, "session_clients", {})
    monkeypatch.setattr(app, "session_locks", {})
    script = tmp_path / "question_acp.py"
    script.write_text(
        "import json, sys\n"
        "for line in sys.stdin:\n"
        "    message = json.loads(line)\n"
        "    method = message['method']\n"
        "    if method == 'session/prompt':\n"
        "        print(json.dumps({'jsonrpc':'2.0', 'method':'session/update', 'params': {\n"
        "            'update': {'sessionUpdate':'agent_message_chunk',\n"
        "            'content': {'type':'text', 'text':'Earlier progress'}}}}), flush=True)\n"
        "        print(json.dumps({'jsonrpc':'2.0', 'method':'session/update', 'params': {\n"
        "            'update': {'sessionUpdate':'tool_call', 'toolCallId':'1'}}}), flush=True)\n"
        "        for text in ['Please clarify ', 'fixture-git-token?']:\n"
        "            print(json.dumps({'jsonrpc':'2.0', 'method':'session/update', 'params': {\n"
        "                'update': {'sessionUpdate':'agent_message_chunk',\n"
        "                'content': {'type':'text', 'text':text}}}}), flush=True)\n"
        "    result = {'sessionId':'acp'} if method == 'session/new' else {'stopReason':'end_turn'}\n"
        "    print(json.dumps({'jsonrpc':'2.0', 'id':message['id'], 'result':result}), flush=True)\n"
    )

    async def credentials(_agent):
        return {"github_token": "fixture-git-token", "copilot_token": "fixture-seat-token"}

    monkeypatch.setattr(app, "_credentials_for", credentials)
    monkeypatch.setattr(app, "_agent_command", lambda *_args: [sys.executable, str(script)])
    state = task()
    asyncio.run(app._run_task(state))
    assert state.status == "completed"
    assert state.last_agent_message == "Please clarify [redacted]?"
    assert [event["data"] for event in state.events if event["kind"] == "session_question"] == [
        {"question": "Please clarify [redacted]?", "result": state.result},
    ]
    assert "fixture-git-token" not in json.dumps(state.events)
    resumed = task("resumed")
    asyncio.run(app._run_task(resumed))
    assert resumed.status == "completed"
    assert any(event["kind"] == "acp_session_loaded" for event in resumed.events)
    assert resumed.last_agent_message == "Please clarify [redacted]?"
    recovered = task("recovered", "new-session")
    asyncio.run(app._run_task(recovered))
    assert recovered.status == "completed"
    assert any(event["kind"] == "acp_session" for event in recovered.events)
    assert not any(event["kind"] == "acp_session_loaded" for event in recovered.events)


def test_git_timeout_kills_and_reaps_process(tmp_path, monkeypatch):
    class Process:
        returncode = None
        killed = False
        waited = False

        async def communicate(self):
            await asyncio.Event().wait()

        def kill(self):
            self.killed = True

        async def wait(self):
            self.waited = True
            self.returncode = -9

    process = Process()

    async def spawn(*_args, **kwargs):
        assert kwargs["stderr"] == asyncio.subprocess.DEVNULL
        return process

    monkeypatch.setattr(app.asyncio, "create_subprocess_exec", spawn)
    monkeypatch.setattr(app, "GIT_TIMEOUT_SECONDS", 0)
    with pytest.raises(app.WorkspaceError, match="timed out"):
        asyncio.run(app._git(tmp_path, os.environ.copy(), "clone"))
    assert process.killed and process.waited

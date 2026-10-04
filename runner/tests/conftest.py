from azure.ai.agentserver.invocations import InvocationAgentServerHost
import os
import subprocess

import pytest

_original_init = InvocationAgentServerHost.__init__


def _test_init(self, **kwargs):
    kwargs["configure_observability"] = None
    _original_init(self, **kwargs)


InvocationAgentServerHost.__init__ = _test_init


@pytest.fixture
def git_repository(tmp_path, monkeypatch):
    import app

    source = tmp_path / "source"
    source.mkdir()
    env = os.environ.copy()
    env.update({
        "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_AUTHOR_NAME": "Runner test", "GIT_AUTHOR_EMAIL": "runner@example.invalid",
        "GIT_COMMITTER_NAME": "Runner test", "GIT_COMMITTER_EMAIL": "runner@example.invalid",
    })

    def git(path, *args):
        return subprocess.check_output(
            ["git", *args], cwd=path, env=env, stderr=subprocess.DEVNULL, timeout=10,
        ).decode().strip()

    git(source, "init", "-b", "main")
    (source / "README").write_text("Project fixture\n")
    git(source, "add", "README")
    git(source, "commit", "-m", "Initial")
    monkeypatch.setattr(app, "_repository_url", lambda _repository: str(source))
    return source, env, git


@pytest.fixture
def local_workspace(git_repository, monkeypatch):
    import app

    original = app._prepare_workspace

    async def prepare(state, root, env):
        state.repository = state.repository or "owner/project"
        state.default_branch = state.default_branch or "main"
        state.branch = state.branch or "jarvis/task-42"
        return await original(state, root, env)

    monkeypatch.setattr(app, "_prepare_workspace", prepare)

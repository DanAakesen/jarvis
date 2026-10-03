import os
import subprocess
import tempfile
import unittest

from deploy_plan import changed_files, plan


def selected(result):
    return {part for part in ("infra", "backend", "web") if result[part]}


class DeployPlanTests(unittest.TestCase):
    def test_each_area_deploys_only_its_part(self):
        self.assertEqual(selected(plan("push", ["infra/main.bicep"])), {"infra"})
        self.assertEqual(selected(plan("push", ["apps/backend/src/app.ts"])), {"backend"})
        self.assertEqual(selected(plan("push", ["db/migrations/0001_init.sql"])), {"backend"})
        self.assertEqual(selected(plan("push", ["apps/web/src/App.tsx"])), {"web"})
        self.assertEqual(
            selected(plan("push", ["apps/web/config.json", "db/migrations/down/0001_init.sql"])),
            {"backend", "web"},
        )

    def test_bootstrap_ids_also_rebuild_the_web(self):
        self.assertEqual(selected(plan("push", ["infra/bootstrap.output.json"])), {"infra", "web"})

    def test_shared_files_deploy_everything(self):
        for path in (
            "package.json",
            "package-lock.json",
            "tsconfig.base.json",
            ".github/workflows/deploy.yml",
            ".github/workflows/ci.yml",
            ".github/scripts/deploy_smoke.py",
        ):
            with self.subTest(path=path):
                self.assertEqual(selected(plan("push", [path])), {"infra", "backend", "web"})

    def test_documentation_only_deploys_nothing(self):
        result = plan("push", ["README.md", "docs/architecture-flows.html", "apps/web/README.md", "infra/README.md"])
        self.assertEqual(selected(result), set())
        self.assertIn("no deployable changes", result["reason"])

    def test_other_components_deploy_nothing(self):
        self.assertEqual(selected(plan("push", ["runner/app.py", ".github/scripts/plan_status.py"])), set())

    def test_manual_run_and_unknown_base_deploy_everything(self):
        self.assertEqual(selected(plan("workflow_dispatch", ["README.md"])), {"infra", "backend", "web"})
        self.assertEqual(selected(plan("workflow_dispatch", [], superseded=True)), {"infra", "backend", "web"})
        self.assertEqual(selected(plan("push", None)), {"infra", "backend", "web"})

    def test_superseded_or_unchanged_push_deploys_nothing(self):
        self.assertEqual(selected(plan("push", [], superseded=True)), set())
        self.assertEqual(selected(plan("push", [])), set())


class ChangedFilesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.directory.name)
        for command in (
            ["git", "init", "-q"],
            ["git", "config", "user.email", "test@example.com"],
            ["git", "config", "user.name", "Test"],
        ):
            subprocess.run(command, check=True)

    def tearDown(self):
        os.chdir(self.previous)
        self.directory.cleanup()

    def commit(self, path):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write("x\n")
        subprocess.run(["git", "add", path], check=True)
        subprocess.run(["git", "commit", "-q", "-m", path], check=True)
        return subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()

    def test_diff_covers_every_commit_since_the_last_successful_deploy(self):
        base = self.commit("README.md")
        self.commit("apps/backend/src/app.ts")
        head = self.commit("docs/notes.md")
        self.assertEqual(changed_files(base, head), (["apps/backend/src/app.ts", "docs/notes.md"], False))

    def test_older_commit_than_last_deploy_is_superseded(self):
        older = self.commit("apps/web/a.ts")
        newer = self.commit("apps/web/b.ts")
        self.assertEqual(changed_files(newer, older), ([], True))

    def test_missing_base_is_unknown(self):
        head = self.commit("apps/web/a.ts")
        self.assertEqual(changed_files("", head), (None, False))
        self.assertEqual(changed_files("0" * 40, head), (None, False))


if __name__ == "__main__":
    unittest.main()

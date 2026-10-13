import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def normalize(title, linked_id=""):
    return subprocess.run(
        ["bash", ".github/scripts/normalize-pr-title.sh", title, linked_id],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=False,
    )


def linked_id(title):
    workflow = (ROOT / ".github/workflows/pr-title.yml").read_text(encoding="utf-8")
    line = next(line for line in workflow.splitlines() if "linked_id=$(gh issue view" in line)
    pattern = re.search(r"grep -oE '([^']+)'", line).group(1)
    return subprocess.run(
        ["bash", "-c", f"grep -oE '{pattern}' || true"],
        input=title, capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout.strip()


class PrTitleTests(unittest.TestCase):
    def test_full_task_ids_are_preserved_and_idempotent(self):
        for task_id in ("P0-05", "P9-101", "P9-12345", "P12-106", "P99-100"):
            title = f"{task_id}: Summary"
            with self.subTest(title=title):
                result = normalize(title)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), title)
                self.assertEqual(normalize(result.stdout.strip()).stdout.strip(), title)

    def test_brackets_wip_and_separators_keep_existing_behavior(self):
        for task_id in ("P0-05", "P9-101"):
            for title in (
                f"[{task_id}] Summary", f"{task_id} Summary",
                f"{task_id}:Summary", f"{task_id}-Summary",
                f"{task_id}\N{EM DASH}Summary", f"{task_id}\N{EN DASH}Summary",
                f"[WIP] [{task_id}] Summary", f"[WIP] {task_id}: Summary",
            ):
                with self.subTest(title=title):
                    expected = ("[WIP] " if title.startswith("[WIP]") else "") + f"{task_id}: Summary"
                    result = normalize(title)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout.strip(), expected)
                    self.assertEqual(normalize(expected).stdout.strip(), expected)

    def test_fix_main_docs_and_linked_fallback_are_preserved(self):
        for title in ("fix-main: Summary", "docs: Summary", "[WIP] docs: Summary", "[WIP] fix-main: Summary"):
            with self.subTest(title=title):
                self.assertEqual(normalize(title).stdout.strip(), title)
        for title in ("Summary", "[WIP] Summary"):
            with self.subTest(title=title):
                expected = ("[WIP] " if title.startswith("[WIP]") else "") + "P9-101: Summary"
                self.assertEqual(normalize(title, linked_id("P9-101: Status page")).stdout.strip(), expected)
                self.assertEqual(normalize(expected).stdout.strip(), expected)

    def test_an_id_boundary_and_nonempty_summary_are_required(self):
        for title in ("P0-05", "P9-101", "P9-101x: Summary", "P9-101_suffix: Summary", "No task ID"):
            with self.subTest(title=title):
                self.assertEqual(normalize(title).returncode, 1)

    def test_workflow_extracts_whole_linked_ids(self):
        for title, expected in (
            ("P0-05: Summary", "P0-05"), ("P9-101: Summary", "P9-101"),
            ("P12-106 Summary", "P12-106"), ("P9-12345: Summary", "P9-12345"),
            ("P9-101", "P9-101"), ("P9-101x: Summary", ""),
            ("P9-101_suffix: Summary", ""), ("No task ID", ""),
        ):
            with self.subTest(title=title):
                self.assertEqual(linked_id(title), expected)


if __name__ == "__main__":
    unittest.main()

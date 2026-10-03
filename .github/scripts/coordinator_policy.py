"""Pure, fail-closed eligibility rules for the periodic GitHub coordinator.

API access, pagination, fresh reads, ancestry checks and side effects belong to
the caller. These rules never trust GitHub search's ``is:blocked`` filtering.
"""

from __future__ import annotations

import re
from pathlib import PurePosixPath
from typing import Any

TASK_ID = r"P[0-6]-[0-9]{2}"
TASK_TITLE = re.compile(rf"^({TASK_ID}): \S[^\n]*$")
WORKER_LABELS = frozenset({"codex", "jarvis", "dan", "copilot"})
REPOSITORY = "DanAakesen/jarvis"


def issue_task_id(title: str) -> str | None:
    """Recognize the repository's exact issue/task title format."""
    match = TASK_TITLE.fullmatch(title)
    return match.group(1) if match else None


def _cells(line: str) -> list[str]:
    # Escaped pipes are allowed in Markdown table prose.
    return [cell.strip().replace(r"\|", "|") for cell in re.split(r"(?<!\\)\|", line.strip().strip("|"))]


def parse_plan(markdown: str) -> dict[str, dict[str, Any]]:
    """Read task tables only; malformed/duplicate task rows abort coordination."""
    result: dict[str, dict[str, Any]] = {}
    columns: list[str] | None = None
    for line in markdown.splitlines():
        if not line.lstrip().startswith("|"):
            columns = None
            continue
        cells = _cells(line)
        if cells and cells[0].casefold() == "id":
            columns = [re.sub(r"\s+", " ", cell).casefold() for cell in cells]
            # The Issue column was added by plan-status. Positional guessing
            # would silently treat the issue link as the task/dependencies.
            accepted = {"acceptance", "acceptance criteria"}
            if not (
                len(columns) == 5 and columns[:2] == ["id", "task"]
                and columns[2] in accepted and columns[3:] == ["depends on", "status"]
                or len(columns) == 6 and columns[:3] == ["id", "issue", "task"]
                and columns[3] in accepted and columns[4:] == ["depends on", "status"]
            ):
                columns = None
            continue
        if not cells or not re.fullmatch(TASK_ID, cells[0]):
            continue
        if columns is None or len(cells) != len(columns) or cells[0] in result:
            raise ValueError(f"Malformed or duplicate PLAN task: {cells[0]}")
        row = dict(zip(columns, cells, strict=True))
        task_id, title, dependencies = row["id"], row["task"], row["depends on"]
        if "issue" in row and row["issue"] not in {"", "—", "–", "-"}:
            issue_link = re.fullmatch(
                r"\[#([1-9][0-9]*)\]\(https://github\.com/DanAakesen/jarvis/issues/([1-9][0-9]*)\)",
                row["issue"], re.IGNORECASE,
            )
            if issue_link is None or issue_link[1] != issue_link[2]:
                raise ValueError(f"Invalid PLAN issue link: {task_id}")
        status = {
            "notstarted": "Not started", "inprogress": "In progress",
            "blocked": "Blocked", "complete": "Complete",
        }.get(re.sub(r"\s+", "", row["status"].strip("* ")).casefold())
        if not title or status is None:
            raise ValueError(f"Invalid PLAN task: {task_id}")
        deps = []
        if dependencies not in {"", "—", "–", "-", "None"}:
            for item in dependencies.split(","):
                item = item.strip()
                if re.fullmatch(TASK_ID, item):
                    deps.append(item)
                    continue
                bounds = re.fullmatch(rf"({TASK_ID})\s*(?:…|\.\.\.|–)\s*({TASK_ID})", item)
                if not bounds:
                    raise ValueError(f"Invalid PLAN dependencies: {task_id}")
                start_phase, start_number = bounds[1].split("-")
                end_phase, end_number = bounds[2].split("-")
                if start_phase != end_phase or int(start_number) > int(end_number):
                    raise ValueError(f"Invalid PLAN dependency range: {task_id}")
                deps.extend(f"{start_phase}-{number:02}" for number in range(int(start_number), int(end_number) + 1))
        result[task_id] = {"title": title, "deps": deps, "status": status}
    if not result:
        raise ValueError("PLAN contains no task rows")
    return result


def closing_issue_numbers(body: str, repository: str = REPOSITORY) -> set[int]:
    """Recognize GitHub closing keywords, restricting cross-repo references.

    Comments/code can look like closing references; treating those as claimed is
    deliberately conservative. A linked issue must never be assigned twice.
    """
    pattern = re.compile(
        r"\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+"
        r"(?:https://github\.com/(?P<url_repo>[\w.-]+/[\w.-]+)/issues/"
        r"|(?:(?P<repo>[\w.-]+/[\w.-]+))?#)(?P<number>[1-9][0-9]*)\b",
        re.IGNORECASE,
    )
    numbers = set()
    for match in pattern.finditer(body):
        target = match.group("url_repo") or match.group("repo")
        if target is None or target.casefold() == repository.casefold():
            numbers.add(int(match.group("number")))
    return numbers


def ready_issue(
    issue: dict[str, Any],
    plan: dict[str, dict[str, Any]],
    issues_by_task: dict[str, dict[str, Any]],
    open_pr_bodies: list[str],
) -> tuple[bool, str]:
    """PLAN and current issue data must both permit a new Copilot assignment."""
    if str(issue.get("state", "")).casefold() != "open":
        return False, "issue is not open"
    task_id = issue_task_id(issue.get("title", ""))
    task = plan.get(task_id or "")
    if task is None:
        return False, "issue has no exact PLAN task"
    if task.get("status") != "Not started":
        return False, "PLAN task is not Not started"
    labels = {str(label.get("name", "") if isinstance(label, dict) else label).casefold() for label in issue.get("labels", [])}
    if labels & WORKER_LABELS:
        return False, "issue has a worker label"
    if issue.get("assignees"):
        return False, "issue has an assignee"
    number = issue.get("number")
    if not isinstance(number, int) or number <= 0:
        return False, "issue number is missing"
    if any(number in closing_issue_numbers(body) for body in open_pr_bodies):
        return False, "issue has a linked open PR"
    for dependency in task.get("deps", []):
        prerequisite = plan.get(dependency)
        if prerequisite is None or prerequisite.get("status") != "Complete":
            return False, f"PLAN dependency {dependency} is incomplete or missing"
        dependency_issue = issues_by_task.get(dependency)
        if dependency_issue is None or str(dependency_issue.get("state", "")).casefold() != "closed":
            return False, f"GitHub dependency {dependency} is not confirmed closed"
    return True, "ready"


def latest_workflow_runs_green(
    runs: list[dict[str, Any]],
    main_sha: str,
    required_workflows: tuple[str, ...] = ("CI",),
) -> bool:
    """Latest attempt of every required workflow must pass at current main."""
    if not main_sha or not required_workflows:
        return False
    for name in required_workflows:
        matches = [run for run in runs if run.get("name") == name and run.get("head_sha") == main_sha]
        if not matches:
            return False
        latest = max(matches, key=lambda run: (run.get("run_number", 0), run.get("run_attempt", 0), run.get("id", 0)))
        if latest.get("status") != "completed" or latest.get("conclusion") != "success":
            return False
    return True


def docs_only(files: list[str]) -> bool:
    if not files:
        return False
    root_docs = {"AGENTS.md", "CLAUDE.md", "README.md", "PRODUCT.md", "DESIGN.md", "PLAN.md", "LICENSE"}
    extensions = {".md", ".rst", ".txt", ".html", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"}
    return all(
        isinstance(file, str)
        and ".." not in PurePosixPath(file).parts
        and (file in root_docs or (file.startswith("docs/") and PurePosixPath(file).suffix.lower() in extensions))
        for file in files
    )


def latest_checks(checks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Use the latest check rerun by API id when ordering is unambiguous.

    If duplicate names have no ids, keep all so any pending/failure prevents a
    merge; the caller may normalize legacy statuses with known ordering.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    for check in checks:
        grouped.setdefault(check.get("name", ""), []).append(check)
    result = []
    for group in grouped.values():
        if len(group) > 1 and all(isinstance(check.get("id"), int) for check in group):
            result.append(max(group, key=lambda check: (check.get("id", 0), check.get("run_attempt", 0))))
        else:
            result.extend(group)
    return result


def decide_merge(
    pr: dict[str, Any],
    main_sha: str,
    main_green: bool,
    checks: list[dict[str, Any]],
    unresolved_reviews: bool,
    copilot_finished: bool,
) -> str:
    """Return ``ready`` only when all normalized merge evidence is positive.

    ``main_integrated`` is an ancestry result for ``integrated_main_sha``. The
    caller must re-read main and head before the SHA-guarded merge mutation.
    Check objects use REST names/status/conclusion/head_sha; latest attempts
    must be supplied by the caller, including legacy status contexts.
    """
    if str(pr.get("state", "")).casefold() != "open":
        return "PR is not open"
    if pr.get("isDraft", pr.get("draft", True)) is not False:
        return "PR is draft or draft state is unknown"
    title = pr.get("title", "")
    fix_main = bool(re.fullmatch(r"fix-main: \S[^\n]*", title))
    docs = bool(re.fullmatch(r"docs: \S[^\n]*", title))
    if not (issue_task_id(title) or fix_main or docs):
        return "PR title is not approved"
    if docs and not docs_only(pr.get("files", [])):
        return "docs PR changes files outside documentation"
    if pr.get("baseRefName") != "main" or pr.get("headRepositorySameAsBase") is not True:
        return "PR does not target same-repository main"
    if not main_green and not fix_main:
        return "main checks are not green"
    if not main_sha or pr.get("main_integrated") is not True or pr.get("integrated_main_sha") != main_sha:
        return "PR does not contain current main"
    if pr.get("mergeable") != "MERGEABLE":
        return "PR mergeability is not confirmed"
    if unresolved_reviews is not False or any(str(review.get("state", "")).upper() == "CHANGES_REQUESTED" for review in pr.get("reviews", [])):
        return "PR has unresolved review findings"
    if copilot_finished is not True:
        return "Copilot session is active or completion is unknown"
    head = pr.get("headRefOid")
    if not head or not checks:
        return "PR checks are missing"
    if any(check.get("head_sha") != head for check in checks):
        return "PR check evidence is for another head"
    checks = latest_checks(checks)
    gate = [check for check in checks if check.get("name") == "CI result"]
    if not gate or any(check.get("status") != "completed" or check.get("conclusion") != "success" for check in gate):
        return "CI result has not passed at current head"
    if any(check.get("status") != "completed" or check.get("conclusion") not in {"success", "skipped", "neutral"} for check in checks):
        return "PR has failing, pending or unknown checks"
    return "ready"

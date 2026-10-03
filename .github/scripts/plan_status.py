#!/usr/bin/env python3
"""Reconcile task statuses in PLAN.md with GitHub issues and pull requests."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

TASK_ID = re.compile(r"P\d-\d{2}")
ISSUE_TITLE = re.compile(r"^(P\d-\d{2}):\s*(.+)$")
FIXES_ISSUE = re.compile(r"\bFixes\s+#(\d+)\b", re.IGNORECASE)
DEPENDENCY_RANGE = re.compile(
    r"(P\d)-(\d{2})\s*(?:…|\.{3}|–|-)\s*(?:P\d-)?(\d{2})"
)
WORKER_LABELS = {"Codex", "Copilot", "Dan", "Jarvis"}


def flatten_pages(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [item for nested in value for item in flatten_pages(nested)]
    return []


def dependencies_from_text(value: str) -> list[str]:
    dependencies: list[str] = []
    for match in DEPENDENCY_RANGE.finditer(value):
        phase, start, end = match.groups()
        dependencies.extend(f"{phase}-{number:02}" for number in range(int(start), int(end) + 1))
    without_ranges = DEPENDENCY_RANGE.sub("", value)
    dependencies.extend(TASK_ID.findall(without_ranges))
    return list(dict.fromkeys(dependencies))


def plan_tasks(plan: str) -> list[dict[str, Any]]:
    tasks = []
    columns: dict[str, int] = {}
    for line in plan.splitlines():
        cells = [cell.strip() for cell in line.split("|")[1:-1]]
        if "ID" in cells and "Task" in cells and "Status" in cells:
            columns = {name: index for index, name in enumerate(cells)}
            continue
        if not columns or not re.match(r"^\|\s*P\d-\d{2}\s*\|", line):
            continue
        if len(cells) <= max(columns.values()):
            continue
        task_id = cells[columns["ID"]]
        task = cells[columns["Task"]]
        acceptance = cells[columns["Acceptance criteria"]]
        depends_on = cells[columns["Depends on"]]
        tasks.append(
            {
                "id": task_id,
                "issue": cells[columns["Issue"]] if "Issue" in columns else "",
                "task": task,
                "acceptance": acceptance,
                "depends_on": depends_on,
                "dependencies": dependencies_from_text(depends_on),
                "status": cells[columns["Status"]],
            }
        )
    return tasks


def task_issue_map(issues: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    mapped = {}
    for issue in issues:
        if "pull_request" in issue:
            continue
        match = ISSUE_TITLE.match(issue.get("title", ""))
        if match:
            mapped.setdefault(match.group(1), issue)
    return mapped


def task_status(
    current: str,
    issue: dict[str, Any] | None,
    pull_requests: list[dict[str, Any]],
) -> str:
    if issue is None:
        return current

    issue_number = issue.get("number")
    linked_prs = [
        pull
        for pull in pull_requests
        if issue_number is not None
        and issue_number in (int(number) for number in FIXES_ISSUE.findall(pull.get("body") or ""))
    ]
    if any(pull.get("merged_at") for pull in linked_prs):
        return "Complete"
    if issue.get("state") == "closed" and issue.get("state_reason") == "completed":
        return "Complete"
    if current == "Blocked":
        return current
    open_pr = any(pull.get("state") == "open" for pull in linked_prs)
    labels = {label.get("name") for label in issue.get("labels", [])}
    worker_claimed = issue.get("state") == "open" and bool(labels & WORKER_LABELS)
    if open_pr or worker_claimed:
        return "In progress"
    if issue.get("state") == "open":
        return "Not started"
    return current


def issue_link(issue: dict[str, Any] | None, repository: str) -> str:
    if issue is None:
        return ""
    return f'[#{issue["number"]}](https://github.com/{repository}/issues/{issue["number"]})'


def reconcile_plan(
    plan: str,
    issues: list[dict[str, Any]],
    pull_requests: list[dict[str, Any]],
    repository: str = "DanAakesen/jarvis",
) -> str:
    issue_by_task = task_issue_map(issues)
    rows = []
    columns: dict[str, int] = {}
    for line in plan.splitlines(keepends=True):
        cells = [cell.strip() for cell in line.split("|")[1:-1]]
        if "ID" in cells and "Task" in cells and "Status" in cells:
            columns = {name: index for index, name in enumerate(cells)}
            rows.append(line)
            continue
        if not columns or not re.match(r"^\|\s*P\d-\d{2}\s*\|", line):
            rows.append(line)
            continue
        if len(cells) <= max(columns.values()):
            rows.append(line)
            continue
        task_id = cells[columns["ID"]]
        issue = issue_by_task.get(task_id)
        replacements = {"Status": task_status(cells[columns["Status"]], issue, pull_requests)}
        if "Issue" in columns:
            replacements["Issue"] = issue_link(issue, repository)

        parts = line.split("|")
        for name, updated in replacements.items():
            cell_index = columns[name] + 1
            cell = parts[cell_index]
            current = cell.strip()
            if current == updated:
                continue
            if not updated:
                parts[cell_index] = " "
                continue
            parts[cell_index] = f" {updated} "
        rows.append("|".join(parts))
    return "".join(rows)


def issue_title(task: dict[str, Any]) -> str:
    summary = re.sub(r"\*+", "", task["task"].split(":", 1)[0]).strip()
    if not summary:
        summary = task["task"].strip()
    return f'{task["id"]}: {summary[:200]}'


def issue_body(task: dict[str, Any], repository: str) -> str:
    dependencies = task["depends_on"] or "None"
    return f"""**Task:** {task["task"]}

**Acceptance criteria:** {task["acceptance"]}

**Depends on:** {dependencies}

Source of truth: [PLAN.md](https://github.com/{repository}/blob/main/PLAN.md). Follow the [development workflow](https://github.com/{repository}/blob/main/docs/agent-context.md#development-workflow).

### Before you start
Claim this issue first by setting your worker label (`Codex`, `Copilot`, `Dan`, or `Jarvis`); see step 1 of [Start a task](https://github.com/{repository}/blob/main/docs/agent-context.md#start-a-task). If it already has another worker's label, the task is taken: stop.

### Definition of done
- [ ] PR title is exactly `{issue_title(task)}` (ID, colon, space; no brackets); PR body contains `Fixes #<n>`
- [ ] Acceptance criteria met; the commands you ran and their results are in the PR body, plus what remains unverified
- [ ] `PLAN.md`: this task's Status set to Complete; Current focus updated
- [ ] Update every document required by the [finish table](https://github.com/{repository}/blob/main/docs/agent-context.md#finish-a-task)
- [ ] New or changed tasks added to `PLAN.md`, and their issues and "Blocked by" links updated (or listed in the PR body)
- [ ] Mark the PR ready for review when done
"""


def new_tasks(plan: str, issues: list[dict[str, Any]], repository: str) -> list[dict[str, Any]]:
    issue_ids = task_issue_map(issues)
    result = []
    for task in plan_tasks(plan):
        if task["id"] in issue_ids:
            continue
        result.append(
            {
                "task_id": task["id"],
                "title": issue_title(task),
                "body": issue_body(task, repository),
                "labels": [task["id"].split("-")[0]],
                "depends_on": task["dependencies"],
            }
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--issues", required=True, type=Path)
    parser.add_argument("--pull-requests", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--new-tasks", required=True, type=Path)
    parser.add_argument("--tasks-output", required=True, type=Path)
    parser.add_argument("--repository", required=True)
    args = parser.parse_args()

    plan = args.plan.read_text(encoding="utf-8")
    issues = flatten_pages(json.loads(args.issues.read_text(encoding="utf-8")))
    pull_requests = flatten_pages(
        json.loads(args.pull_requests.read_text(encoding="utf-8"))
    )
    args.output.write_text(
        reconcile_plan(plan, issues, pull_requests, args.repository), encoding="utf-8"
    )
    args.new_tasks.write_text(
        json.dumps(new_tasks(plan, issues, args.repository), indent=2) + "\n",
        encoding="utf-8",
    )
    args.tasks_output.write_text(
        json.dumps(plan_tasks(plan), indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()

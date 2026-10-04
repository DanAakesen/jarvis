"""Sync the Status of open task issues on the Jarvis GitHub Project board.

Board columns (the project's Status field):
  Backlog      open issue still blocked by an open issue
  Ready        open, not blocked, no worker label, no open linked PR
  In progress  open issue with a worker label (Codex, Copilot, Dan, Jarvis) or an open draft PR
  In review    open issue with an open, non-draft linked PR
  Done         closed issue; the project's built-in "Item closed" workflow sets it, and
               this script restores it when a run raced with the close (L60)

The script reconciles every open issue and every closed issue already on the board
on each run, so it is idempotent and only writes items whose Status differs. Part of P0-13.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any

WORKER_LABELS = {"Codex", "Copilot", "Dan", "Jarvis"}
LINKED_ISSUE = re.compile(r"\b(?:fixes|closes|resolves)\s+#(\d+)\b", re.IGNORECASE)
STATUSES = ("Backlog", "Ready", "In progress", "In review")
API = "https://api.github.com"


def linked_issue_numbers(body: str | None) -> set[int]:
    return {int(number) for number in LINKED_ISSUE.findall(body or "")}


def desired_status(issue: dict[str, Any], open_pulls: list[dict[str, Any]]) -> str:
    """Return the board column for an open issue."""
    linked = [pull for pull in open_pulls if issue["number"] in linked_issue_numbers(pull.get("body"))]
    if any(not pull.get("draft") for pull in linked):
        return "In review"
    labels = {label.get("name") for label in issue.get("labels", [])}
    if linked or labels & WORKER_LABELS:
        return "In progress"
    if (issue.get("issue_dependencies_summary") or {}).get("blocked_by", 0) > 0:
        return "Backlog"
    return "Ready"


def items_to_mark_done(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return board items for closed issues whose Status is not Done."""
    stale = []
    for item in items:
        content = item.get("content") or {}
        status = (item.get("fieldValueByName") or {}).get("name")
        if content.get("state") == "CLOSED" and status != "Done":
            stale.append(item)
    return stale


def _request(url: str, token: str, payload: dict[str, Any] | None = None) -> tuple[Any, str]:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read() or b"null"), response.headers.get("Link", "")
    except urllib.error.HTTPError as error:
        raise SystemExit(f"GitHub API {error.code} for {url.split('?')[0]}") from None


def rest_list(path: str, token: str) -> list[dict[str, Any]]:
    url = f"{API}{path}"
    items: list[dict[str, Any]] = []
    while url:
        page, link = _request(url, token)
        items.extend(page)
        match = re.search(r'<([^>]+)>;\s*rel="next"', link)
        url = match.group(1) if match else ""
    return items


def graphql(token: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
    result, _ = _request(f"{API}/graphql", token, {"query": query, "variables": variables})
    if result.get("errors"):
        messages = "; ".join(error.get("message", "?") for error in result["errors"])
        raise SystemExit(f"GraphQL error: {messages}")
    return result["data"]


PROJECT_QUERY = """
query($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      field(name: "Status") {
        ... on ProjectV2SingleSelectField { id options { id name } }
      }
    }
  }
}
"""

ADD_ITEM = """
mutation($project: ID!, $content: ID!) {
  addProjectV2ItemById(input: {projectId: $project, contentId: $content}) {
    item {
      id
      fieldValueByName(name: "Status") {
        ... on ProjectV2ItemFieldSingleSelectValue { name }
      }
    }
  }
}
"""

ITEMS_QUERY = """
query($project: ID!, $cursor: String) {
  node(id: $project) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          content { ... on Issue { number state } }
        }
      }
    }
  }
}
"""

SET_STATUS = """
mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: {singleSelectOptionId: $option}
  }) { projectV2Item { id } }
}
"""


def main() -> None:
    repository = os.environ["REPOSITORY"]
    owner = os.environ["PROJECT_OWNER"]
    number = int(os.environ["PROJECT_NUMBER"])
    repo_token = os.environ["REPO_TOKEN"]
    project_token = os.environ["PROJECT_TOKEN"]
    # DRY_RUN=1 skips Status writes; missing issues are still added to the board.
    dry_run = os.environ.get("DRY_RUN") == "1"

    project = graphql(project_token, PROJECT_QUERY, {"owner": owner, "number": number})["user"]["projectV2"]
    if project is None or not project.get("field"):
        raise SystemExit(f"Project {owner}/{number} or its Status field was not found.")
    options = {option["name"]: option["id"] for option in project["field"]["options"]}
    missing = [status for status in (*STATUSES, "Done") if status not in options]
    if missing:
        raise SystemExit(f"Status field lacks options: {', '.join(missing)}")

    issues = [issue for issue in rest_list(f"/repos/{repository}/issues?state=open&per_page=100", repo_token)
              if "pull_request" not in issue]
    open_pulls = rest_list(f"/repos/{repository}/pulls?state=open&per_page=100", repo_token)

    changed = 0
    for issue in issues:
        status = desired_status(issue, open_pulls)
        # addProjectV2ItemById returns the existing item when the issue is already on the board.
        item = graphql(project_token, ADD_ITEM, {"project": project["id"], "content": issue["node_id"]})
        item = item["addProjectV2ItemById"]["item"]
        current = (item.get("fieldValueByName") or {}).get("name")
        if current == status:
            continue
        print(f"#{issue['number']}: {current or '(none)'} -> {status}")
        changed += 1
        if not dry_run:
            graphql(project_token, SET_STATUS, {
                "project": project["id"], "item": item["id"],
                "field": project["field"]["id"], "option": options[status],
            })
    items: list[dict[str, Any]] = []
    cursor = None
    while True:
        page = graphql(project_token, ITEMS_QUERY, {"project": project["id"], "cursor": cursor})["node"]["items"]
        items.extend(page["nodes"])
        if not page["pageInfo"]["hasNextPage"]:
            break
        cursor = page["pageInfo"]["endCursor"]
    for item in items_to_mark_done(items):
        current = (item.get("fieldValueByName") or {}).get("name")
        print(f"#{item['content']['number']}: {current or '(none)'} -> Done (closed)")
        changed += 1
        if not dry_run:
            graphql(project_token, SET_STATUS, {
                "project": project["id"], "item": item["id"],
                "field": project["field"]["id"], "option": options["Done"],
            })
    print(f"{len(issues)} open issues checked, {changed} moved{' (dry run)' if dry_run else ''}.")


if __name__ == "__main__":
    sys.exit(main())

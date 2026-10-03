"""Reconcile the "Copilot" worker label on open task issues. Part of P0-13.

Copilot cloud agent can't edit labels, so this script sets its claim label from current
GitHub state. Every run recomputes all open issues, so overlapping runs can't undo each
other: the latest run is always correct.

An open issue carries "Copilot" exactly when
  - an open Copilot PR links it (Fixes/Closes/Resolves #n), or
  - it is assigned to Copilot and no Copilot PR linked to it has been closed unmerged
    (Copilot was just started and hasn't opened its PR yet).
Closed issues are never changed: their label records who did the work.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

LABEL = "Copilot"
COPILOT_LOGIN = "Copilot"
LINKED_ISSUE = re.compile(r"\b(?:fixes|closes|resolves)\s+#(\d+)\b", re.IGNORECASE)
API = "https://api.github.com"


def linked_issue_numbers(body: str | None) -> set[int]:
    return {int(number) for number in LINKED_ISSUE.findall(body or "")}


def wants_label(issue: dict[str, Any], copilot_pulls: list[dict[str, Any]]) -> bool:
    linked = [pull for pull in copilot_pulls if issue["number"] in linked_issue_numbers(pull.get("body"))]
    if any(pull.get("state") == "open" for pull in linked):
        return True
    assigned = any(assignee.get("login") == COPILOT_LOGIN for assignee in issue.get("assignees", []))
    abandoned = any(pull.get("state") == "closed" and not pull.get("merged_at") for pull in linked)
    return assigned and not abandoned


def label_changes(
    issues: list[dict[str, Any]], copilot_pulls: list[dict[str, Any]]
) -> list[tuple[int, bool]]:
    """Return (issue number, add?) for open issues whose Copilot label must change."""
    changes = []
    for issue in issues:
        if "pull_request" in issue or issue.get("state") != "open":
            continue
        has = any(label.get("name") == LABEL for label in issue.get("labels", []))
        wanted = wants_label(issue, copilot_pulls)
        if has != wanted:
            changes.append((issue["number"], wanted))
    return changes


def _request(method: str, url: str, token: str, payload: Any = None) -> tuple[Any, str]:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
            return (json.loads(body) if body else None), response.headers.get("Link", "")
    except urllib.error.HTTPError as error:
        raise SystemExit(f"GitHub API {error.code} for {method} {url.split('?')[0]}") from None


def rest_list(path: str, token: str) -> list[dict[str, Any]]:
    url, items = f"{API}{path}", []
    while url:
        page, link = _request("GET", url, token)
        items.extend(page)
        match = re.search(r'<([^>]+)>;\s*rel="next"', link)
        url = match.group(1) if match else ""
    return items


def main() -> None:
    repository = os.environ["REPOSITORY"]
    token = os.environ["GH_TOKEN"]
    issues = rest_list(f"/repos/{repository}/issues?state=open&per_page=100", token)
    pulls = rest_list(f"/repos/{repository}/pulls?state=all&per_page=100", token)
    copilot_pulls = [pull for pull in pulls if (pull.get("user") or {}).get("login") == COPILOT_LOGIN]

    changes = label_changes(issues, copilot_pulls)
    for number, add in changes:
        if add:
            _request("POST", f"{API}/repos/{repository}/issues/{number}/labels", token, {"labels": [LABEL]})
        else:
            name = urllib.parse.quote(LABEL)
            _request("DELETE", f"{API}/repos/{repository}/issues/{number}/labels/{name}", token)
        print(f"#{number}: {'added' if add else 'removed'} {LABEL}")
    print(f"{len(issues)} open issues checked, {len(changes)} label changes.")


if __name__ == "__main__":
    sys.exit(main())

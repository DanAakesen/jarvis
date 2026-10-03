"""Reconcile PRs from trusted default-branch code.

One merge per run, serialized by Actions, keeps each following decision tied to
the freshly tested main. No PR code or workflow artifact is executed here.
"""

from __future__ import annotations

import argparse
import base64
import os
import re
from pathlib import Path
from urllib.parse import quote

from coordinator_api import APIError, GitHub
from coordinator_policy import (
    decide_merge,
    docs_only,
    issue_task_id,
    latest_workflow_runs_green,
    parse_plan,
)

HOLD_LABEL = "automation:hold"
MARKER = "jarvis-coordinator-repair"
PR_QUERY = """
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner,name:$name) {
    pullRequest(number:$number) {
      reviewDecision
      reviewThreads(first:100) {
        nodes { isResolved }
        pageInfo { hasNextPage }
      }
    }
  }
}
"""


def label_names(item):
    return {label["name"].casefold() for label in item.get("labels", [])}


def copilot_activity(timeline, author):
    events = [event for event in timeline if event.get("event", "").startswith("copilot_work_")]
    if events:
        return events[-1].get("event") == "copilot_work_finished"
    return author.casefold() not in {"copilot", "copilot-swe-agent", "copilot-swe-agent[bot]"}


class Coordinator:
    def __init__(self, api, dry_run=False, summary=None):
        self.api = api
        self.prefix = f"/repos/{api.repo}"
        self.dry_run = dry_run
        self.summary = summary
        self.lines = []

    def report(self, text):
        # Only our own fixed text, GitHub numbers and safe enum reasons are used.
        self.lines.append(text)
        print(text)

    def read_plan(self, sha):
        data = self.api.request("GET", f"{self.prefix}/contents/PLAN.md?ref={sha}")
        if data.get("encoding") != "base64":
            raise APIError("PLAN encoding unavailable")
        return parse_plan(base64.b64decode(data["content"]).decode("utf-8"))

    def main_sha(self):
        return self.api.request("GET", f"{self.prefix}/git/ref/heads/main")["object"]["sha"]

    def runs(self, branch, sha=None):
        path = f"{self.prefix}/actions/workflows/ci.yml/runs?branch={quote(branch, safe='')}"
        if sha:
            path += f"&head_sha={sha}"
        return self.api.pages(path, key="workflow_runs")

    def main_green(self, sha, plan):
        runs = self.runs("main", sha)
        if not latest_workflow_runs_green(runs, sha):
            return False
        # Before #11 only aggregate CI is mandatory. Once deployed, its latest
        # deployment runs also gate new work; docs-only changes need no deploy.
        if plan.get("P0-11", {}).get("status") == "Complete":
            workflows = self.deployment_workflows()
            if not workflows:
                return False
            for workflow in workflows:
                data = self.api.request("GET", f"{self.prefix}/actions/workflows/{workflow['id']}/runs?branch=main&per_page=1")
                if not data["workflow_runs"]:
                    return False
                latest = data["workflow_runs"][0]
                if latest.get("status") != "completed" or latest.get("conclusion") != "success":
                    return False
        return True

    def deployment_workflows(self):
        workflows = self.api.pages(f"{self.prefix}/actions/workflows", key="workflows")
        paths = {entry["name"] for entry in self.api.request("GET", f"{self.prefix}/contents/.github/workflows?ref=main")}
        return [workflow for workflow in workflows if "deploy" in workflow["name"].casefold()
                and workflow["path"].rsplit("/", 1)[-1] in paths]


    def pull_detail(self, number, main_sha):
        pr = self.api.request("GET", f"{self.prefix}/pulls/{number}")
        head = pr["head"]["sha"]
        files = self.api.pages(f"{self.prefix}/pulls/{number}/files")
        timeline = self.api.pages(f"{self.prefix}/issues/{number}/timeline")
        comments = self.api.pages(f"{self.prefix}/issues/{number}/comments")
        owner, name = self.api.repo.split("/")
        data = self.api.graphql(PR_QUERY, {"owner": owner, "name": name, "number": number})
        reviews = data["repository"]["pullRequest"]
        unresolved = (reviews["reviewDecision"] == "CHANGES_REQUESTED"
                      or reviews["reviewThreads"]["pageInfo"]["hasNextPage"]
                      or any(not thread["isResolved"] for thread in reviews["reviewThreads"]["nodes"]))
        same_repo = (pr["head"].get("repo") or {}).get("full_name") == self.api.repo
        integrated = False
        if same_repo:
            comparison = self.api.request("GET", f"{self.prefix}/compare/{main_sha}...{head}")
            integrated = comparison.get("merge_base_commit", {}).get("sha") == main_sha
        pr.update({
            "baseRefName": pr["base"]["ref"], "headRefOid": head,
            "headRepositorySameAsBase": same_repo,
            "main_integrated": integrated, "integrated_main_sha": main_sha,
            "mergeable": {True: "MERGEABLE", False: "CONFLICTING"}.get(pr["mergeable"], "UNKNOWN"),
            "files": [path for file in files
                      for path in ([file["filename"], file["previous_filename"]]
                                   if file.get("previous_filename") else [file["filename"]])],
            "copilot_tracked": any(event.get("event", "").startswith("copilot_work_") for event in timeline),
        })
        checks = self.api.pages(f"{self.prefix}/commits/{head}/check-runs?filter=latest", key="check_runs")
        for status in self.api.pages(f"{self.prefix}/commits/{head}/statuses"):
            checks.append({"name": status["context"], "id": status["id"], "head_sha": head,
                           "status": "in_progress" if status["state"] == "pending" else "completed",
                           "conclusion": "success" if status["state"] == "success" else "failure"})
        # A check with the right name alone is insufficient; require the trusted
        # aggregate workflow run for this exact head, including branch updates.
        runs = self.runs(pr["head"]["ref"], head)
        ci = [run for run in runs if run.get("path", "").split("@", 1)[0] == ".github/workflows/ci.yml"]
        workflow_green = latest_workflow_runs_green(ci, head)
        pr["ci_present"] = bool(ci)
        finished = copilot_activity(timeline, pr["user"]["login"])
        # An accepted request may not have a work-started event yet. Keep that
        # gap closed until a later completion event confirms the repair ended.
        pending = [comment for comment in comments if f"<!-- {MARKER}:" in (comment.get("body") or "")]
        completions = [event.get("created_at", "") for event in timeline
                       if event.get("event") == "copilot_work_finished"]
        if pending and max(comment["created_at"] for comment in pending) >= max(completions, default=""):
            finished = False
        return pr, checks, unresolved, finished, workflow_green, comments

    def dispatch(self, workflow, ref):
        self.api.request("POST", f"{self.prefix}/actions/workflows/{quote(workflow, safe='')}/dispatches",
                         {"ref": ref})

    def after_merge(self, files):
        # A user-token merge emits push events naturally. With GITHUB_TOKEN,
        # explicitly dispatch CI and existing applicable deployment workflows.
        if self.api.copilot_token:
            return
        self.dispatch("ci.yml", "main")
        docs_only = all(file.endswith(".md") or file.startswith("docs/") for file in files)
        if docs_only:
            return
        shared = any(file in {"package.json", "package-lock.json"} or file.startswith(".github/workflows/")
                     for file in files)
        for workflow in self.deployment_workflows():
            filename = workflow["path"].rsplit("/", 1)[-1]
            if filename == "runner-deploy.yml" and not (shared or any(file.startswith("runner/") for file in files)):
                continue
            self.dispatch(filename, "main")

    def reconcile_prs(self, pulls, sha, plan, green):
        for item in sorted(pulls, key=lambda item: item["number"]):
            number = item["number"]
            try:
                if HOLD_LABEL in label_names(item):
                    self.report(f"PR #{number}: on hold.")
                    continue
                pr, checks, unresolved, finished, workflow_green, comments = self.pull_detail(number, sha)
                reason = decide_merge(pr, sha, green, checks, unresolved, finished)
                if not workflow_green and reason == "ready":
                    reason = "aggregate CI workflow has not passed at current head"
                if reason == "ready":
                    if self.dry_run:
                        self.report(f"PR #{number}: would squash-merge.")
                        continue
                    # Re-read mutable state immediately before the SHA-guarded
                    # mutation. One merge per run prevents stale main decisions.
                    if self.main_sha() != sha:
                        self.report("Main changed; defer remaining actions to the next run.")
                        return True
                    fresh, fresh_checks, fresh_reviews, fresh_finished, fresh_ci, _ = self.pull_detail(number, sha)
                    if fresh["headRefOid"] != pr["headRefOid"] or not fresh_ci or HOLD_LABEL in label_names(fresh):
                        self.report(f"PR #{number}: changed during inspection; deferred.")
                        continue
                    if decide_merge(fresh, sha, self.main_green(sha, plan), fresh_checks,
                                    fresh_reviews, fresh_finished) != "ready":
                        self.report(f"PR #{number}: final eligibility check changed; deferred.")
                        continue
                    if self.main_sha() != sha:
                        self.report("Main changed before merge; deferred.")
                        return True
                    response = self.api.request("PUT", f"{self.prefix}/pulls/{number}/merge",
                                                {"merge_method": "squash", "sha": fresh["headRefOid"]},
                                                user_token=bool(self.api.copilot_token))
                    if not response.get("merged"):
                        raise APIError("merge was not accepted")
                    self.report(f"PR #{number}: squash-merged; wait for new main checks before another merge.")
                    self.after_merge(fresh["files"])
                    return True
                approved_title = bool(issue_task_id(pr["title"]) or re.fullmatch(r"fix-main: \S[^\n]*", pr["title"])
                                      or (re.fullmatch(r"docs: \S[^\n]*", pr["title"]) and docs_only(pr["files"])))
                worker_done = not pr["draft"] or pr["copilot_tracked"]
                if (pr["headRepositorySameAsBase"] and pr["baseRefName"] == "main" and finished
                        and approved_title and worker_done
                        and (green or pr["title"].startswith("fix-main: "))):
                    if pr["main_integrated"] and not pr["ci_present"]:
                        if self.dry_run:
                            self.report(f"PR #{number}: would start missing CI at its current head.")
                        else:
                            self.dispatch("ci.yml", pr["head"]["ref"])
                            self.report(f"PR #{number}: started missing CI; awaiting checks.")
                        continue
                    if pr["mergeable"] == "CONFLICTING":
                        marker = f"<!-- {MARKER}:{number}:{pr['headRefOid']}:{sha} -->"
                        if any(marker in (comment.get("body") or "") for comment in comments):
                            self.report(f"PR #{number}: conflict repair already requested for this revision.")
                        elif not self.api.copilot_token:
                            self.report(f"PR #{number}: conflict repair needs COPILOT_ASSIGNMENT_TOKEN.")
                        elif self.dry_run:
                            self.report(f"PR #{number}: would request Copilot conflict repair on its existing branch.")
                        elif self.main_sha() == sha:
                            current, _, _, current_finished, _, _ = self.pull_detail(number, sha)
                            if (current["headRefOid"] != pr["headRefOid"] or HOLD_LABEL in label_names(current)
                                    or not current_finished or current["draft"] != pr["draft"]
                                    or current["title"] != pr["title"] or current["baseRefName"] != "main"
                                    or not current["headRepositorySameAsBase"]
                                    or self.main_sha() != sha):
                                self.report(f"PR #{number}: changed before repair; deferred.")
                                continue
                            self.api.repair_comment(number, marker + "\n@copilot Resolve this PR's merge conflicts "
                                                    "with the latest main on this existing PR branch. Preserve both "
                                                    "sides' intended behavior, dependencies, tests and documentation. "
                                                    "Follow AGENTS.md and docs/agent-context.md. Keep this PR draft "
                                                    "while working; run the affected checks, push without force, "
                                                    "and request review when finished. Do not merge or create a duplicate PR.")
                            self.report(f"PR #{number}: requested Copilot conflict repair.")
                        continue
                    if not pr["main_integrated"] and pr["mergeable"] == "MERGEABLE":
                        if self.dry_run:
                            self.report(f"PR #{number}: would update branch and rerun CI.")
                        elif self.main_sha() == sha:
                            current, _, _, current_finished, _, _ = self.pull_detail(number, sha)
                            if (current["headRefOid"] != pr["headRefOid"] or HOLD_LABEL in label_names(current)
                                    or not current_finished or current["draft"] != pr["draft"]
                                    or current["title"] != pr["title"] or current["baseRefName"] != "main"
                                    or not current["headRepositorySameAsBase"]
                                    or self.main_sha() != sha):
                                self.report(f"PR #{number}: changed before branch update; deferred.")
                                continue
                            self.api.request("PUT", f"{self.prefix}/pulls/{number}/update-branch",
                                             {"expected_head_sha": pr["headRefOid"]},
                                             user_token=bool(self.api.copilot_token))
                            # GitHub's 202 update is asynchronous. The next run
                            # starts any missing CI only after the new head is
                            # observed, avoiding a dispatch at the old head.
                            self.report(f"PR #{number}: branch updated; awaiting CI at its new head.")
                        continue
                self.report(f"PR #{number}: {reason}.")
            except APIError as error:
                self.report(f"PR #{number}: {error}; deferred.")
        return False


    def run(self):
        try:
            sha = self.main_sha()
            plan = self.read_plan(sha)
            if not self.runs("main", sha):
                if self.dry_run:
                    self.report("Would start missing main CI.")
                else:
                    self.dispatch("ci.yml", "main")
                    self.report("Started missing main CI; PR merges await its result.")
            green = self.main_green(sha, plan)
            self.report("Mode: " + ("dry run" if self.dry_run else "active") + "; main checks: " + ("green" if green else "pending/failed") + ".")
            pulls = self.api.pages(f"{self.prefix}/pulls?state=open")
            self.reconcile_prs(pulls, sha, plan, green)
        finally:
            if self.summary:
                with Path(self.summary).open("a", encoding="utf-8") as output:
                    output.write("## Jarvis coordinator\n\n" + "\n".join(f"- {line}" for line in self.lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if repo != "DanAakesen/jarvis":
        raise APIError("coordinator is restricted to DanAakesen/jarvis")
    api = GitHub(repo, os.environ.get("GITHUB_TOKEN", ""), os.environ.get("COPILOT_ASSIGNMENT_TOKEN", ""))
    Coordinator(api, args.dry_run, os.environ.get("GITHUB_STEP_SUMMARY")).run()


if __name__ == "__main__":
    try:
        main()
    except (APIError, ValueError):
        # Provider response contents and user-authored PLAN prose are never logged.
        print("::error::Coordinator stopped: GitHub access or workflow configuration could not be verified.")
        raise SystemExit(1) from None

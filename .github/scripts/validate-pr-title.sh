#!/usr/bin/env bash
# Validate live metadata, never writing a title from an obsolete event.
set -euo pipefail

fail() {
  local message="$1"
  message="${message//%/%25}"
  message="${message//$'\r'/%0D}"
  message="${message//$'\n'/%0A}"
  printf '::error::%s\n' "$message" >&2
  exit 1
}

[[ "${REPO:-}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ &&
   "${PR_NUMBER:-}" =~ ^[1-9][0-9]*$ &&
   "${PR_HEAD_SHA:-}" =~ ^[a-fA-F0-9]{40}$ ]] ||
  fail "Missing or invalid PR identity/head. Run the gate on a fresh pull_request event."

read_pr() {
  local raw snapshot
  if ! raw=$(timeout 30s gh api --method GET "repos/$REPO/pulls/$PR_NUMBER"); then
    fail "Could not read current PR metadata for $REPO#$PR_NUMBER. Check GitHub API availability/token permissions and rerun the current-head gate."
  fi
  if ! snapshot=$(jq -ce '
    select(type == "object")
    | select((.number | type) == "number" and (.title | type) == "string"
      and ((.body | type) == "string" or .body == null)
      and (.head.sha | type) == "string"
      and (.base.repo.full_name | type) == "string"
      and (.updated_at | type) == "string")
    | {number, title, body, head: .head.sha, repo: .base.repo.full_name, updated_at}
  ' <<<"$raw"); then
    fail "Invalid PR metadata from GitHub. Rerun the current-head gate; do not accept this result."
  fi
  printf '%s\n' "$snapshot"
}

current=$(read_pr)
if ! jq -e --arg repo "$REPO" --argjson number "$PR_NUMBER" \
  --arg head "$PR_HEAD_SHA" \
  '.repo == $repo and .number == $number and .head == $head' <<<"$current" >/dev/null; then
  fail "PR identity/head changed or does not match this event. Run a fresh gate for the intended PR/current head."
fi
title=$(jq -r '.title' <<<"$current")
body=$(jq -r '.body // ""' <<<"$current")
linked_id=""
repo_pattern="${REPO//./\\.}"
issue=$(grep -oiE "(fixes|closes|resolves|refs)[[:space:]]+(#|${repo_pattern}#)[0-9]+" <<<"$body" | head -n1 | grep -oE '[0-9]+$' || true)
if [[ -n "$issue" ]]; then
  if ! issue_title=$(timeout 30s gh issue view "$issue" --repo "$REPO" --json title --jq '.title'); then
    fail "Could not read linked issue $REPO#$issue. Check issue access/API availability and rerun the current-head gate."
  fi
  linked_id=$(grep -oE '^P[0-9]{1,2}-[0-9]{2,}\b' <<<"$issue_title" || true)
fi
valid=true
new_title=$(bash "$(dirname "${BASH_SOURCE[0]}")/normalize-pr-title.sh" "$title" "$linked_id") || valid=false
latest=$(read_pr)
[[ "$latest" == "$current" ]] ||
  fail "PR title/body/head or update timestamp changed during validation. No title was written. Run a fresh gate for the current metadata/head."
[[ "$valid" == true ]] ||
  fail "PR title must be '<task ID>: <summary>', 'fix-main: ...', or 'docs: ...'. No task ID found in the current title or linked issue. Edit the PR metadata and run a fresh gate."
[[ "$new_title" == "$title" ]] ||
  fail "Set the PR title to: $new_title. Automatic title writes are disabled to avoid overwriting concurrent edits; save the canonical title and run a fresh gate."
printf 'Validated current PR %s#%s at head %s.\n' "$REPO" "$PR_NUMBER" "$PR_HEAD_SHA"

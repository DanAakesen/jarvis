#!/usr/bin/env bash
# Normalizes a PR title to "<task ID>: <summary>" (keeping a leading "[WIP] "),
# or accepts "fix-main: ..." and "docs: ...". Prints the new title, or exits 1.
# Usage: normalize-pr-title.sh "<title>" "<task ID from the linked issue, may be empty>"
set -euo pipefail
title="$1"; linked_id="${2:-}"
wip=""; rest="$title"
if [[ "$rest" =~ ^\[WIP\][[:space:]]*(.*)$ ]]; then wip="[WIP] "; rest="${BASH_REMATCH[1]}"; fi
if [[ "$rest" =~ ^\[?(P[0-9]{1,2}-[0-9]{2})\]?[[:space:]]*[:—–-]?[[:space:]]*(.+)$ ]]; then
  echo "${wip}${BASH_REMATCH[1]}: ${BASH_REMATCH[2]}"; exit 0
fi
if [[ "$rest" =~ ^(fix-main|docs):[[:space:]]+.+ ]]; then echo "$title"; exit 0; fi
if [[ -n "$linked_id" ]]; then echo "${wip}${linked_id}: ${rest}"; exit 0; fi
exit 1
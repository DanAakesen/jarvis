#!/usr/bin/env bash
# Shared, noninteractive dependency setup for cloud agent environments (P0-14).
# Used by .github/workflows/copilot-setup-steps.yml and scripts/codex-setup.sh
# after they provide the pinned toolchain. Safe to re-run. It installs only from
# the committed lockfiles and fails if it would change a tracked file.
#
# Environment:
#   JARVIS_PYTHON  Python interpreter to use (default: python3 on PATH).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fail() {
  echo "setup-dependencies: $*" >&2
  exit 1
}

node_version="$(tr -d '[:space:]' < .nvmrc)"
python_version="$(tr -d '[:space:]' < .python-version)"
npm_version="$(node -p 'require("./package.json").packageManager.replace(/^npm@/, "")')"
python="${JARVIS_PYTHON:-python3}"

tracked_state() {
  git diff HEAD --binary --no-ext-diff | sha256sum
}
before="$(tracked_state)" || fail "the repository root is not a Git checkout"

actual_node="$(node --version)"
[[ "$actual_node" == "v$node_version" ]] || fail "Node.js $node_version required (.nvmrc), found $actual_node"

if [[ "$(npm --version)" != "$npm_version" ]]; then
  echo "Installing npm $npm_version"
  npm install --global --no-audit --no-fund "npm@$npm_version"
fi
actual_npm="$(npm --version)"
[[ "$actual_npm" == "$npm_version" ]] || fail "npm $npm_version required (packageManager), found $actual_npm"

command -v "$python" > /dev/null || fail "Python interpreter '$python' not found"
actual_python="$("$python" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])')"
[[ "$actual_python" == "$python_version" ]] || fail "Python $python_version required (.python-version), found $actual_python"

echo "Toolchain: Node.js $actual_node, npm $actual_npm, Python $actual_python"

npm ci --no-audit --no-fund

# Python packages get their own virtual environment, installed only from a
# hash-locked requirements file. Absent packages are reported, not tested.
for package in runner agents/jarvis; do
  if [[ ! -f "$package/pyproject.toml" && ! -f "$package/requirements.txt" && ! -f "$package/requirements-dev.txt" ]]; then
    echo "Python package $package: not present yet; skipped"
    continue
  fi
  if [[ -f "$package/requirements-dev.txt" ]]; then
    lock="$package/requirements-dev.txt"
  elif [[ -f "$package/requirements.txt" ]]; then
    lock="$package/requirements.txt"
  else
    fail "Python package $package has no hash-locked requirements-dev.txt or requirements.txt"
  fi
  echo "Python package $package: installing $lock into $package/.venv"
  "$python" -m venv --clear "$package/.venv"
  "$package/.venv/bin/python" -m pip install --disable-pip-version-check --no-input --require-hashes -r "$lock"
done

[[ "$(tracked_state)" == "$before" ]] || fail "setup changed tracked files; see git status"

echo "Dependencies installed"

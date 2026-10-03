#!/usr/bin/env bash
# Codex cloud environment setup script (P0-14). In the Codex environment
# settings, set the setup script to:
#   bash scripts/codex-setup.sh
# It is noninteractive and safe to re-run, so it can also be the maintenance
# script. It installs the pinned toolchain (.nvmrc, .python-version, npm from
# package.json packageManager) with the image's own checksum-verifying tools,
# then installs dependencies from the committed lockfiles. It reads no tokens.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fail() {
  echo "codex-setup: $*" >&2
  exit 1
}

node_version="$(tr -d '[:space:]' < .nvmrc)"
python_version="$(tr -d '[:space:]' < .python-version)"

# Node.js: codex-universal provides nvm. `nvm alias default` makes later agent
# shells use the pinned version.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  set +u
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh"
  nvm install "$node_version"
  nvm alias default "$node_version"
  nvm use "$node_version"
  set -u
elif [[ "$(node --version 2> /dev/null || true)" != "v$node_version" ]]; then
  fail "nvm not found and Node.js $node_version is not on PATH"
fi

# Python: prefer pyenv (codex-universal's manager; `pyenv global` persists for
# agent shells). Fall back to uv's managed Python, installed as the default.
python=""
if command -v pyenv > /dev/null && pyenv install --list | tr -d ' ' | grep -x "$python_version" > /dev/null; then
  pyenv install --skip-existing "$python_version"
  pyenv global "$python_version"
  python="$(pyenv root)/versions/$python_version/bin/python3"
elif command -v uv > /dev/null; then
  uv python install --default "$python_version"
  python="$(uv python find "$python_version")"
fi
[[ -n "$python" ]] || fail "neither pyenv with a $python_version definition nor uv is available"

# Agent shells start fresh; warn if their python3 is not the pinned version.
shell_python="$(bash -lc 'python3 -c "import sys; print(\"%d.%d.%d\" % sys.version_info[:3])"' 2> /dev/null || true)"
if [[ "$shell_python" != "$python_version" ]]; then
  echo "codex-setup: warning: a new login shell has python3 ${shell_python:-missing}, not $python_version;" \
    "use the package .venv interpreters or $python" >&2
fi

JARVIS_PYTHON="$python" bash "$root/scripts/setup-dependencies.sh"

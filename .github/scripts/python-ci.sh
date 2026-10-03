#!/usr/bin/env bash
# Lint, test and byte-compile each planned Python component that exists.
# A component exists when <dir>/pyproject.toml exists; it must then provide a
# hash-pinned <dir>/requirements-dev.txt that installs ruff and pytest.
# Absent components are reported as skipped, never as passed. Part of P0-10.
# Usage: python-ci.sh [component dir ...]   (default: runner agents/jarvis)
set -euo pipefail

if (($# > 0)); then
  components=("$@")
else
  components=(runner agents/jarvis)
fi

summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
venv_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/python-ci"
checked=()
skipped=()
failed=()

{
  echo "### Python components"
  echo
  echo "| Component | Result |"
  echo "| --- | --- |"
} >>"$summary"

for dir in "${components[@]}"; do
  if [[ ! -f "$dir/pyproject.toml" ]]; then
    echo "::notice title=Python CI::$dir is absent (no $dir/pyproject.toml); its checks did not run."
    echo "| \`$dir\` | Skipped: not present |" >>"$summary"
    skipped+=("$dir")
    continue
  fi
  if [[ ! -f "$dir/requirements-dev.txt" ]]; then
    echo "::error title=Python CI::$dir has pyproject.toml but no hash-pinned requirements-dev.txt."
    echo "| \`$dir\` | Failed: missing requirements-dev.txt |" >>"$summary"
    failed+=("$dir")
    continue
  fi

  echo "::group::$dir"
  venv="$venv_root/${dir//\//-}"
  rm -rf "$venv"
  if python -m venv "$venv" &&
    "$venv/bin/python" -m pip install --disable-pip-version-check --require-hashes \
      -r "$dir/requirements-dev.txt" &&
    "$venv/bin/python" -m ruff check "$dir" &&
    (cd "$dir" && "$venv/bin/python" -m pytest -q) &&
    "$venv/bin/python" -m compileall -q -x '/(\.venv|__pycache__)/' "$dir" >/dev/null; then
    echo "::endgroup::"
    echo "| \`$dir\` | Passed: ruff, pytest, compileall |" >>"$summary"
    checked+=("$dir")
  else
    echo "::endgroup::"
    echo "::error title=Python CI::$dir failed install, lint, tests or byte-compilation."
    echo "| \`$dir\` | Failed |" >>"$summary"
    failed+=("$dir")
  fi
done

echo "Python checked: ${checked[*]:-none}; skipped (absent): ${skipped[*]:-none}; failed: ${failed[*]:-none}"
((${#failed[@]} == 0))

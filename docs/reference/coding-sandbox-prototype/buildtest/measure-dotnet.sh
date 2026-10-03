#!/usr/bin/env bash
set -u

RESULT_DIR="${1:-build-measure-dotnet}"
REPO_URL="https://github.com/dotnet/orleans.git"
REPO_TAG="v8.2.0"
SOLUTION="Orleans.sln"

mkdir -p "$RESULT_DIR/logs"
exec > >(tee -a "$RESULT_DIR/transcript.log") 2>&1

export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
export DOTNET_CLI_HOME="$PWD/.dotnet-home"
export NUGET_PACKAGES="$PWD/.nuget/packages"
export TMPDIR="$PWD/.scratch"
mkdir -p "$DOTNET_CLI_HOME" "$NUGET_PACKAGES" "$TMPDIR"

safe_name() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'
}

read_cgroup() {
  for file in \
    /sys/fs/cgroup/memory.max \
    /sys/fs/cgroup/memory.current \
    /sys/fs/cgroup/memory.peak \
    /sys/fs/cgroup/memory.events \
    /sys/fs/cgroup/cpu.max \
    /sys/fs/cgroup/cpu.stat
  do
    if [ -e "$file" ]; then
      echo "## $file"
      cat "$file" || true
    fi
  done
}

snapshot() {
  label="$(safe_name "$1")"
  {
    echo "===== SNAPSHOT $1 ====="
    date -u +"%Y-%m-%dT%H:%M:%SZ"
    echo "pwd=$PWD"
    echo "--- df -hP"
    df -hP / /home/runner /files /tmp "$PWD" 2>&1 || true
    echo "--- df -PB1"
    df -PB1 / /home/runner /files /tmp "$PWD" 2>&1 || true
    echo "--- cgroup"
    read_cgroup
    echo "--- memory pressure"
    cat /proc/pressure/memory 2>/dev/null || true
    echo "--- free -m"
    free -m 2>/dev/null || true
    echo "--- top disk directories"
    du -xsh /usr/share/dotnet /usr/local /home/runner /files "$PWD" "$NUGET_PACKAGES" ./orleans ./.git 2>/dev/null || true
    if [ -d orleans ]; then
      echo "--- Orleans .git"
      git -C orleans count-objects -vH 2>/dev/null || true
      echo "--- Orleans bin/obj total"
      find orleans -type d \( -name bin -o -name obj \) -prune -print0 2>/dev/null | du -ch --files0-from=- 2>/dev/null | tail -n 5 || true
    fi
  } | tee "$RESULT_DIR/snapshot-$label.txt"
}

run_step() {
  label="$(safe_name "$1")"
  shift
  echo "===== STEP $label ====="
  snapshot "before-$label"
  start_epoch="$(date +%s)"
  /usr/bin/time -v -o "$RESULT_DIR/time-$label.txt" bash -lc "$*" > "$RESULT_DIR/logs/$label.out" 2>&1
  code=$?
  end_epoch="$(date +%s)"
  echo "STEP_RESULT label=$label exit=$code seconds=$((end_epoch - start_epoch))"
  echo "--- /usr/bin/time -v ($label)"
  cat "$RESULT_DIR/time-$label.txt" || true
  echo "--- last 120 log lines ($label)"
  tail -n 120 "$RESULT_DIR/logs/$label.out" || true
  snapshot "after-$label"
  return 0
}

echo "===== ENVIRONMENT ====="
date -u +"%Y-%m-%dT%H:%M:%SZ"
hostname || true
nproc || true
git --version || true
dotnet --info || true
mount | sed -n '1,80p' || true
snapshot "initial"

run_step clone_full_single_branch \
  "git clone --single-branch --branch $REPO_TAG $REPO_URL orleans-full && git -C orleans-full rev-parse HEAD && git -C orleans-full count-objects -vH && du -xsh orleans-full"
run_step remove_full_clone "rm -rf orleans-full"
run_step clone_shallow_partial \
  "git clone --depth 1 --filter=blob:none --branch $REPO_TAG $REPO_URL orleans && git -C orleans rev-parse HEAD && git -C orleans count-objects -vH && find orleans -type f | wc -l && du -xsh orleans"

run_step restore_solution "cd orleans && dotnet restore $SOLUTION -v minimal"
run_step build_solution_default "cd orleans && dotnet build $SOLUTION --no-restore -c Release -v minimal"
run_step clean_outputs "cd orleans && dotnet clean $SOLUTION -c Release -v quiet || true; find orleans -type d \( -name bin -o -name obj \) -prune -exec rm -rf {} +"
run_step build_solution_m1_no_shared_compilation \
  "cd orleans && dotnet build $SOLUTION --no-restore -c Release -v minimal -m:1 -p:UseSharedCompilation=false"
run_step build_single_project_m1 \
  "cd orleans && dotnet build src/Orleans.Runtime/Orleans.Runtime.csproj --no-restore -c Release -v minimal -m:1 -p:UseSharedCompilation=false"
run_step targeted_test_project \
  "cd orleans && dotnet test test/Orleans.Serialization.UnitTests/Orleans.Serialization.UnitTests.csproj --no-restore -c Release -v minimal --filter FullyQualifiedName~Serializer"

snapshot "final"

echo "===== STEP SUMMARY ====="
for file in "$RESULT_DIR"/time-*.txt; do
  [ -e "$file" ] || continue
  name="$(basename "$file" .txt | sed 's/^time-//')"
  printf '%s\t' "$name"
  grep -E 'Elapsed \\(wall clock\\)|Maximum resident set size|Percent of CPU|Exit status|File system outputs|File system inputs' "$file" | tr '\n' '; '
  echo
done

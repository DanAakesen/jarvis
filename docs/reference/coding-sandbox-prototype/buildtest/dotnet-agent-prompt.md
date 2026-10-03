You are measuring this Foundry hosted-agent sandbox for Dan's Jarvis build-capacity test.

Goal: run the supplied Bash script exactly, do not redesign anything, do not open PRs, and do not print secrets. Work in your current sandbox working directory. The script clones the public MIT-licensed `dotnet/orleans` repository at tag `v8.2.0`, records cgroup memory, disk, wall time and `/usr/bin/time -v` for clone/restore/build/test steps, and keeps going after failures so the first limit is visible.

Create `measure-dotnet.sh` with the content below, run `bash measure-dotnet.sh`, then reply with:

1. The result directory name.
2. The `STEP_RESULT` lines.
3. For each step: exit code, elapsed wall time, max RSS, CPU percent, and the exact first failing error if any.
4. The cgroup `memory.max`, highest observed `memory.peak`, and any `memory.events` OOM values.
5. Disk free from `df -hP` initially, after restore, after default build, and finally for `/`, `/home/runner`, `/files`, `/tmp`, and the working directory.
6. The largest disk consumers from the snapshots.

```bash
__MEASURE_SCRIPT_PLACEHOLDER__
```

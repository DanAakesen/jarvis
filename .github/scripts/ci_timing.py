"""Write a job name and duration table for the current run to the step summary."""

import json
import os
import subprocess
from datetime import datetime


def seconds(job: dict) -> int | None:
    try:
        start = datetime.fromisoformat(job["started_at"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(job["completed_at"].replace("Z", "+00:00"))
    except (KeyError, AttributeError, ValueError):
        return None
    return max(0, int((end - start).total_seconds()))


def table(jobs: list[dict]) -> str:
    rows = []
    for job in jobs:
        duration = seconds(job)
        if duration is not None and job.get("conclusion") != "skipped":
            rows.append((duration, str(job.get("name", "unknown")), job.get("conclusion") or "unknown"))
    lines = ["### CI timing", "", "| Job | Duration | Result |", "| --- | --- | --- |"]
    for duration, name, result in sorted(rows, reverse=True):
        lines.append(f"| {name.replace('|', '/')} | {duration // 60}m {duration % 60:02d}s | {result} |")
    if rows:
        longest = max(duration for duration, _, _ in rows)
        lines += ["", f"Slowest finished job: {longest // 60}m {longest % 60:02d}s. "
                      "Jobs still running are not listed."]
    return "\n".join(lines) + "\n"


def main() -> int:
    result = subprocess.run(
        ["gh", "api", "--paginate", "--slurp",
         f"repos/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
         f"/attempts/{os.environ['GITHUB_RUN_ATTEMPT']}/jobs?per_page=100"],
        capture_output=True, text=True, check=False, timeout=60,
    )
    if result.returncode:
        raise RuntimeError("Job timings unavailable")
    jobs = [job for page in json.loads(result.stdout) for job in page.get("jobs", [])]
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write(table(jobs))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

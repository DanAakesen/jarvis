"""Run the PI live smoke on the deployed backend and turn its measurements into a job summary.

The backend does the work (POST /pi/smoke, deployment identity only): a scratch conversation, a cold turn, warm turns, a
tool turn through the Jarvis MCP server, and a cancelled turn. This script only calls it and shows what it observed.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

CHECKS = {
    "streaming": "text streams in several pieces, not one chunk",
    "tools_over_mcp": "a Jarvis tool ran through the MCP server",
    "cancellation": "a cancelled turn stopped quickly and the conversation still works",
    "warm_faster_than_cold": "a warm turn starts faster than the cold one",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # never forward the bearer token
        return None


def bar(value: float | None, scale: float, width: int = 40) -> str:
    if value is None:
        return "n/a"
    return "█" * max(1, round(min(value, scale) / scale * width)) + f" {value / 1000:.1f} s"


def render(report: dict) -> str:
    turns = [("cold, new conversation", report["cold"])] + [
        (f"warm turn {index + 2}", turn) for index, turn in enumerate(report["warm"])
    ] + [("tool turn (MCP)", report["tools"])]
    scale = max([turn["firstTextMs"] or 0 for _, turn in turns] + [1000])
    lines = ["### PI live smoke", "", "First text, observed through the gateway (one block is the same width for every row):", "", "```text"]
    lines += [f"{label:<26}|{bar(turn['firstTextMs'], scale)}" for label, turn in turns]
    lines += ["```", "", "| Turn | First text | Total | Input | Cached | Output | DKK |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for label, turn in turns:
        usage = turn["usage"]
        first = f"{turn['firstTextMs']} ms" if turn["firstTextMs"] is not None else "none"
        lines.append(f"| {label} | {first} | {turn['totalMs']} ms | {usage['inputTokens']} | {usage['cachedTokens']} | "
                     f"{usage['outputTokens']} | {turn['costDkk']:.4f} |")
    cancel = report["cancel"]
    lines += ["", f"Cancellation: stream closed {cancel['abortToCloseMs']} ms after the abort, "
                  f"{cancel['partialCharacters']} characters had arrived, follow-up turn {'worked' if cancel['followUpOk'] else 'FAILED'}.",
              f"Tool turn: {report['tools']['toolCalls']} MCP tool call(s), reply: {report['tools']['text']!r}",
              f"Smoke cost: {report['totalCostDkk']:.4f} DKK (list price, cached discount ignored).", "",
              "| Check | Result |", "| --- | --- |"]
    lines += [f"| {CHECKS[key]} | {'pass' if report['checks'].get(key) else '**FAIL**'} |" for key in CHECKS]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-fqdn", required=True)
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args(argv)
    token = subprocess.run(
        ["az", "account", "get-access-token", "--resource", "https://management.azure.com/", "--query", "accessToken",
         "--output", "tsv", "--only-show-errors"], capture_output=True, text=True, check=False, timeout=60,
    ).stdout.strip()
    if not token:
        print("::error::The deployment identity returned no token for the PI smoke.", file=sys.stderr)
        return 1
    request = urllib.request.Request(
        f"https://{args.backend_fqdn}/pi/smoke", data=b"{}", method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=295) as response:
            report = json.loads(response.read(1_048_576))
    except urllib.error.HTTPError as error:
        body = error.read(4096).decode("utf-8", "replace")
        try:
            detail = json.loads(body)
        except ValueError:
            detail = {}
        message = detail.get("error", "no detail") if isinstance(detail, dict) else "no detail"
        print(f"::error::The PI smoke failed with HTTP {error.code}: {message}", file=sys.stderr)
        args.summary.write_text(f"### PI live smoke\n\nFailed with HTTP {error.code}: {message}\n", encoding="utf-8")
        return 1
    except (urllib.error.URLError, TimeoutError, ValueError):
        print("::error::The PI smoke did not return a report.", file=sys.stderr)
        return 1
    args.summary.write_text(render(report), encoding="utf-8")
    failed = [key for key in CHECKS if not report.get("checks", {}).get(key)]
    if failed:
        print("::error::PI smoke checks failed: " + ", ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

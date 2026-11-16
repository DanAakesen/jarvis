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
    "tools_over_mcp": "a Jarvis tool ran through the MCP server and its own result was ok",
    "cancellation": "a cancelled turn stopped quickly and the conversation still works",
    "warm_faster_than_cold": "a warm turn starts faster than the cold one",
}
# Present only for a reach server whose tools were listed (GitHub and Azure through the Jarvis door): a server that is not attached has no turn and no check.
REACH_CHECKS = {
    "reach_github": "a GitHub tool answered a read through the Jarvis door",
    "reach_azure": "an Azure tool answered a read through the Jarvis door",
    "mcp_listing": "every remote server (GitHub, Azure) listed its tools",
}


# Present only when the report carries the voice turns (the PI leg of a voice turn: Voice Live's own audio time is not in it).
VOICE_CHECKS = {
    "voice_spoken_shape": "voice-channel replies read as speech (plain words, no markdown or lists, short)",
    "voice_tools_over_mcp": "a voice turn ran a Jarvis tool through the MCP server and its own result was ok",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # never forward the bearer token
        return None


def bar(value: float | None, scale: float, width: int = 40) -> str:
    if value is None:
        return "n/a"
    return "█" * max(1, round(min(value, scale) / scale * width)) + f" {value / 1000:.1f} s"


def render(report: dict) -> str:
    turns = [("fixed prompt, new conversation", report["baseline"])] if report.get("baseline") else []
    turns += [("cold, new conversation", report["cold"])] + [
        (f"warm turn {index + 2}", turn) for index, turn in enumerate(report["warm"])
    ] + [("tool turn (MCP)", report["tools"])] + [
        (f"voice: {label}", turn) for label, turn in (("plain", report.get("voice", {}).get("plain")), ("with a tool", report.get("voice", {}).get("tools"))) if turn
    ] + [
        (f"reach: {entry['server']}", entry["turn"]) for entry in report.get("reach", [])
    ]
    scale = max([turn["firstTextMs"] or 0 for _, turn in turns] + [1000])
    lines = ["### PI live smoke", "", "First text, observed through the gateway (one block is the same width for every row):", "", "```text"]
    lines += [f"{label:<31}|{bar(turn['firstTextMs'], scale)}" for label, turn in turns]
    lines += ["```", "", "| Turn | First text | Total | Pieces | Input | Cached | Output | DKK |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for label, turn in turns:
        usage = turn["usage"]
        first = f"{turn['firstTextMs']} ms" if turn["firstTextMs"] is not None else "none"
        lines.append(f"| {label} | {first} | {turn['totalMs']} ms | {turn.get('deltas', 0)} | {usage['inputTokens']} | "
                     f"{usage['cachedTokens']} | {usage['outputTokens']} | {turn['costDkk']:.4f} |")
    cancel = report["cancel"]
    results = ", ".join(r["tool"] + "=" + r["outcome"] for r in report["tools"].get("toolResults", []))
    lines += ["", f"Cancellation: stream closed {cancel['abortToCloseMs']} ms after the abort, "
                  f"{cancel['partialCharacters']} characters had arrived, follow-up turn {'worked' if cancel['followUpOk'] else 'FAILED'}.",
              f"Tool turn: {report['tools']['toolCalls']} MCP tool call(s), server-recorded results: "
                  f"{results or 'none'}, reply: {report['tools']['text']!r}",
              f"Smoke cost: {report['totalCostDkk']:.4f} DKK (list price, cached discount ignored).", ""]
    listed = report.get("listed", [])
    servers = ", ".join(f"{item['server'] or 'unknown'}: {'FAILED to list' if item['failed'] else str(item['tools']) + ' tools'}" for item in listed)
    lines += [f"Remote servers whose tools were listed: {servers or 'none reported'}.", ""]
    for entry in report.get("reach", []):
        calls = ", ".join(f"{call['name'] or 'call'}={'failed' if call['failed'] else 'ok'}" for call in entry["turn"].get("reachCalls", []))
        lines.append(f"Reach {entry['server']}: {calls or 'no call'}; reply: {entry['turn']['text']!r}")
    choices = report.get("choices", [])
    if choices:
        lines += ["", "Tool choice (natural prompts, no tool named; the smoke role refuses everything except its reads, so nothing acts):", ""]
        lines += [f"- {entry['label']}: called {', '.join(entry['called']) or 'no Jarvis, GitHub or Azure tool'}; reply: {entry['turn']['text']!r}" for entry in choices]
    voice = report.get("voice")
    if voice:
        lines += ["", f"Voice (PI leg only): plain reply {voice['plain']['text']!r}; tool turn reply {voice['tools']['text']!r}, "
                      f"PI wrote a sentence before the tool call: {'yes' if voice['tools'].get('textBeforeTool') else 'no'}."]
    lines += ["", "| Check | Result |", "| --- | --- |"]
    lines += [f"| {CHECKS[key]} | {'pass' if report['checks'].get(key) else '**FAIL**'} |" for key in CHECKS]
    lines += [f"| {text} | {'pass' if report['checks'].get(key) else '**FAIL**'} |" for key, text in {**VOICE_CHECKS, **REACH_CHECKS}.items() if key in report.get("checks", {})]
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
        if isinstance(detail, dict) and isinstance(detail.get("detail"), str):
            message += f" (provider code: {detail['detail']})"
        print(f"::error::The PI smoke failed with HTTP {error.code}: {message}", file=sys.stderr)
        args.summary.write_text(f"### PI live smoke\n\nFailed with HTTP {error.code}: {message}\n", encoding="utf-8")
        return 1
    except (urllib.error.URLError, TimeoutError, ValueError):
        print("::error::The PI smoke did not return a report.", file=sys.stderr)
        return 1
    rendered = render(report)
    args.summary.write_text(rendered, encoding="utf-8")
    # The step summary needs a sign-in to read; the log shows the same numbers to anyone who can open the run.
    print(rendered)
    required = [*CHECKS, *(key for key in (*VOICE_CHECKS, *REACH_CHECKS) if key in report.get("checks", {}))]
    failed = [key for key in required if not report.get("checks", {}).get(key)]
    if failed:
        print("::error::PI smoke checks failed: " + ", ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

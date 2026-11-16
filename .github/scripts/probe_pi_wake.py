"""Probe whether a managed-harness prompt agent can be woken without our ticker: the reminder tool and Foundry routines.

Manual only (Deploy input `probe_pi_wake`, about 0.3 DKK of model spend). It creates a throwaway agent `jarvis-pi-probe`, which
is not the PI agent and never gets its MCP connections, tries the two documented wake-up features and deletes everything again.
It records what it observed as plain statuses and Foundry's sanitized error codes. It never raises on an unexpected shape: an
unexpected shape is a result. The PI watches do not depend on the outcome (our ticker and the vault are the waker and the truth).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import provision_pi_agent as pi

PROBE_AGENT = "jarvis-pi-probe"
PROBE_ROUTINE = "jarvis-pi-probe-routine"
ROUTINE_FEATURES = pi.AGENT_FEATURES + ",Routines=V1Preview"
POLL_SECONDS = 20
WAIT_SECONDS = 240


class Probe(pi.Az):
    """The same REST helper, with the routines preview feature added for routine paths."""

    def rest(self, method: str, path: str, body: dict | None = None, *, content_type: str = "application/json") -> dict:
        saved = pi.AGENT_FEATURES
        if path.startswith("/routines"):
            pi.AGENT_FEATURES = ROUTINE_FEATURES
        try:
            return super().rest(method, path, body, content_type=content_type)
        finally:
            pi.AGENT_FEATURES = saved


def attempt(steps: list[dict], name: str, action) -> dict | None:
    """Runs one step and records `ok` with a short observation, or `failed` with Foundry's sanitized error."""
    try:
        value = action()
        steps.append({"step": name, "status": "ok", "observed": value})
        return value if isinstance(value, dict) else None
    except pi.Blocked as error:
        steps.append({"step": name, "status": "failed", "error": pi.sanitize(str(error), 400)})
    except (OSError, ValueError, KeyError, TypeError) as error:
        steps.append({"step": name, "status": "failed", "error": type(error).__name__})
    return None


def item_summary(items: list) -> list[str]:
    return [f"{item.get('type', '?')}:{item.get('role', '')}" for item in items if isinstance(item, dict)]


def definition(spec: dict, with_reminder: bool) -> dict:
    tools: list[dict] = [{"type": "microsoft_copilot_toolset_preview", "default_config": {"enabled": False}}]
    if with_reminder:
        tools.append({"type": "reminder_preview"})
    return {
        "kind": "prompt", "harness": {"type": "microsoft_copilot_preview"}, "model": spec["model"],
        "reasoning": {"effort": spec["reasoningEffort"]}, "instructions": "You are a probe agent. Reply in one short sentence.",
        "tools": tools,
    }


def respond(azure: Probe, conversation: str, text: str) -> dict:
    # The runtime and admin endpoints share the agent path; the call is not streamed, so the whole answer is one body.
    return azure.rest("POST", f"/agents/{PROBE_AGENT}/endpoint/protocols/openai/responses",
                      {"conversation": conversation, "input": [{"role": "user", "content": text}], "stream": False})


def wait_for_new_assistant_message(azure: Probe, conversation: str, before: int) -> dict:
    deadline = time.monotonic() + WAIT_SECONDS
    last: list[str] = []
    while True:
        time.sleep(POLL_SECONDS)
        listing = azure.rest("GET", f"/agents/{PROBE_AGENT}/endpoint/protocols/openai/conversations/{conversation}/items")
        last = item_summary(listing.get("data", []))
        if len([entry for entry in last if entry.endswith("assistant")]) > before:
            return {"woke": True, "items": last}
        if time.monotonic() >= deadline:
            return {"woke": False, "items": last}


def run_probe(args: argparse.Namespace) -> list[dict]:
    spec = pi.load_spec()
    azure = Probe(args.project_endpoint)
    azure.deadline = time.monotonic() + 1_500
    steps: list[dict] = []
    created = False
    try:
        # 1. Reminder tool on a harness prompt agent: is the definition accepted, and does it re-invoke the same conversation?
        def reminder_agent() -> dict:
            version = azure.rest("POST", f"/agents/{PROBE_AGENT}/versions", {"definition": definition(spec, True)})
            nonlocal created
            created = True
            readback = pi.wait_active(azure, PROBE_AGENT, pi.as_version(version.get("version")))
            tools = [tool.get("type") for tool in (readback.get("definition") or {}).get("tools", [])]
            pi.pin(azure, PROBE_AGENT, pi.as_version(version.get("version")))
            return {"definition_accepted": True, "tools_in_readback": tools}

        accepted = attempt(steps, "reminder_preview accepted on a harness prompt agent", reminder_agent)
        conversation = None
        if accepted:
            def schedule() -> dict:
                nonlocal conversation
                conversation = azure.rest("POST", f"/agents/{PROBE_AGENT}/endpoint/protocols/openai/conversations", {}).get("id")
                reply = respond(azure, conversation, "Use the reminder tool to wake yourself in 1 minute with the text 'probe woke'. Then say 'scheduled'.")
                return {"output_items": item_summary(reply.get("output", [])), "status": reply.get("status")}

            attempt(steps, "agent used the reminder tool", schedule)
            if conversation:
                attempt(steps, "same conversation re-invoked without a client call", lambda: wait_for_new_assistant_message(azure, conversation, 1))

        # 2. Foundry routines: a one-off timer routine that invokes the agent.
        if created:
            at = datetime.now(timezone.utc) + timedelta(seconds=90)
            routine = {
                "description": "PI wake probe", "enabled": True,
                "triggers": {"once": {"type": "timer", "at": at.strftime("%Y-%m-%dT%H:%M:%SZ")}},
                "action": {"type": "invoke_agent_responses_api", "agent_name": PROBE_AGENT, "input": "probe: reply with the word fired"},
            }
            made = attempt(steps, "routine (timer) accepted for a harness prompt agent",
                           lambda: {"keys": sorted(azure.rest("PUT", f"/routines/{PROBE_ROUTINE}", routine).keys())})
            if made is not None:
                time.sleep(WAIT_SECONDS)
                attempt(steps, "routine run record after the timer", lambda: {
                    "keys": sorted(azure.rest("GET", f"/routines/{PROBE_ROUTINE}/runs").keys())})
                attempt(steps, "routine definition after the timer", lambda: {
                    "keys": sorted(azure.rest("GET", f"/routines/{PROBE_ROUTINE}").keys())})
    finally:
        attempt(steps, "cleanup: routine deleted", lambda: azure.rest("DELETE", f"/routines/{PROBE_ROUTINE}"))
        if created:
            attempt(steps, "cleanup: probe agent deleted", lambda: azure.rest("DELETE", f"/agents/{PROBE_AGENT}"))
    return steps


def render(steps: list[dict]) -> str:
    lines = ["### PI wake probe: reminder tool and Foundry routines", "", "| Step | Result | What was observed |", "| --- | --- | --- |"]
    for step in steps:
        detail = json.dumps(step.get("observed", step.get("error", "")), sort_keys=True)
        lines.append(f"| {step['step']} | {step['status']} | `{detail[:300]}` |")
    lines += ["", "Our ticker and the vault stay the waker either way; this only decides whether Foundry can replace the timer part."]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-endpoint", required=True)
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args(argv)
    steps = run_probe(args)
    text = render(steps)
    args.summary.write_text(text, encoding="utf-8")
    print(text)
    # A rejected feature is a result, not a failure of the probe. Only a probe that could not run at all fails the job.
    return 0 if steps else 1


if __name__ == "__main__":
    raise SystemExit(main())

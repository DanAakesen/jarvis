"""Action reliability: does Jarvis do what it says, for commands on existing tasks?

    .venv\\Scripts\\python.exe tests\\run_reliability.py [--trials 8]

Runs the agent's own streaming tool loop (agent/model_client.py) against the deployed
models, with the voice greeting in the history as in a real call. A trial passes when the
expected tool is called. A false claim is a reply that says an action was done while no
action tool ran.
"""

from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "client"), str(ROOT / "agent"), str(Path(__file__).parent)]

import common  # noqa: E402
from jarvis_tools import INSTRUCTIONS, ToolLog  # noqa: E402
from model_client import AzureOpenAIResponsesClient  # noqa: E402
from openai import AsyncOpenAI  # noqa: E402
from scoring import CASES, MUTATING, score_intent  # noqa: E402
from state import ModelMessage  # noqa: E402

COMMAND_IDS = ["c06", "c09", "c12", "c14", "c16"]
# "strict" is now the deployed default (agent/jarvis_tools.py); "current" is the earlier prompt
# without the action rules, kept for comparison.
PROMPTS = {"current": INSTRUCTIONS.split("\nAction rules (strict):")[0] + "\n", "strict": INSTRUCTIONS}
CLAIM = re.compile(r"\b(jeg har|har jeg|jeg satte|jeg retter|er nu|er sat|er sendt|har sagt|har bedt|har givet|har sendt|har annulleret|har genoptaget)\b", re.I)


async def trial(client, model, effort, prompt_key, case, sem) -> dict:
    async with sem:
        log = ToolLog()
        agent = AzureOpenAIResponsesClient(
            client=client, credential=None, model_name=model, server_address="test",
            system_prompt=PROMPTS[prompt_key], max_output_tokens=512,
            reasoning_effort=None if effort == "default" else effort, tool_log=log)
        messages = [ModelMessage("assistant", common.GREETING), ModelMessage("user", case["text"])]
        started = time.monotonic()
        for attempt in range(6):
            try:
                reply = "".join([chunk async for chunk in agent.complete(messages)])
                break
            except Exception as exc:  # noqa: BLE001
                if "rate limit" not in str(exc).lower() or attempt == 5:
                    raise
                log.entries.clear()
                await asyncio.sleep(10 * (attempt + 1))
                started = time.monotonic()
        calls = [{"name": e["name"], "arguments": e["arguments"]} for e in log.entries if e["kind"] == "tool"]
        passed, note = score_intent(case, calls)
        acted = any(c["name"] in MUTATING for c in calls)
        return {"model": model, "effort": effort, "prompt": prompt_key, "id": case["id"], "passed": passed,
                "false_claim": bool(CLAIM.search(reply)) and not acted, "note": note, "reply": reply,
                "calls": calls, "ms": int((time.monotonic() - started) * 1000),
                "rounds": sum(1 for e in log.entries if e["kind"] == "model")}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=8)
    parser.add_argument("--models", nargs="+", default=["gpt-5.4-mini", "gpt-5.6-luna"])
    parser.add_argument("--efforts", nargs="+", default=["none", "low"])
    args = parser.parse_args()
    deployment = common.load()
    token = common.credential(deployment).get_token("https://ai.azure.com/.default").token
    client = AsyncOpenAI(api_key=token, base_url=f"{deployment.projectEndpoint}/openai/v1/")
    cases = [c for c in CASES["commands"] if c["id"] in COMMAND_IDS]
    sem = asyncio.Semaphore(2)
    jobs = [trial(client, m, e, p, c, sem)
            for m, e, p, c in itertools.product(args.models, args.efforts, PROMPTS, cases)
            for _ in range(args.trials)]
    rows = await asyncio.gather(*jobs)
    await client.close()
    summary = {}
    for m, e, p in itertools.product(args.models, args.efforts, PROMPTS):
        group = [r for r in rows if (r["model"], r["effort"], r["prompt"]) == (m, e, p)]
        ms = sorted(r["ms"] for r in group)
        summary[f"{m} / effort {e} / {p} prompt"] = {
            "passed": f"{sum(r['passed'] for r in group)}/{len(group)}",
            "false_claims": sum(r["false_claim"] for r in group),
            "median_ms": ms[len(ms) // 2],
            "per_command": {c["id"]: sum(r["passed"] for r in group if r["id"] == c["id"]) for c in cases},
        }
    path = common.RESULTS / "reliability.json"
    path.write_text(json.dumps({"trials": args.trials, "summary": summary, "rows": rows},
                               ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Saved {path}")


if __name__ == "__main__":
    asyncio.run(main())

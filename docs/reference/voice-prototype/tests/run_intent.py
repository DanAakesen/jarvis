"""V3 intent accuracy and V4 Danish status answers.

    .venv\\Scripts\\python.exe tests\\run_intent.py direct     # every model, same tools and instructions
    .venv\\Scripts\\python.exe tests\\run_intent.py deployed   # text through the deployed voice agent
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "client"), str(ROOT / "agent"), str(Path(__file__).parent)]

import common  # noqa: E402
from jarvis_tools import INSTRUCTIONS, TOOL_SCHEMAS, FakeBackend  # noqa: E402
from scoring import CASES, score_intent, score_status  # noqa: E402

MAX_ROUNDS = 5


def run_direct_case(client, model: str, effort: str | None, text: str) -> dict:
    backend = FakeBackend()
    model_input: list = [{"role": "user", "content": text}]
    calls, rounds, answer = [], [], ""
    started = time.monotonic()
    for _ in range(MAX_ROUNDS):
        request = dict(model=model, instructions=INSTRUCTIONS, input=model_input, tools=TOOL_SCHEMAS,
                       max_output_tokens=512, store=False)
        if effort:
            request["reasoning"] = {"effort": effort}
            request["include"] = ["reasoning.encrypted_content"]
        round_start = time.monotonic()
        response = client.responses.create(**request)
        rounds.append({
            "ms": int((time.monotonic() - round_start) * 1000),
            "input_tokens": response.usage.input_tokens,
            "cached_tokens": getattr(response.usage.input_tokens_details, "cached_tokens", 0),
            "output_tokens": response.usage.output_tokens,
        })
        function_calls = [item for item in response.output if item.type == "function_call"]
        answer += response.output_text or ""
        if not function_calls:
            break
        model_input.extend(item.model_dump(exclude_none=True, mode="json") for item in response.output)
        for call in function_calls:
            arguments = json.loads(call.arguments or "{}")
            result = backend.execute(call.name, arguments)
            calls.append({"name": call.name, "arguments": arguments})
            model_input.append({"type": "function_call_output", "call_id": call.call_id,
                                "output": json.dumps(result, ensure_ascii=False)})
    return {"calls": calls, "answer": answer.strip(), "rounds": rounds,
            "total_ms": int((time.monotonic() - started) * 1000)}


def direct(deployment) -> dict:
    from openai import OpenAI

    token = common.credential(deployment).get_token("https://ai.azure.com/.default").token
    client = OpenAI(api_key=token, base_url=f"{deployment.projectEndpoint}/openai/v1/")
    results = {}
    for model in deployment.models:
        effort = "none"
        rows = []
        for case in CASES["commands"] + CASES["status_questions"]:
            try:
                run = run_direct_case(client, model, effort, case["text"])
            except Exception as exc:  # noqa: BLE001
                if effort == "none" and "reasoning" in str(exc).lower():
                    effort = "low"
                    run = run_direct_case(client, model, effort, case["text"])
                else:
                    raise
            if "expect" in case:
                passed, note = score_intent(case, run["calls"])
            else:
                passed, note = score_status(case, run["answer"])
            rows.append({"id": case["id"], "text": case["text"], "passed": passed, "note": note, **run})
            print(f"{model:13} {case['id']} {'PASS' if passed else 'FAIL'} {run['total_ms']:5} ms  {note}")
        results[model] = {"reasoning_effort": effort, "summary": summarize(rows), "cases": rows}
    return results


def summarize(rows: list[dict]) -> dict:
    intent = [row for row in rows if row["id"].startswith("c")]
    status = [row for row in rows if row["id"].startswith("s")]
    totals = [row["total_ms"] for row in rows]
    first = [row["rounds"][0]["ms"] for row in rows if row.get("rounds")]
    return {
        "intent_passed": sum(row["passed"] for row in intent), "intent_total": len(intent),
        "status_passed": sum(row["passed"] for row in status), "status_total": len(status),
        "median_total_ms": int(statistics.median(totals)) if totals else None,
        "p90_total_ms": int(sorted(totals)[int(len(totals) * 0.9) - 1]) if totals else None,
        "median_first_round_ms": int(statistics.median(first)) if first else None,
        "input_tokens": sum(r["input_tokens"] for row in rows for r in row.get("rounds", [])),
        "cached_tokens": sum(r["cached_tokens"] or 0 for row in rows for r in row.get("rounds", [])),
        "output_tokens": sum(r["output_tokens"] for row in rows for r in row.get("rounds", [])),
        "cases": len(rows),
    }


async def deployed(deployment) -> dict:
    from voice_session import VoiceSession, now_ms

    table = common.table_client(deployment)
    results = []
    for case in CASES["commands"] + CASES["status_questions"]:
        # A fresh session per case gives every command the same starting data.
        async with VoiceSession(common.DEFAULT_VOICE_AGENT) as session:
            await session.wait_greeting()
            warm_sent = now_ms()
            warm = await session.wait_reply(await session.send_text("/diag"), timeout=120)
            cold_start_ms = (warm.first_audio_ms - warm_sent) if warm.first_audio_ms else None
            # Rows are matched by "new since before the command", not by clock: the container and
            # this PC clocks can differ by a second or more.
            before = {r["RowKey"] for r in await asyncio.to_thread(common.rows_since, table, warm_sent - 120_000)}
            sent = now_ms()
            turn = await session.wait_reply(await session.send_text(case["text"]), timeout=90)
            await asyncio.sleep(2.5)
            rows = [r for r in await asyncio.to_thread(common.rows_since, table, warm_sent - 120_000)
                    if r["RowKey"] not in before]
            connect_ms = session.connected_ms
        calls = [{"name": r["name"], "arguments": r.get("arguments")} for r in rows if r.get("kind") == "tool"]
        model_rows = [r for r in rows if r.get("kind") == "model"]
        if "expect" in case:
            passed, note = score_intent(case, calls)
        else:
            passed, note = score_status(case, turn.reply)
        row = {"id": case["id"], "text": case["text"], "passed": passed, "note": note,
               "calls": calls, "answer": turn.reply, "connect_ms": connect_ms,
               "cold_start_to_first_audio_ms": cold_start_ms,
               "text_to_first_audio_ms": (turn.first_audio_ms - sent) if turn.first_audio_ms else None,
               "model_rounds": [{k: r.get(k) for k in ("model", "round", "total_ms", "first_text_ms", "input_tokens", "cached_tokens", "output_tokens")} for r in model_rows],
               "voice_usage": turn.usage}
        results.append(row)
        print(f"deployed {case['id']} {'PASS' if passed else 'FAIL'} cold {cold_start_ms} ms, "
              f"warm {row['text_to_first_audio_ms']} ms to audio  {note}  | {turn.reply}", flush=True)
    table.close()
    passed = [r for r in results if r["id"].startswith("c") and r["passed"]]
    status = [r for r in results if r["id"].startswith("s") and r["passed"]]
    audio = [r["text_to_first_audio_ms"] for r in results if r["text_to_first_audio_ms"]]
    cold = [r["cold_start_to_first_audio_ms"] for r in results if r["cold_start_to_first_audio_ms"]]
    connect = [r["connect_ms"] for r in results if r["connect_ms"]]
    return {"model": deployment.jarvisModel,
            "summary": {"intent_passed": len(passed), "intent_total": len(CASES["commands"]),
                        "status_passed": len(status), "status_total": len(CASES["status_questions"]),
                        "median_text_to_first_audio_ms": int(statistics.median(audio)) if audio else None,
                        "p90_text_to_first_audio_ms": int(sorted(audio)[int(len(audio) * 0.9) - 1]) if audio else None,
                        "median_cold_start_ms": int(statistics.median(cold)) if cold else None,
                        "median_connect_ms": int(statistics.median(connect)) if connect else None},
            "cases": results}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["direct", "deployed"])
    args = parser.parse_args()
    deployment = common.load()
    data = direct(deployment) if args.mode == "direct" else asyncio.run(deployed(deployment))
    common.RESULTS.mkdir(exist_ok=True)
    path = common.RESULTS / f"intent-{args.mode}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"Saved {path}")


if __name__ == "__main__":
    main()

"""V2 Danish speech to text and V5 end-to-end voice, using synthetic Danish speech.

    .venv\\Scripts\\python.exe tests\\run_voice.py [--variants jarvis-voice jarvis-voice-mai ...]

Each command is spoken by Azure text to speech (two Danish voices; the second faster
and with light background noise), streamed in real time to a voice agent, and scored
for what was heard, which tool ran, and how fast the reply started.
"""

from __future__ import annotations

import argparse
import array
import asyncio
import json
import random
import statistics
import sys
import time
from pathlib import Path
from xml.sax.saxutils import escape

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "client"), str(Path(__file__).parent)]

import common  # noqa: E402
from scoring import CASES, score_intent, wer  # noqa: E402
from voice_session import VoiceSession, now_ms  # noqa: E402

AUDIO_DIR = common.RESULTS / "audio"
VOICES = {
    "christel": {"name": "da-DK-ChristelNeural", "rate": "+0%", "noise": 0},
    "jeppe": {"name": "da-DK-JeppeNeural", "rate": "+10%", "noise": 350},
}
PLANS = {
    "jarvis-voice": ["christel", "jeppe"],
    "jarvis-voice-mai": ["christel", "jeppe"],
    "jarvis-voice-nophrase": ["christel"],
    "jarvis-voice-auto": ["christel"],
}


def synthesize(deployment, voice_key: str, case: dict) -> bytes:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    path = AUDIO_DIR / f"{voice_key}-{case['id']}.pcm"
    if path.exists():
        return path.read_bytes()
    voice = VOICES[voice_key]
    token = common.credential(deployment).get_token("https://cognitiveservices.azure.com/.default").token
    ssml = (f"<speak version='1.0' xml:lang='da-DK'><voice name='{voice['name']}'>"
            f"<prosody rate='{voice['rate']}'>{escape(case['text'])}</prosody></voice></speak>")
    headers = {"Content-Type": "application/ssml+xml",
               "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm",
               "User-Agent": "jarvis-voice-prototype"}
    attempts = [
        (f"{deployment.speechEndpoint}/tts/cognitiveservices/v1", f"Bearer {token}"),
        (f"https://{deployment.location}.tts.speech.microsoft.com/cognitiveservices/v1",
         f"Bearer aad#{deployment.foundryResourceId}#{token}"),
    ]
    errors = []
    for url, auth in attempts:
        response = requests.post(url, headers={**headers, "Authorization": auth}, data=ssml.encode("utf-8"), timeout=60)
        if response.ok and response.content:
            pcm = add_noise(response.content, voice["noise"])
            path.write_bytes(pcm)
            return pcm
        errors.append(f"{url}: HTTP {response.status_code}")
    raise RuntimeError("Text to speech failed: " + "; ".join(errors))


def add_noise(pcm: bytes, amplitude: int) -> bytes:
    if not amplitude:
        return pcm
    samples = array.array("h", pcm)
    rng = random.Random(7)
    for i, value in enumerate(samples):
        samples[i] = max(-32768, min(32767, value + int(rng.gauss(0, amplitude))))
    return samples.tobytes()


# End-to-end intent (V5) needs the same starting data for every command, so this
# combination gets a fresh, warmed session per command. Other runs share one session
# and are used for speech-to-text accuracy (V2).
FRESH = {("jarvis-voice", "christel"), ("jarvis-voice-mai", "christel")}


async def run_case(session, deployment, variant: str, voice_key: str, case: dict, table) -> dict:
    pcm = synthesize(deployment, voice_key, case)
    before = len(session.turns)
    start = now_ms()
    seen = {r["RowKey"] for r in await asyncio.to_thread(common.rows_since, table, start - 120_000)}
    await session.send_silence(0.3)
    await session.send_pcm(pcm)
    clip_end = now_ms()
    silence = asyncio.create_task(session.send_silence(2.0))
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        new = session.turns[before:]
        if new and all(t.response_done_ms for t in new) and any(t.heard for t in new):
            break
        await asyncio.sleep(0.1)
    await silence
    await asyncio.sleep(1.5)
    new = session.turns[before:]
    heard = " ".join(t.heard for t in new if t.heard)
    first_audio = min((t.first_audio_ms for t in new if t.first_audio_ms), default=None)
    log = [r for r in await asyncio.to_thread(common.rows_since, table, start - 120_000) if r["RowKey"] not in seen]
    calls = [{"name": r["name"], "arguments": r.get("arguments")} for r in log if r.get("kind") == "tool"]
    passed, note = score_intent(case, calls)
    row = {
        "variant": variant, "voice": voice_key, "id": case["id"], "text": case["text"],
        "fresh_session": (variant, voice_key) in FRESH,
        "heard": heard, "wer": round(wer(case["text"], heard), 3),
        "turns": len(new), "intent_passed": passed, "intent_note": note, "calls": calls,
        "reply": " ".join(t.reply for t in new if t.reply),
        "end_of_speech_to_first_audio_ms": (first_audio - clip_end) if first_audio else None,
        "vad_stop_to_first_audio_ms": new[0].latency_ms if new else None,
        "model_rounds": [{k: r.get(k) for k in ("round", "total_ms", "first_text_ms", "input_tokens", "cached_tokens", "output_tokens")}
                         for r in log if r.get("kind") == "model"],
        "voice_usage": [t.usage for t in new],
    }
    print(f"{variant:22} {voice_key:8} {case['id']} WER {row['wer']:.2f} "
          f"{'PASS' if passed else 'FAIL'} {row['end_of_speech_to_first_audio_ms']} ms | {heard}", flush=True)
    return row


async def warmed_session(variant: str) -> VoiceSession:
    session = VoiceSession(variant)
    await session.__aenter__()
    await session.wait_greeting()
    await session.wait_reply(await session.send_text("/diag"), timeout=120)
    return session


async def run_variant(deployment, variant: str, voice_keys: list[str], table) -> list[dict]:
    rows = []
    for voice_key in voice_keys:
        if (variant, voice_key) in FRESH:
            for case in CASES["commands"]:
                session = await warmed_session(variant)
                try:
                    rows.append(await run_case(session, deployment, variant, voice_key, case, table))
                finally:
                    await session.__aexit__(None, None, None)
        else:
            session = await warmed_session(variant)
            try:
                for case in CASES["commands"]:
                    rows.append(await run_case(session, deployment, variant, voice_key, case, table))
                if session.errors:
                    print(f"{variant} errors: {session.errors}")
            finally:
                await session.__aexit__(None, None, None)
    return rows

def summarize(rows: list[dict]) -> dict:
    out = {}
    for key in sorted({(r["variant"], r["voice"]) for r in rows}):
        group = [r for r in rows if (r["variant"], r["voice"]) == key]
        latencies = [r["end_of_speech_to_first_audio_ms"] for r in group if r["end_of_speech_to_first_audio_ms"]]
        out[f"{key[0]}/{key[1]}"] = {
            "mean_wer": round(statistics.mean(r["wer"] for r in group), 3),
            "exact_transcripts": sum(r["wer"] == 0 for r in group),
            "intent_passed": sum(r["intent_passed"] for r in group),
            "cases": len(group),
            "median_end_of_speech_to_first_audio_ms": int(statistics.median(latencies)) if latencies else None,
            "p90_end_of_speech_to_first_audio_ms": int(sorted(latencies)[int(len(latencies) * 0.9) - 1]) if latencies else None,
        }
    return out


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variants", nargs="+", default=list(PLANS), choices=list(PLANS))
    args = parser.parse_args()
    deployment = common.load()
    rows: list[dict] = []
    with common.table_client(deployment) as table:
        for variant in args.variants:
            rows += await run_variant(deployment, variant, PLANS[variant], table)
    summary = summarize(rows)
    path = common.RESULTS / "voice.json"
    previous = json.loads(path.read_text(encoding="utf-8"))["cases"] if path.exists() else []
    merged = [r for r in previous if r["variant"] not in args.variants] + rows
    path.write_text(json.dumps({"summary": summarize(merged), "cases": merged}, ensure_ascii=False, indent=2,
                               default=str), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"Saved {path}")


if __name__ == "__main__":
    asyncio.run(main())

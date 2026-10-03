"""V6 interruption: speaking over Jarvis stops the reply, and the next turn works.

    .venv\\Scripts\\python.exe tests\\run_interrupt.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "client"), str(Path(__file__).parent)]

import common  # noqa: E402
from run_voice import synthesize  # noqa: E402
from voice_session import VoiceSession, now_ms  # noqa: E402

LONG = {"id": "i01", "text": "Fortæl mig om alle opgaverne, én ad gangen, med alle detaljer du har."}
BARGE = {"id": "i02", "text": "Stop. Hvad er status på Banking-opgaven?"}


async def wait_for(predicate, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.05)
    return False


async def main() -> None:
    """Speech synthesis is faster than real time, so the whole reply is usually generated before
    Dan interrupts. Interrupting therefore means: Voice Live detects Dan's speech while the reply
    is still playing, the client stops playback on `speech_started`, and the new turn is answered."""
    deployment = common.load()
    long_pcm = synthesize(deployment, "christel", LONG)
    barge_pcm = synthesize(deployment, "jeppe", BARGE)
    audio_by_turn: dict[int, int] = {}
    session = VoiceSession(common.DEFAULT_VOICE_AGENT)

    def on_audio(pcm: bytes) -> None:
        turn = session._responding
        if turn is not None:
            audio_by_turn[turn.index] = audio_by_turn.get(turn.index, 0) + len(pcm)

    session.on_audio = on_audio
    async with session:
        await session.wait_greeting()
        await session.send_pcm(long_pcm)
        silence = asyncio.create_task(session.send_silence(4.0))
        await wait_for(lambda: any(t.first_audio_ms for t in session.turns), 60)
        first = next((t for t in session.turns if t.first_audio_ms), None)
        await asyncio.sleep(1.5)
        silence.cancel()
        before = len(session.turns)
        barge_start = now_ms()
        await session.send_pcm(barge_pcm)
        await session.send_silence(2.0)
        answered = await wait_for(
            lambda: any(t.response_done_ms and t.reply for t in session.turns[before:]), 60)
        await asyncio.sleep(1.0)
        new_turns = session.turns[before:]
        second = next((t for t in new_turns if t.reply), None)
        detected = min((t.speech_started_ms for t in new_turns if t.speech_started_ms), default=None)

    first_seconds = audio_by_turn.get(first.index, 0) / 48000 if first else 0
    playback_end_ms = (first.first_audio_ms + int(first_seconds * 1000)) if first else None
    detection_ms = (detected - barge_start) if detected else None
    still_playing = bool(detected and playback_end_ms and detected < playback_end_ms)
    correct = bool(second and ("42" in second.reply or "færdig" in second.reply.lower()))
    passed = bool(still_playing and detection_ms is not None and detection_ms < 1500 and answered and correct)
    result = {
        "passed": passed,
        "first_reply_audio_seconds": round(first_seconds, 1),
        "barge_in_after_first_audio_ms": barge_start - first.first_audio_ms if first else None,
        "speech_detected_after_barge_in_ms": detection_ms,
        "reply_still_playing_when_detected": still_playing,
        "playback_remaining_at_detection_ms": (playback_end_ms - detected) if still_playing else None,
        "second_turn_correct": correct,
        "first_reply": first.as_dict() if first else None,
        "second_turn": second.as_dict() if second else None,
        "errors": session.errors,
    }
    path = common.RESULTS / "interrupt.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k not in {"first_reply", "second_turn"}}, indent=2))
    if second:
        print(f"After barge-in heard: {second.heard} | reply: {second.reply}")
    print(f"Saved {path}")

if __name__ == "__main__":
    asyncio.run(main())

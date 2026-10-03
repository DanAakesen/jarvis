"""Talk Danish to Jarvis through Voice Live with your microphone.

    .venv\\Scripts\\python.exe client\\talk.py [--agent jarvis-voice] [--half-duplex]

Shows what Voice Live heard, which Jarvis tools ran, the reply, and timings.
The session is saved to results\\live-<time>.json when you press Ctrl+C.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import queue
import re
import sys
import threading
import time
from pathlib import Path

import aiohttp
import pyaudio

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402
from voice_session import VoiceSession, now_ms  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent"))
from jarvis_tools import FakeBackend  # noqa: E402

RATE = 24000
CHUNK = 960  # 40 ms


class Audio:
    def __init__(self, loop: asyncio.AbstractEventLoop, half_duplex: bool) -> None:
        self.loop = loop
        self.half_duplex = half_duplex
        self.pa = pyaudio.PyAudio()
        self.captured: asyncio.Queue[bytes] = asyncio.Queue()
        self.playback: queue.Queue[bytes] = queue.Queue()
        self.remaining = b""
        self.lock = threading.Lock()
        self.enabled = True
        self.last_played = 0.0
        self.mic = self.pa.open(format=pyaudio.paInt16, channels=1, rate=RATE, input=True,
                                frames_per_buffer=CHUNK, stream_callback=self._capture, start=False)
        self.speaker = self.pa.open(format=pyaudio.paInt16, channels=1, rate=RATE, output=True,
                                    frames_per_buffer=CHUNK, stream_callback=self._play)

    def _capture(self, data, *_):
        if self.half_duplex and time.monotonic() - self.last_played < 0.3:
            data = bytes(len(data))
        self.loop.call_soon_threadsafe(self.captured.put_nowait, data)
        return (None, pyaudio.paContinue)

    def _play(self, _data, frames, *_):
        need = frames * 2
        with self.lock:
            out = self.remaining
            self.remaining = b""
            while len(out) < need:
                try:
                    out += self.playback.get_nowait()
                    self.last_played = time.monotonic()
                except queue.Empty:
                    out += bytes(need - len(out))
            self.remaining = out[need:]
        return (out[:need], pyaudio.paContinue)

    def play(self, pcm: bytes) -> None:
        with self.lock:
            if self.enabled:
                self.playback.put(pcm)

    def stop(self) -> None:
        with self.lock:
            self.enabled = False
            self.remaining = b""
            while not self.playback.empty():
                self.playback.get_nowait()

    def resume(self) -> None:
        with self.lock:
            self.enabled = True

    def close(self) -> None:
        for stream in (self.mic, self.speaker):
            if stream.is_active():
                stream.stop_stream()
            stream.close()
        self.pa.terminate()


def realtime_cost(model: str, usage: dict[str, int]) -> float:
    """List-price estimate from results/prices.json (Voice Live Pro, or Standard for mini)."""
    prices = json.loads((common.RESULTS / "prices.json").read_text(encoding="utf-8-sig"))["voiceLive"]
    tier = "Std" if "mini" in model else "Pro"

    def price(kind: str) -> float:
        for meter in prices:
            name = meter["meterName"]
            if re.search(rf"API {tier}\s*-\s*LLM {kind} Tokens$", name):
                return meter["retailPrice"] / 1000
        return 0.0

    return (usage.get("input_audio", 0) * price("Audio Input") + usage.get("output_audio", 0) * price("Audio Output")
            + usage.get("input_text", 0) * price("Text Input") + usage.get("output_text", 0) * price("Text Output"))


def describe_tool(row: dict) -> str:
    args = row.get("arguments") or {}
    shown = ", ".join(f"{key}={value!r}" for key, value in args.items()) if isinstance(args, dict) else args
    result = row.get("result")
    outcome = "fejl: " + result["error"] if isinstance(result, dict) and "error" in result else "ok"
    return f"   → værktøj {row.get('name')}({shown})  [{outcome}]"


async def poll_tools(session_start_ms: int, tool_rows: list[dict]) -> None:
    deployment = common.load()
    # Match "new since start", not by clock: the agent's container clock can differ from this PC.
    window = session_start_ms - 120_000
    with common.table_client(deployment) as table:
        seen = {row["RowKey"] for row in await asyncio.to_thread(common.rows_since, table, window)}
        while True:
            try:
                rows = await asyncio.to_thread(common.rows_since, table, window)
            except Exception as exc:  # noqa: BLE001 - keep the conversation running
                print(f"   (kunne ikke læse værktøjsloggen: {exc.__class__.__name__})")
                await asyncio.sleep(5)
                continue
            for row in rows:
                if row["RowKey"] in seen:
                    continue
                seen.add(row["RowKey"])
                tool_rows.append(row)
                if row.get("kind") == "tool":
                    print(describe_tool(row))
                elif row.get("kind") == "model":
                    print(f"   · {row.get('model')} runde {row.get('round')}: {row.get('total_ms')} ms, "
                          f"{row.get('input_tokens')} ind / {row.get('output_tokens')} ud tokens")
            await asyncio.sleep(0.5)


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent", default=common.DEFAULT_VOICE_AGENT,
                        choices=sorted(common.VOICE_VARIANTS) + sorted(common.REALTIME_VARIANTS))
    parser.add_argument("--half-duplex", action="store_true",
                        help="Mute the microphone while Jarvis speaks (use without a headset; no interrupting).")
    args = parser.parse_args()

    loop = asyncio.get_running_loop()
    audio = Audio(loop, args.half_duplex)
    tool_rows: list[dict] = []
    start_ms = now_ms()

    realtime = args.agent in common.REALTIME_VARIANTS
    backend = FakeBackend()
    tool_outputs_sent = False
    usage_totals: dict[str, int] = {}

    def run_tool(event) -> None:
        nonlocal tool_outputs_sent
        try:
            arguments = json.loads(event["arguments"] or "{}")
        except json.JSONDecodeError:
            arguments = {}
        result = backend.execute(event["name"], arguments)
        row = {"kind": "tool", "name": event["name"], "arguments": arguments, "result": result, "at_ms": now_ms()}
        tool_rows.append(row)
        print(describe_tool(row))
        tool_outputs_sent = True
        loop.create_task(session.connection.conversation.item.create(item={
            "type": "function_call_output", "call_id": event["call_id"],
            "output": json.dumps(result, ensure_ascii=False)}))

    def add_usage(event) -> None:
        usage = (event.get("response") or {}).get("usage") or {}
        for side in ("input", "output"):
            details = usage.get(f"{side}_token_details") or {}
            for kind in ("audio", "text"):
                key = f"{side}_{kind}"
                usage_totals[key] = usage_totals.get(key, 0) + int(details.get(f"{kind}_tokens") or 0)
            cached = (details.get("cached_tokens") or 0) if side == "input" else 0
            usage_totals["input_cached"] = usage_totals.get("input_cached", 0) + int(cached)

    warming = False
    greeted = False

    def on_event(kind: str, event) -> None:
        nonlocal tool_outputs_sent
        if kind == "input_audio_buffer.speech_started":
            audio.stop()
        elif kind == "response.created":
            if not warming:
                audio.resume()
        elif realtime and kind == "response.function_call_arguments.done":
            run_tool(event)
        elif realtime and kind == "response.done":
            add_usage(event)
            if tool_outputs_sent:
                tool_outputs_sent = False
                loop.create_task(session.connection.response.create())
        elif kind == "conversation.item.input_audio_transcription.completed":
            print(f"\nDu:     {event['transcript']}")
        elif kind in {"response.output_audio_transcript.done", "response.audio_transcript.done"}:
            if warming or (greeted and session.greeting is session._responding):
                return
            turn = session._responding
            latency = f"  ({turn.latency_ms} ms fra du stoppede)" if turn and turn.latency_ms else ""
            print(f"Jarvis: {event['transcript']}{latency}")
        elif kind == "error":
            print(f"FEJL: {event['error']['message'] if isinstance(event, dict) or hasattr(event, 'get') else event}")

    sessions: list[VoiceSession] = []
    poller = asyncio.create_task(asyncio.sleep(0) if realtime else poll_tools(start_ms, tool_rows))
    try:
        while True:
            print(f"Forbinder til {args.agent} …")
            session = VoiceSession(args.agent, on_audio=audio.play, on_event=on_event)
            sessions.append(session)
            try:
                async with session:
                    await session.wait_greeting(30)
                    greeted = True
                    if not realtime:
                        # Preview voice bridge: interrupting the first answer of a fresh agent can drop
                        # the bridge. A silent no-model message first avoids that window (L21).
                        warming = True
                        audio.stop()
                        try:
                            await session.wait_reply(await session.send_text("/diag"), timeout=60)
                        finally:
                            warming = False
                            audio.resume()
                    print(f"Klar efter {session.connected_ms} ms. Tal dansk. Ctrl+C stopper.\n")
                    audio.mic.start_stream() if not audio.mic.is_active() else None
                    while True:
                        await session.connection.input_audio_buffer.append(audio=await audio.captured.get())
            except (ConnectionError, aiohttp.ClientError, TimeoutError) as exc:
                print(f"\nForbindelsen til Jarvis blev afbrudt ({exc.__class__.__name__}). Forbinder igen …\n")
                while not audio.captured.empty():
                    audio.captured.get_nowait()
                await asyncio.sleep(1)
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        poller.cancel()
        audio.close()
        common.RESULTS.mkdir(exist_ok=True)
        path = common.RESULTS / f"live-{time.strftime('%Y%m%d-%H%M%S')}.json"
        path.write_text(json.dumps({
            "agent": args.agent,
            "connections": [{
                "connected_ms": s.connected_ms,
                "greeting": s.greeting.as_dict() if s.greeting else None,
                "turns": [turn.as_dict() for turn in s.turns],
                "errors": s.errors,
            } for s in sessions],
            "tool_log": tool_rows,
            "realtime_usage": usage_totals if realtime else None,
        }, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        if realtime and usage_totals:
            cost = realtime_cost(common.REALTIME_VARIANTS[args.agent]["model"], usage_totals)
            print(f"\nTokens: {usage_totals}\nAnslået pris for samtalen: {cost:.2f} DKK (listepris)")
        print(f"\nSamtalen er gemt i {path}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

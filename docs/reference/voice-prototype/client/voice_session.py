"""One Voice Live session with the Jarvis voice agent, recording each turn.

Used by the live console client and by the scripted checks.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from azure.ai.projects.aio import AIProjectClient

import common


def _get(event: Any, key: str, default: Any = None) -> Any:
    try:
        value = event[key]
    except (KeyError, TypeError, IndexError):
        value = getattr(event, key, default)
    return default if value is None else value


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Turn:
    index: int
    speech_started_ms: int | None = None
    speech_stopped_ms: int | None = None
    heard: str = ""
    response_created_ms: int | None = None
    first_audio_ms: int | None = None
    reply: str = ""
    response_done_ms: int | None = None
    interrupted: bool = False
    response_status: str = ""
    usage: dict[str, Any] = field(default_factory=dict)
    tools: list[dict[str, Any]] = field(default_factory=list)

    @property
    def latency_ms(self) -> int | None:
        """End of Dan's speech to the first reply audio."""
        if self.speech_stopped_ms is None or self.first_audio_ms is None:
            return None
        return self.first_audio_ms - self.speech_stopped_ms

    def as_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "heard": self.heard,
            "reply": self.reply,
            "latency_ms": self.latency_ms,
            "interrupted": self.interrupted,
            "response_status": self.response_status,
            "speech_stopped_ms": self.speech_stopped_ms,
            "first_audio_ms": self.first_audio_ms,
            "response_done_ms": self.response_done_ms,
            "usage": self.usage,
            "tools": self.tools,
        }


class VoiceSession:
    """Connects to a voice agent and turns server events into Turn records."""

    def __init__(
        self,
        agent_name: str = common.DEFAULT_VOICE_AGENT,
        on_audio: Callable[[bytes], None] | None = None,
        on_event: Callable[[str, Any], None] | None = None,
    ) -> None:
        self.agent_name = agent_name
        self.deployment = common.load()
        self.on_audio = on_audio
        self.on_event = on_event
        self.turns: list[Turn] = []
        self.greeting: Turn | None = None
        self.errors: list[str] = []
        self.ready = asyncio.Event()
        self.response_done = asyncio.Event()
        self.connected_ms: int | None = None
        self._pending_speech: Turn | None = None
        self._responding: Turn | None = None
        self._credential = None
        self._client = None
        self._manager = None
        self.connection = None
        self._receiver: asyncio.Task | None = None

    async def __aenter__(self) -> "VoiceSession":
        self._credential = common.credential(self.deployment, aio=True)
        self._client = AIProjectClient(
            endpoint=self.deployment.projectEndpoint, credential=self._credential, allow_preview=True
        )
        self._manager = self._client.beta.voice_agents.realtime.connect(
            agent_name=self.agent_name, agent_session_id=uuid.uuid4().hex
        )
        started = now_ms()
        self.connection = await self._manager.__aenter__()
        self._receiver = asyncio.create_task(self._receive())
        await asyncio.wait_for(self.ready.wait(), timeout=90)
        self.connected_ms = now_ms() - started
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if self._receiver:
            self._receiver.cancel()
            await asyncio.gather(self._receiver, return_exceptions=True)
        if self._manager:
            try:
                await self._manager.__aexit__(None, None, None)
            except Exception:  # noqa: BLE001 - the connection may already be gone
                pass
        if self._client:
            await self._client.close()
        if self._credential:
            await self._credential.close()

    def _current_turn(self) -> Turn:
        if self._pending_speech is None:
            self._pending_speech = Turn(index=len(self.turns) + 1)
            self.turns.append(self._pending_speech)
        return self._pending_speech

    async def _receive(self) -> None:
        async for event in self.connection:
            kind = _get(event, "type", "")
            stamp = now_ms()
            if kind in {"session.created", "session.updated"}:
                self.ready.set()
            elif kind == "input_audio_buffer.speech_started":
                if self._responding is not None and self._responding.response_done_ms is None:
                    self._responding.interrupted = True
                turn = self._current_turn()
                turn.speech_started_ms = turn.speech_started_ms or stamp
            elif kind == "input_audio_buffer.speech_stopped":
                self._current_turn().speech_stopped_ms = stamp
            elif kind == "conversation.item.input_audio_transcription.completed":
                turn = self._current_turn()
                turn.heard = (turn.heard + " " + _get(event, "transcript", "")).strip()
            elif kind == "response.created":
                self.response_done.clear()
                if self._pending_speech is None and self.greeting is None and not self.turns:
                    self.greeting = Turn(index=0)
                    self._responding = self.greeting
                else:
                    self._responding = self._pending_speech or Turn(index=len(self.turns) + 1)
                    if self._responding not in self.turns:
                        self.turns.append(self._responding)
                    self._pending_speech = None
                self._responding.response_created_ms = stamp
            elif kind == "response.output_audio.delta" or kind == "response.audio.delta":
                if self._responding is not None and self._responding.first_audio_ms is None:
                    self._responding.first_audio_ms = stamp
                if self.on_audio:
                    delta = _get(event, "delta", b"")
                    if isinstance(delta, str):
                        import base64

                        delta = base64.b64decode(delta)
                    self.on_audio(delta)
            elif kind in {"response.output_audio_transcript.done", "response.audio_transcript.done"}:
                if self._responding is not None:
                    self._responding.reply = (
                        self._responding.reply + " " + _get(event, "transcript", "")
                    ).strip()
            elif kind == "response.done":
                if self._responding is not None:
                    response = _get(event, "response", {})
                    self._responding.response_done_ms = stamp
                    self._responding.response_status = str(_get(response, "status", ""))
                    usage = _get(response, "usage", None)
                    if usage is not None:
                        as_dict = getattr(usage, "as_dict", None)
                        self._responding.usage = as_dict() if callable(as_dict) else json.loads(
                            json.dumps(usage, default=str))
                self.response_done.set()
            elif kind == "error":
                error = _get(event, "error", {})
                self.errors.append(str(_get(error, "message", error)))
            if self.on_event:
                self.on_event(kind, event)

    async def send_pcm(self, pcm: bytes, realtime: bool = True, chunk_ms: int = 40) -> None:
        """Stream 24 kHz 16-bit mono PCM, paced like a microphone."""
        chunk = 24000 * 2 * chunk_ms // 1000
        for offset in range(0, len(pcm), chunk):
            await self.connection.input_audio_buffer.append(audio=pcm[offset:offset + chunk])
            if realtime:
                await asyncio.sleep(chunk_ms / 1000)

    async def send_silence(self, seconds: float) -> None:
        await self.send_pcm(bytes(int(24000 * seconds) * 2))

    async def send_text(self, text: str) -> Turn:
        """Send a typed user message and ask for a reply (deployed text path)."""
        turn = Turn(index=len(self.turns) + 1, heard=text)
        turn.speech_stopped_ms = now_ms()
        self.turns.append(turn)
        self._pending_speech = turn
        await self.connection.conversation.item.create(
            item={"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}
        )
        await self.connection.response.create()
        return turn

    async def wait_reply(self, turn: Turn, timeout: float = 60) -> Turn:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if turn.response_done_ms is not None:
                return turn
            await asyncio.sleep(0.1)
        raise TimeoutError(f"No reply for turn {turn.index} within {timeout} s")

    async def wait_greeting(self, timeout: float = 60) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.greeting is not None and self.greeting.response_done_ms is not None:
                return
            await asyncio.sleep(0.1)

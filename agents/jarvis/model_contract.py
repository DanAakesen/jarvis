# Copyright (c) Microsoft. All rights reserved.

"""Model backend contract for the Voice Live Bridge sample."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from state import ModelMessage, ModelSettings

MAX_ACKNOWLEDGMENT_CHARACTERS = 500


@dataclass(frozen=True, slots=True)
class AcknowledgmentBoundary:
    """Marks the streamed pre-tool intent sentence as an interim response segment."""

    text: str
    kind: Literal["acknowledgment", "commentary"] = "acknowledgment"


ModelStreamChunk = str | AcknowledgmentBoundary


def public_update_boundaries(
    text: str, kind: Literal["acknowledgment", "commentary"],
) -> Iterator[AcknowledgmentBoundary]:
    """Keep a public update intact across bounded UTF-16 wire segments."""
    start = units = 0
    for index, character in enumerate(text):
        size = 2 if ord(character) > 0xFFFF else 1
        if units + size > MAX_ACKNOWLEDGMENT_CHARACTERS:
            segment = text[start:index]
            if segment.strip():
                yield AcknowledgmentBoundary(segment, kind=kind)
                kind = "commentary"
            start, units = index, 0
        units += size
    if text[start:].strip():
        yield AcknowledgmentBoundary(text[start:], kind=kind)


class ToolLoopStalled(RuntimeError):
    """The model kept requesting already-completed tools after a final-only retry."""

    code = "tool_loop_stalled"


@dataclass(frozen=True, slots=True)
class SummaryCompletion:
    """One finished (non-streaming) summary reply and the model that wrote it."""

    text: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class ConversationSummarizer(Protocol):
    """Optional capability: write the rolling conversation summary (P9-105)."""

    async def summarize_conversation(self, instructions: str, prompt: str) -> SummaryCompletion:
        """Return the summary text; raise on any failure, including a truncated answer."""
        ...


class StreamingModelClient(Protocol):
    """Response backend consumed by the Voice Live Bridge runtime."""

    model_name: str
    server_address: str

    async def session_settings(self) -> ModelSettings:
        """Load effective model settings for a newly starting session."""
        ...

    async def complete(
        self, messages: Sequence[ModelMessage], *, settings: ModelSettings | None = None
    ) -> AsyncIterator[ModelStreamChunk]:
        """Yield ordered assistant text chunks."""
        if False:
            yield ""

    async def complete_chat(
        self,
        messages: Sequence[ModelMessage],
        language: str,
        *,
        settings: ModelSettings | None = None,
        reflex_note: str | None = None,
    ) -> AsyncIterator[ModelStreamChunk]:
        """Yield ordered text-chat chunks, loading current settings when omitted."""
        if False:
            yield ""

    async def close(self) -> None:
        """Release backend resources."""

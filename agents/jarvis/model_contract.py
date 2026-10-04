# Copyright (c) Microsoft. All rights reserved.

"""Model backend contract for the Voice Live Bridge sample."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Protocol

from state import ModelMessage, ModelSettings


class StreamingModelClient(Protocol):
    """Response backend consumed by the Voice Live Bridge runtime."""

    model_name: str
    server_address: str

    async def session_settings(self) -> ModelSettings:
        """Load effective model settings for a newly starting session."""
        ...

    async def complete(
        self, messages: Sequence[ModelMessage], *, settings: ModelSettings | None = None
    ) -> AsyncIterator[str]:
        """Yield ordered assistant text chunks."""
        if False:
            yield ""

    async def complete_chat(
        self, messages: Sequence[ModelMessage], language: str
    ) -> AsyncIterator[str]:
        """Yield ordered text-chat chunks."""
        if False:
            yield ""

    async def close(self) -> None:
        """Release backend resources."""

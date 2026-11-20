# Copyright (c) Microsoft. All rights reserved.

"""Historical voice-bridge entry point retained for isolated hosted-runtime
use, not normal GPT-Live voice."""

from __future__ import annotations

import logging
import os
from typing import Any

from azure.ai.agentserver.invocations.voice import VoiceAgentServerHost

from managed_runtime_factory import LazyManagedRuntime
from model_client import AzureOpenAIResponsesClient
from model_contract import StreamingModelClient
from voice_runtime import create_app as create_voice_app


def create_app(
    model_client: StreamingModelClient | None = None,
    **host_options: Any,
) -> VoiceAgentServerHost:
    """Create the Voice Live Bridge application."""
    current = model_client or AzureOpenAIResponsesClient.from_environment()
    if isinstance(current, AzureOpenAIResponsesClient):
        host_options.setdefault("copilot_chat_client", LazyManagedRuntime(current))
    return create_voice_app(current, **host_options)


def main() -> None:
    """Run the hosted-agent server."""
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
    create_app().run()


if __name__ == "__main__":
    main()
"""Provision the Danish Voice Live agent that wraps the hosted Jarvis agent."""

from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import urlsplit

DANISH_AGENT_NAME = "jarvis-voice-mai"
HOSTED_AGENT_NAME = "jarvis"
DANISH_VOICE = "en-US-Harper:MAI-Voice-2"
DANISH_LOCALE = "da-DK"
GREETING = "Hej Dan. Hvad skal jeg gøre?"
PHRASE_LIST = [
    "Jarvis",
    "Codex",
    "Copilot",
    "Daily",
    "Banking",
    "dark mode",
    "pull request",
    "README",
    "CSS",
    "Tailwind",
    "CSV",
    "login",
]


def validate_project_endpoint(endpoint: str) -> str:
    try:
        parsed = urlsplit(endpoint)
        port = parsed.port
    except ValueError:
        raise ValueError("FOUNDRY_PROJECT_ENDPOINT must be a secure Azure AI project URL") from None
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not parsed.hostname.endswith(".services.ai.azure.com")
        or port is not None
        or not re.fullmatch(r"/api/projects/[A-Za-z0-9][A-Za-z0-9._-]*", parsed.path)
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("FOUNDRY_PROJECT_ENDPOINT must be a secure Azure AI project URL")
    return endpoint


def agent_settings(hosted_agent_name: str = HOSTED_AGENT_NAME) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", hosted_agent_name):
        raise ValueError("Hosted Jarvis agent name is invalid")
    return {
        "hosted_agent_name": hosted_agent_name,
        "greeting": GREETING,
        "transcription": {
            "model": "mai-transcribe",
            "language": "da",
            "phrase_list": PHRASE_LIST,
        },
        "voice": DANISH_VOICE,
        "voice_locale": DANISH_LOCALE,
    }


def definition(hosted_agent_name: str = HOSTED_AGENT_NAME):
    from azure.ai.projects.models import (
        RealtimeAudioFormatsAudioPcm,
        VoiceAgentAudioConfig,
        VoiceAgentAudioInputConfig,
        VoiceAgentAudioOutputConfig,
        VoiceAgentDefinition,
        VoiceAgentInputTranscription,
        VoiceAgentServerVadTurnDetection,
        VoiceAgentTemplateGreetingConfig,
        VoiceHostedAgentConversationEngine,
        VoiceOutputModality,
        VoiceType,
    )

    settings = agent_settings(hosted_agent_name)
    return VoiceAgentDefinition(
        conversation_engine=VoiceHostedAgentConversationEngine(
            name=settings["hosted_agent_name"],
        ),
        greeting=VoiceAgentTemplateGreetingConfig(text=settings["greeting"]),
        store=False,
        output_modalities=[VoiceOutputModality.AUDIO],
        audio=VoiceAgentAudioConfig(
            input=VoiceAgentAudioInputConfig(
                format=RealtimeAudioFormatsAudioPcm(rate=24_000),
                turn_detection=VoiceAgentServerVadTurnDetection(
                    threshold=0.5,
                    prefix_padding_ms=300,
                    silence_duration_ms=700,
                ),
                transcription=VoiceAgentInputTranscription(**settings["transcription"]),
            ),
            output=VoiceAgentAudioOutputConfig(
                format=RealtimeAudioFormatsAudioPcm(rate=24_000),
                voice=settings["voice"],
                voice_type=VoiceType.AZURE_STANDARD,
                voice_locale=settings["voice_locale"],
            ),
        ),
    )


def main() -> None:
    from azure.ai.projects import AIProjectClient
    from azure.identity import AzureCliCredential

    endpoint = validate_project_endpoint(os.environ.get("FOUNDRY_PROJECT_ENDPOINT", ""))
    with (
        AzureCliCredential() as credential,
        AIProjectClient(endpoint=endpoint, credential=credential, allow_preview=True) as client,
    ):
        agent = client.agents.create_version(
            agent_name=DANISH_AGENT_NAME,
            description="Jarvis Danish voice; MAI Transcribe da with a Danish phrase list",
            definition=definition(),
        )
        print(f"Voice agent {agent.name} version {agent.version}")


if __name__ == "__main__":
    main()

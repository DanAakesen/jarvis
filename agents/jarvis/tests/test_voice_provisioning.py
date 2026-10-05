from __future__ import annotations

import pytest

from scripts.provision_danish_voice import (
    DANISH_AGENT_NAME,
    DANISH_LOCALE,
    DANISH_VOICE,
    HOSTED_AGENT_NAME,
    PHRASE_LIST,
    agent_settings,
    validate_project_endpoint,
)


def test_danish_voice_agent_settings() -> None:
    settings = agent_settings()
    assert DANISH_AGENT_NAME == "jarvis-voice-mai"
    assert settings["hosted_agent_name"] == HOSTED_AGENT_NAME == "jarvis"
    assert settings["transcription"] == {
        "model": "mai-transcribe",
        "language": "da",
        "phrase_list": PHRASE_LIST,
    }
    assert settings["voice"] == DANISH_VOICE == "en-US-Harper:MAI-Voice-2"
    assert settings["voice_locale"] == DANISH_LOCALE == "da-DK"
    assert settings["greeting"] == "Hej Dan. Hvad skal jeg gøre?"


def test_project_endpoint_requires_a_secure_foundry_project_url() -> None:
    endpoint = "https://resource.services.ai.azure.com/api/projects/jarvis"
    assert validate_project_endpoint(endpoint) == endpoint
    for invalid in (
        "",
        "http://resource.services.ai.azure.com/api/projects/jarvis",
        "https://resource.example/api/projects/jarvis",
        "https://resource.services.ai.azure.com/api/projects/jarvis?token=secret",
        "https://resource.services.ai.azure.com/api/projects/jarvis/",
    ):
        with pytest.raises(ValueError):
            validate_project_endpoint(invalid)


def test_hosted_agent_name_is_not_interpreted_as_a_path() -> None:
    with pytest.raises(ValueError):
        agent_settings("../other-agent")

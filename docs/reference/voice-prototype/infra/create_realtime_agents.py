"""Create speech-to-speech (gpt-realtime) voice agents for a quick comparison.

    .venv\\Scripts\\python.exe infra\\create_realtime_agents.py

These agents are model-backed: the realtime model hears audio directly and speaks
directly. Jarvis tools are function tools executed by the client (client\\talk.py)
with the same fake data as the hosted agent.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "client"), str(ROOT / "agent")]

from azure.ai.projects import AIProjectClient  # noqa: E402
from azure.ai.projects.models import (  # noqa: E402
    RealtimeAudioFormatsAudioPcm,
    VoiceAgentAudioConfig,
    VoiceAgentAudioInputConfig,
    VoiceAgentAudioOutputConfig,
    VoiceAgentDefinition,
    VoiceAgentFunctionTool,
    VoiceAgentInputTranscription,
    VoiceAgentLlmGeneratedGreetingConfig,
    VoiceAgentServerVadTurnDetection,
    VoiceAgentTemplateGreetingConfig,
    VoiceModelType,
    VoiceOutputModality,
    VoiceType,
)

import common  # noqa: E402
from jarvis_tools import INSTRUCTIONS, INSTRUCTIONS_EN, TOOL_SCHEMAS  # noqa: E402


def tools() -> list[VoiceAgentFunctionTool]:
    return [
        VoiceAgentFunctionTool(name=t["name"], description=t["description"], parameters=t["parameters"])
        for t in TOOL_SCHEMAS
    ]


def definition(model: str, voice: str, voice_type: VoiceType, lang: str = "da", locale: str | None = None) -> VoiceAgentDefinition:
    return VoiceAgentDefinition(
        model_type=VoiceModelType.MANAGED,
        model=model,
        instructions=INSTRUCTIONS_EN if lang == "en" else INSTRUCTIONS,
        tools=tools(),
        # Native OpenAI voices cannot speak fixed text; let the model say the greeting.
        greeting=(VoiceAgentTemplateGreetingConfig(text=common.GREETINGS[lang]) if voice_type == VoiceType.AZURE_STANDARD
                  else VoiceAgentLlmGeneratedGreetingConfig(prompt=f"Hils kort på dansk: '{common.GREETING}'")),
        store=False,
        output_modalities=[VoiceOutputModality.AUDIO],
        audio=VoiceAgentAudioConfig(
            input=VoiceAgentAudioInputConfig(
                format=RealtimeAudioFormatsAudioPcm(rate=24000),
                turn_detection=VoiceAgentServerVadTurnDetection(
                    threshold=0.5, prefix_padding_ms=300, silence_duration_ms=700
                ),
                # Only for showing what was heard; the realtime model listens to the audio itself.
                transcription=VoiceAgentInputTranscription(
                    model="mai-transcribe", language=lang, phrase_list=common.PHRASES
                ),
            ),
            output=VoiceAgentAudioOutputConfig(
                format=RealtimeAudioFormatsAudioPcm(rate=24000), voice=voice, voice_type=voice_type,
                voice_locale=(locale or common.LOCALES[lang]) if voice_type == VoiceType.AZURE_STANDARD else None,
            ),
        ),
    )


def main() -> None:
    deployment = common.load()
    with (
        common.credential(deployment) as credential,
        AIProjectClient(endpoint=deployment.projectEndpoint, credential=credential, allow_preview=True) as client,
    ):
        for name, spec in common.REALTIME_VARIANTS.items():
            agent = client.agents.create_version(
                agent_name=name,
                description=f"Jarvis speech-to-speech: {spec}",
                definition=definition(spec["model"], spec["voice"], VoiceType(spec["voice_type"]), spec.get("lang", "da"), spec.get("locale")),
            )
            print(f"Voice agent {agent.name} version {agent.version}")


if __name__ == "__main__":
    main()

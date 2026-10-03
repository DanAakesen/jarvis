"""Create the Danish voice agents that wrap the Jarvis hosted agent."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "client"))

from azure.ai.projects import AIProjectClient  # noqa: E402
from azure.ai.projects.models import (  # noqa: E402
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

import common  # noqa: E402


def definition(deployment: common.Deployment, transcription: dict) -> VoiceAgentDefinition:
    return VoiceAgentDefinition(
        conversation_engine=VoiceHostedAgentConversationEngine(name=deployment.hostedAgent),
        greeting=VoiceAgentTemplateGreetingConfig(text=common.GREETING),
        store=False,
        output_modalities=[VoiceOutputModality.AUDIO],
        audio=VoiceAgentAudioConfig(
            input=VoiceAgentAudioInputConfig(
                format=RealtimeAudioFormatsAudioPcm(rate=24000),
                turn_detection=VoiceAgentServerVadTurnDetection(
                    threshold=0.5, prefix_padding_ms=300, silence_duration_ms=700
                ),
                transcription=VoiceAgentInputTranscription(**transcription),
            ),
            output=VoiceAgentAudioOutputConfig(
                format=RealtimeAudioFormatsAudioPcm(rate=24000),
                voice=common.DANISH_VOICE,
                voice_type=VoiceType.AZURE_STANDARD,
                voice_locale=common.VOICE_LOCALE,
            ),
        ),
    )


def main() -> None:
    deployment = common.load()
    with (
        common.credential(deployment) as credential,
        AIProjectClient(
            endpoint=deployment.projectEndpoint, credential=credential, allow_preview=True
        ) as client,
    ):
        for name, transcription in common.VOICE_VARIANTS.items():
            agent = client.agents.create_version(
                agent_name=name,
                description=f"Jarvis Danish voice; transcription {transcription}",
                definition=definition(deployment, transcription),
            )
            print(f"Voice agent {agent.name} version {agent.version}")


if __name__ == "__main__":
    main()

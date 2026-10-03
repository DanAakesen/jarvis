"""Shared settings for the Jarvis voice prototype scripts on this PC."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / "infra" / ".deployment-state.json"
RESULTS = ROOT / "results"

PHRASES = [
    "Jarvis", "Codex", "Copilot", "Daily", "Banking", "dark mode", "pull request",
    "README", "CSS", "Tailwind", "CSV", "login",
]
# MAI-Voice-2 (Copilot's voice family) has no Danish voice; Harper speaks Danish with the locale locked.
DANISH_VOICE = "en-US-Harper:MAI-Voice-2"
VOICE_LOCALE = "da-DK"
GREETING = "Hej Dan. Hvad skal jeg gøre?"

# One voice agent per speech-to-text setting so tests can compare them on the same audio.
VOICE_VARIANTS: dict[str, dict[str, Any]] = {
    "jarvis-voice": {"model": "azure-speech", "language": "da-DK", "phrase_list": PHRASES},
    "jarvis-voice-nophrase": {"model": "azure-speech", "language": "da-DK"},
    "jarvis-voice-mai": {"model": "mai-transcribe", "language": "da", "phrase_list": PHRASES},
    "jarvis-voice-auto": {"model": "azure-speech"},
}
DEFAULT_VOICE_AGENT = "jarvis-voice-mai"

# Speech-to-speech agents: the realtime model hears and speaks itself; tools run in the client.
REALTIME_VARIANTS: dict[str, dict[str, str]] = {
    "jarvis-realtime": {"model": "gpt-realtime-2.1", "voice": "marin", "voice_type": "openai"},
    "jarvis-realtime-harper": {"model": "gpt-realtime-2.1", "voice": DANISH_VOICE, "voice_type": "azure-standard"},
    "jarvis-realtime-mini": {"model": "gpt-realtime-2.1-mini", "voice": "marin", "voice_type": "openai"},
    # English butler persona: British voice Dan picked, British English instructions.
    "jarvis-realtime-en": {"model": "gpt-realtime-2.1", "voice": "en-GB-Ryan:DragonHDLatestNeural",
                           "voice_type": "azure-standard", "lang": "en"},
    # MAI-Voice-2 has only American male English voices; same English Jarvis config as above.
    "jarvis-en-grant": {"model": "gpt-realtime-2.1", "voice": "en-US-Grant:MAI-Voice-2", "voice_type": "azure-standard", "lang": "en", "locale": "en-US"},
    "jarvis-en-ethan": {"model": "gpt-realtime-2.1", "voice": "en-US-Ethan:MAI-Voice-2", "voice_type": "azure-standard", "lang": "en", "locale": "en-US"},
    "jarvis-en-jasper": {"model": "gpt-realtime-2.1", "voice": "en-US-Jasper:MAI-Voice-2", "voice_type": "azure-standard", "lang": "en", "locale": "en-US"},
    "jarvis-en-grant-gb": {"model": "gpt-realtime-2.1", "voice": "en-US-Grant:MAI-Voice-2", "voice_type": "azure-standard", "lang": "en", "locale": "en-GB"},
}
GREETINGS = {"da": GREETING, "en": "Good evening, sir. How may I help?"}
LOCALES = {"da": VOICE_LOCALE, "en": "en-GB"}


@dataclass(frozen=True)
class Deployment:
    raw: dict[str, Any]

    def __getattr__(self, name: str) -> Any:
        try:
            return self.raw[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


def load() -> Deployment:
    if not STATE_PATH.exists():
        raise SystemExit(f"No deployment found at {STATE_PATH}. Run infra\\deploy.ps1 first.")
    return Deployment(json.loads(STATE_PATH.read_text(encoding="utf-8-sig")))


def credential(deployment: Deployment, aio: bool = False):
    """Azure CLI credential pinned to the prototype subscription (the CLI default tenant differs)."""
    if aio:
        from azure.identity.aio import AzureCliCredential
    else:
        from azure.identity import AzureCliCredential
    return AzureCliCredential(subscription=deployment.subscription, process_timeout=30)


def table_client(deployment: Deployment, aio: bool = False):
    if aio:
        from azure.data.tables.aio import TableClient
    else:
        from azure.data.tables import TableClient
    return TableClient(
        endpoint=f"https://{deployment.storageAccount}.table.core.windows.net",
        table_name=deployment.toolTable,
        credential=credential(deployment, aio=aio),
    )


def rows_since(table, since_ms: int) -> list[dict[str, Any]]:
    """Tool-log rows written after since_ms (synchronous TableClient)."""
    start = f"{since_ms * 1_000_000:020d}"
    rows = table.query_entities("PartitionKey eq 'calls' and RowKey ge @start", parameters={"start": start})
    result = []
    for row in rows:
        entry = dict(row)
        for key in ("arguments", "result"):
            if isinstance(entry.get(key), str):
                try:
                    entry[key] = json.loads(entry[key])
                except json.JSONDecodeError:
                    pass
        result.append(entry)
    return sorted(result, key=lambda row: row["RowKey"])

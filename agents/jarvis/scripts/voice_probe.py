"""Connect to the Danish voice wrapper the way the backend does and report what Foundry sends.

Run from the voice-probe workflow with an Azure CLI login that can use the Foundry project.
Prints only event types, error codes/messages, close code/reason and timings, never audio or text.
"""
import asyncio
import base64
import json
import os
import subprocess
import sys
import time
import uuid

import websockets

PROJECT = os.environ["FOUNDRY_PROJECT_ENDPOINT"].rstrip("/")
AGENT = os.environ.get("VOICE_AGENT_NAME", "jarvis-voice-mai")
SECONDS = float(os.environ.get("PROBE_SECONDS", "20"))


def token() -> str:
    return subprocess.check_output(
        ["az", "account", "get-access-token", "--resource", "https://ai.azure.com",
         "--query", "accessToken", "-o", "tsv"], text=True).strip()


async def main() -> int:
    base = PROJECT.replace("https://", "wss://", 1)
    url = (f"{base}/agents/{AGENT}/endpoint/protocols/voice"
           f"?api-version=v1&agent_session_id={uuid.uuid4().hex}")
    headers = {"Authorization": "Bearer " + token(), "Foundry-Features": "VoiceAgents=V1Preview"}
    started = time.monotonic()
    seen: dict[str, int] = {}
    try:
        async with websockets.connect(url, additional_headers=headers, max_size=None, open_timeout=20) as ws:
            print(f"open after {time.monotonic() - started:.2f}s")
            silence = base64.b64encode(b"\0" * 4800).decode()

            async def feed() -> None:
                while True:
                    await ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": silence}))
                    await asyncio.sleep(0.1)

            feeder = asyncio.create_task(feed())
            try:
                deadline = started + SECONDS
                while time.monotonic() < deadline:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.monotonic()))
                    except asyncio.TimeoutError:
                        break
                    if isinstance(raw, bytes):
                        seen["<binary>"] = seen.get("<binary>", 0) + 1
                        continue
                    event = json.loads(raw)
                    kind = str(event.get("type"))
                    if kind not in seen:
                        print(f"{time.monotonic() - started:6.2f}s first {kind}")
                    seen[kind] = seen.get(kind, 0) + 1
                    if kind == "error" or kind.endswith(".failed"):
                        detail = event.get("error") or event.get("response", {}).get("status_details") or {}
                        print("ERROR", json.dumps(detail)[:600])
            finally:
                feeder.cancel()
            print("event counts:", json.dumps(seen))
    except websockets.ConnectionClosed as closed:
        print(f"closed by server after {time.monotonic() - started:.2f}s code={closed.code} reason={closed.reason!r}")
        print("event counts:", json.dumps(seen))
        return 1
    except websockets.InvalidStatus as rejected:
        body = (rejected.response.body or b"")[:800].decode("utf-8", "replace")
        print(f"handshake rejected HTTP {rejected.response.status_code}: {body}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

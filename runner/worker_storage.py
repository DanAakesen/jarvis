"""Private Azure Blob mailbox. Entra identity only; no shared account keys."""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from datetime import datetime, timezone
from uuid import uuid4
from xml.etree import ElementTree
from pathlib import Path
from urllib.parse import parse_qsl

import httpx
from azure.identity import DefaultAzureCredential

SCOPE = "https://storage.azure.com/.default"
MAX_BYTES = 1024 * 1024


class Mailbox:
    def __init__(self, url=None, *, credential=None, client=None):
        self.url = url or os.environ["JARVIS_FACTORY_WORKER_BLOB_URL"]
        if not re.fullmatch(r"https://[a-z0-9]{3,24}\.blob\.core\.windows\.net/(?:factory-worker|factory-sbx-[a-f0-9]{32})", self.url):
            raise ValueError("Invalid worker mailbox")
        self.sas_file = os.environ.get("JARVIS_FACTORY_MAILBOX_SAS_FILE")
        if "/factory-sbx-" in self.url and not self.sas_file:
            raise ValueError("Managed worker requires a scoped mailbox credential")
        self.credential = credential or (None if self.sas_file else DefaultAzureCredential())
        self.client = client or httpx.Client(timeout=20, follow_redirects=False)

    def request(self, method, key="", *, query=None, data=None, headers=None, missing=False):
        if key and not re.fullmatch(r"[a-zA-Z0-9_./-]{1,250}", key):
            raise ValueError("Invalid mailbox key")
        auth = {}
        params = dict(query or {})
        if self.sas_file:
            sas = dict(parse_qsl(Path(self.sas_file).read_text().strip()))
            if sas.get("sr") != "c" or not sas.get("sig") or sas.get("spr") != "https":
                raise ValueError("Invalid scoped mailbox credential")
            params.update(sas)
        else:
            auth["Authorization"] = "Bearer " + self.credential.get_token(SCOPE).token
        response = self.client.request(method, self.url + ("/" + key if key else ""),
            params=params, content=data, headers={
                **auth,
                "x-ms-version": "2023-11-03",
                "x-ms-date": datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT"),
                **(headers or {}),
            })
        if missing and response.status_code == 404:
            return None
        if response.status_code not in range(200, 300):
            # Do not propagate a response body, signed URL or credentials into logs.
            raise RuntimeError(f"Worker mailbox HTTP {response.status_code}")
        if len(response.content) > MAX_BYTES:
            raise RuntimeError("Worker mailbox response exceeded limit")
        return response

    def get(self, key):
        response = self.request("GET", key, missing=True)
        return response.json() if response is not None else None

    def put(self, key, value, *, create=False):
        data = json.dumps(value, separators=(",", ":")).encode()
        if len(data) > MAX_BYTES:
            raise ValueError("Worker mailbox payload exceeded limit")
        self.request("PUT", key, data=data, headers={"x-ms-blob-type": "BlockBlob",
            "Content-Type": "application/json", **({"If-None-Match": "*"} if create else {})})

    def delete(self, key):
        self.request("DELETE", key, missing=True)

    def list(self, prefix):
        response = self.request("GET", query={"restype": "container", "comp": "list",
                                             "prefix": prefix, "maxresults": "100"})
        return [element.text for element in ElementTree.fromstring(response.content).findall(".//Blob/Name")]

    def close(self):
        self.client.close()
        if self.credential:
            self.credential.close()


def installation_token(task_id, session_id):
    """The backend verifies an active SQL task/session before minting a scoped token."""
    mailbox = Mailbox()
    request_id = str(uuid4())
    try:
        mailbox.put(f"rpc-requests/{request_id}.json", {
            "kind": "github-token", "taskId": task_id, "sessionId": session_id,
            "expiresAt": time.time() + 40,
        }, create=True)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            result = mailbox.get(f"rpc-responses/{request_id}.json")
            if result is not None:
                mailbox.delete(f"rpc-responses/{request_id}.json")
                if not isinstance(result, dict):
                    raise RuntimeError("Worker token request was refused")
                token, repository = result.get("token"), result.get("repository")
                if (not isinstance(token, str) or not token or len(token) > 4096
                        or any(ord(c) < 32 or ord(c) == 127 for c in token)
                        or not isinstance(repository, str)
                        or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository)):
                    raise RuntimeError("Worker token response is invalid")
                return token, repository
            time.sleep(0.5)
        raise RuntimeError("Worker token request timed out")
    finally:
        mailbox.close()


class WorkerEventPublisher:
    def __init__(self, session_id):
        self.session_id = session_id
        self.mailbox = Mailbox()

    async def publish(self, task_id, invocation_id, event_index, event):
        data = event["data"]
        summary = next((data[key] for key in ("summary", "text", "error", "message", "question")
                        if isinstance(data.get(key), str) and data[key].strip()),
                       event["kind"].replace("_", " "))
        payload = {"invocationId": invocation_id, "eventIndex": event_index,
                   "runnerAt": event["at"], "data": data}
        if len(json.dumps(payload, ensure_ascii=True).encode()) > 256 * 1024:
            payload = {"invocationId": invocation_id, "eventIndex": event_index, "truncated": True}
        await asyncio.to_thread(self.mailbox.put,
            f"events/{invocation_id}/{event_index:09d}.json", {
                "taskId": task_id, "sessionId": self.session_id, "type": event["kind"],
                "summary": summary[:2000],
                "payload": payload,
            })

    async def close(self):
        await asyncio.to_thread(self.mailbox.close)

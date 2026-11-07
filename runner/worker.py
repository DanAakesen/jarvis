"""One disk-backed Factory worker. Commands are durable and consumed at most once.

No listening socket or public ingress. A stopped/uncertain command is reported as
interrupted and must use the existing Factory recovery flow, never automatic replay.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from types import SimpleNamespace
from uuid import uuid4

import app as runner
from worker_storage import Mailbox

ID = re.compile(r"^vm128-[a-f0-9-]{36}$")
TERMINAL = {"completed", "failed", "cancelled", "paused", "interrupted", "needs_attention"}


class Request:
    def __init__(self, command):
        self.state = SimpleNamespace(session_id=command["sessionId"],
                                     invocation_id=command["invocationId"])
        self.payload = command.get("body", {})

    async def json(self):
        return self.payload


def validate_command(value):
    if not isinstance(value, dict) or value.get("operation") not in {
        "start", "resume", "steer", "pause", "cancel", "delete-session", "probe",
    }:
        raise ValueError("Invalid worker command")
    if not all(isinstance(value.get(key), str) and ID.fullmatch(value[key])
               for key in ("sessionId", "invocationId")):
        raise ValueError("Invalid worker identity")
    if not isinstance(value.get("body", {}), dict):
        raise ValueError("Invalid worker body")
    return value


class Worker:
    def __init__(self, mailbox, *, instance_id=None):
        self.mailbox = mailbox
        self.instance_id = instance_id or str(uuid4())
        self.pending_responses = {}
        self.snapshots = {}
        self.last_health = 0.0
        self.recovered = False
        self.last_busy = time.monotonic()

    async def io(self, method, *args, **kwargs):
        return await asyncio.to_thread(getattr(self.mailbox, method), *args, **kwargs)

    async def snapshot(self, invocation_id):
        request = Request({"invocationId": invocation_id, "sessionId": "vm128-" + str(uuid4())})
        response = await runner.get_invocation(request)
        if response.status_code == 200:
            value = json.loads(response.body)
            state = runner.tasks.get(invocation_id)
            if state and state.worker is None and value["status"] not in TERMINAL:
                state.status = value["status"] = "interrupted"
                state.error = value["error"] = "Worker restarted; recover the existing task."
                state.finished_at = value["finished_at"] = time.time()
                runner._persist_task(state)
            value["workerInstance"] = self.instance_id
            serialized = json.dumps(value, sort_keys=True)
            while len(serialized.encode()) > 900_000 and value.get("events"):
                value["events"] = value["events"][1:]
                serialized = json.dumps(value, sort_keys=True)
            if self.snapshots.get(invocation_id) != serialized:
                await self.io("put", f"invocations/{invocation_id}.json", value)
                self.snapshots[invocation_id] = serialized

    async def process(self, key, command):
        command = validate_command(command)
        operation, invocation = command["operation"], command["invocationId"]
        claim_key = key.replace("commands/", "claims/", 1)
        response_key = key.replace("commands/", "responses/", 1)
        if await self.io("get", response_key) is not None:
            await self.io("delete", key)
            return
        if key in self.pending_responses:
            await self.io("put", response_key, self.pending_responses[key])
            await self.io("delete", key)
            del self.pending_responses[key]
            return
        claimed = await self.io("get", claim_key)
        if claimed is not None:
            # Another process may still be executing. Do not race it or replay it.
            health = await self.io("get", "health.json")
            if (claimed.get("instance") == self.instance_id or
                    (health and health.get("instance") == claimed.get("instance") and
                     time.time() - health.get("at", 0) < 180)):
                return
            if time.time() - claimed.get("at", time.time()) < 180:
                return
            old = await self.io("get", f"invocations/{invocation}.json")
            if old and old.get("status") not in TERMINAL:
                old.update(status="interrupted", finished_at=time.time(),
                           error="Worker interrupted; recover the existing task.")
                await self.io("put", f"invocations/{invocation}.json", old)
            await self.io("put", response_key, {"status": "interrupted"})
            await self.io("delete", key)
            return
        active = [state for state in runner.tasks.values() if state.worker and not state.worker.done()]
        if operation in {"start", "resume"} and active:
            return
        await self.io("put", claim_key, {"instance": self.instance_id, "at": time.time()}, create=True)
        self.last_busy = time.monotonic()
        request = Request(command)
        try:
            if operation == "probe":
                disk = runner._disk_snapshot()
                result = {"status": "ok", "instance": self.instance_id, **disk}
                if disk["disk_total_bytes"] < 120 * 1024**3:
                    raise RuntimeError("Worker workspace is smaller than the provisioned 128 GiB tier")
                # Read-only credential check; no provider inference or GitHub mutation.
                for agent in ("codex", "copilot"):
                    credentials = await runner._credentials_for(agent, include_github_token=False)
                    credentials.clear()
                result["credentialsAccessible"] = True
            elif operation == "delete-session":
                await runner._stop_running_turn(command["sessionId"], "cancel")
                await runner._stop_session_client(command["sessionId"])
                result = {"status": "stopped"}
            else:
                response = await (runner.cancel_invocation(request) if operation == "cancel"
                                  else runner.invoke(request))
                if response.status_code >= 400:
                    raise RuntimeError("Runner rejected worker command")
                result = json.loads(response.body)
                await self.snapshot(invocation)
        except Exception:
            # A dispatch may already have started. Never label a running action failed
            # or invoke it twice merely because the result could not be published.
            result = {"status": "failed"}
            if invocation in runner.tasks:
                result = {"status": "accepted"}
            else:
                old = await self.io("get", f"invocations/{invocation}.json")
                if old and old.get("status") not in TERMINAL:
                    old.update(status="failed", finished_at=time.time(), error="Worker command failed")
                    await self.io("put", f"invocations/{invocation}.json", old)
        self.pending_responses[key] = result
        await self.io("put", response_key, result)
        await self.io("delete", key)
        del self.pending_responses[key]

    async def tick(self):
        if not self.recovered:
            # Recover status only. Persisted actions are never automatically replayed.
            for path in runner.WORK_ROOT.glob(f"*/{runner.TASK_STATE_DIR}/*.json"):
                try:
                    saved = json.loads(path.read_text())
                    invocation = saved.get("invocation_id")
                    if isinstance(invocation, str) and ID.fullmatch(invocation):
                        await self.snapshot(invocation)
                except (OSError, ValueError):
                    continue
            self.recovered = True
        for state in list(runner.tasks.values()):
            await self.snapshot(state.invocation_id)
        keys = await self.io("list", "commands/")
        for key in keys:
            command = await self.io("get", key)
            if command is not None:
                await self.process(key, command)
        active = any(state.worker and not state.worker.done() for state in runner.tasks.values())
        if active or keys:
            self.last_busy = time.monotonic()
        if time.monotonic() - self.last_health >= 20:
            disk = runner._disk_snapshot()
            await self.io("put", "health.json", {"at": time.time(), "instance": self.instance_id,
                "active": active, "queued": len(keys), **disk})
            self.last_health = time.monotonic()
        return not active and not keys and time.monotonic() - self.last_busy >= 120

    async def deallocate(self):
        resource_id = os.environ["JARVIS_FACTORY_WORKER_RESOURCE_ID"]
        if not re.fullmatch(r"/subscriptions/[a-f0-9-]{36}/resourceGroups/[A-Za-z0-9_.-]+/providers/Microsoft.Compute/virtualMachines/[A-Za-z0-9_-]+", resource_id):
            raise ValueError("Invalid worker resource ID")
        token = await asyncio.to_thread(self.mailbox.credential.get_token,
                                        "https://management.azure.com/.default")
        response = await asyncio.to_thread(self.mailbox.client.post,
            "https://management.azure.com" + resource_id + "/deallocate?api-version=2024-07-01",
            headers={"Authorization": "Bearer " + token.token})
        if response.status_code not in {200, 202}:
            raise RuntimeError("Worker deallocation was not accepted")

    async def run(self):
        runner.WORK_ROOT.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                if await self.tick():
                    await self.deallocate()
                    # ARM can take time. Never claim billing stopped based on this response.
                    await asyncio.sleep(10)
            except Exception as error:
                print("factory_worker.operation_failed", type(error).__name__, flush=True)
                self.last_busy = time.monotonic()
            await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(Worker(Mailbox()).run())

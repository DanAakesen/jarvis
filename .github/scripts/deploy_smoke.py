"""Deploy smoke check for the Foundry project endpoints (P0-11, P0-05, L10).

Grants the deploy identity "Foundry User" on the project (needed for the data
plane), then waits until:
- the administration host returns the project's connections, including the
  Bicep-managed `container-registry` and `application-insights`; and
- the runtime host recognises the project. Administration calls are never sent
  to the runtime host (L1/L10). No agent exists yet, so the check lists the
  sessions of a placeholder agent (creating nothing, L14); any answer except
  "Project not found" proves the host routes this project.
"""

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

API = "api-version=v1"
CONNECTIONS = ("container-registry", "application-insights")
PROBE_AGENT = "jarvis-deploy-smoke"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # never forward the bearer token
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def az(subscription: str, *arguments: str):
    result = subprocess.run(
        ["az", *arguments, "--subscription", subscription, "--only-show-errors", "--output", "json"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"az {arguments[0]} {arguments[1]} failed")
    return json.loads(result.stdout) if result.stdout.strip() else None


def endpoint(outputs: dict, key: str, suffix: str) -> str:
    value = outputs[key]["value"]
    parsed = urlparse(value)
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(suffix) or parsed.query or parsed.fragment:
        raise ValueError(f"Invalid {key}")
    return value.rstrip("/")


def get(url: str, token: str) -> tuple[int, str]:
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    try:
        with OPENER.open(request, timeout=60) as response:
            return response.status, response.read(1_048_576).decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read(65_536).decode("utf-8", "replace")


def admin_ready(status: int, body: str) -> bool:
    """True when ready; False to retry; raises on a definite failure."""
    if status == 200:
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise RuntimeError("Foundry connections response is not an object")
        items = payload.get("value")
        if isinstance(items, list):
            names = {item.get("name") for item in items if isinstance(item, dict)}
            missing = [name for name in CONNECTIONS if name not in names]
            if missing:
                raise RuntimeError("Foundry project is missing connections: " + ", ".join(missing))
        else:
            print("::warning::Foundry connections response has no value list; connection names not checked.")
        return True
    if status in (401, 403, 404, 429) or status >= 500:
        return False
    raise RuntimeError(f"Foundry administration host returned HTTP {status}")


def runtime_ready(status: int, body: str) -> bool:
    if 200 <= status < 300:
        return True
    if status == 404:
        return "project not found" not in body.lower()
    if status in (401, 403, 429) or status >= 500:
        return False
    raise RuntimeError(f"Foundry runtime host returned HTTP {status}")


def wait(name: str, check, fetch, deadline_seconds: int, interval: int = 15, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + deadline_seconds
    attempt = 0
    while True:
        attempt += 1
        status, body = fetch()
        if check(status, body):
            print(f"{name}: ready (HTTP {status}, attempt {attempt})")
            return
        if clock() >= deadline:
            raise RuntimeError(f"{name} not ready after {deadline_seconds} s (last HTTP {status})")
        print(f"{name}: not ready (HTTP {status}, attempt {attempt}); retrying")
        sleep(interval)


def grant_foundry_user(subscription: str, principal: str, scope: str) -> None:
    definitions = az(subscription, "role", "definition", "list", "--name", "Foundry User")
    if not definitions or len(definitions) != 1:
        raise RuntimeError("Could not resolve the Foundry User role")
    role = definitions[0]["name"]
    existing = az(subscription, "role", "assignment", "list", "--scope", scope, "--fill-principal-name", "false")
    if any(row.get("principalId") == principal and row.get("roleDefinitionId", "").endswith(role)
           and row.get("scope", "").lower() == scope.lower() for row in existing or []):
        return
    az(subscription, "role", "assignment", "create", "--assignee-object-id", principal,
       "--assignee-principal-type", "ServicePrincipal", "--role", role, "--scope", scope)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subscription", required=True)
    parser.add_argument("--resource-group", required=True)
    parser.add_argument("--outputs", required=True, help="Bicep deployment outputs JSON")
    parser.add_argument("--principal", required=True, help="deploy service principal object ID")
    args = parser.parse_args()
    with open(args.outputs, encoding="utf-8") as handle:
        outputs = json.load(handle)
    admin = endpoint(outputs, "foundryAdminEndpoint", ".services.ai.azure.com")
    runtime = endpoint(outputs, "foundryRuntimeEndpoint", ".cognitiveservices.azure.com")
    project = (f"/subscriptions/{args.subscription}/resourceGroups/{args.resource_group}/providers/"
               f"Microsoft.CognitiveServices/accounts/{outputs['foundryAccountName']['value']}"
               f"/projects/{outputs['foundryProjectName']['value']}")
    grant_foundry_user(args.subscription, args.principal, project)

    def fetch(url: str):
        def call():
            token = az(args.subscription, "account", "get-access-token", "--resource", "https://ai.azure.com/")
            return get(url, token["accessToken"])
        return call

    # Role propagation and a new project's routes can each take minutes (L10).
    wait("Foundry administration host", admin_ready, fetch(f"{admin}/connections?{API}"), 1800)
    wait("Foundry runtime host", runtime_ready,
         fetch(f"{runtime}/agents/{PROBE_AGENT}/endpoint/sessions?{API}"), 1800, interval=30)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # report a controlled message, never tokens or bodies
        print(f"::error::Foundry smoke check failed: {error}", file=sys.stderr)
        sys.exit(1)

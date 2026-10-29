"""Main-only, read-only metadata preflight for the approved backend-log activation.

No token, raw ARM body, identifier, log record, or private inventory is printed or
uploaded. The private result stays in RUNNER_TEMP for the fixed deployment path.
This stage never creates an assignment, changes configuration, or enables reads.
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from backend_log_sources import catalogue

GUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", re.IGNORECASE)
DATA_READER = "3b03c2da-16b3-4a49-8834-0f8130efdd3b"
ACTIONS = {"microsoft.operationalinsights/workspaces/query/read", "microsoft.operationalinsights/workspaces/read"}
DATA_ACTIONS = {"microsoft.operationalinsights/workspaces/tables/data/read"}
MAX_BYTES = 2 * 1024 * 1024


class PreflightBlocked(Exception):
    """A value-free reason safe to publish in qualification evidence."""


def require(test: bool, reason: str) -> None:
    if not test:
        raise PreflightBlocked(reason)


def guid(value: object) -> bool:
    return isinstance(value, str) and GUID.fullmatch(value) is not None


def same_id(left: object, right: object) -> bool:
    return isinstance(left, str) and isinstance(right, str) and left.lower() == right.lower()


def permits(permission: dict, action: str, data: bool = False) -> bool:
    allowed = permission.get("dataActions" if data else "actions", [])
    denied = permission.get("notDataActions" if data else "notActions", [])
    require(isinstance(allowed, list) and isinstance(denied, list)
            and all(isinstance(value, str) for value in [*allowed, *denied]), "invalid_role_permissions")
    return any(fnmatch.fnmatchcase(action, value.lower()) for value in allowed) and not any(
        fnmatch.fnmatchcase(action, value.lower()) for value in denied)


def inventory_findings(expected: dict, assignments: list, resource_permissions: bool, role_reader, *, assigned_to: bool = False) -> list[str]:
    findings = set()
    for assignment in assignments:
        properties = assignment["properties"]
        direct = same_id(properties.get("principalId"), expected["principal_id"])
        group = properties.get("principalType") == "Group"
        if not direct and not group:
            continue
        scope = properties.get("scope")
        role_id = properties.get("roleDefinitionId")
        require(isinstance(scope, str) and isinstance(role_id, str) and guid(role_id.rsplit("/", 1)[-1]), "invalid_role_inventory")
        definition = role_reader(role_id.rsplit("/", 1)[-1])
        permissions = definition.get("properties", {}).get("permissions")
        require(isinstance(permissions, list) and all(isinstance(p, dict) for p in permissions), "invalid_role_permissions")
        workspace_scope = expected["workspace_id"].lower().startswith(scope.lower().rstrip("/") + "/") or same_id(scope, expected["workspace_id"])
        legacy = any(permits(p, "microsoft.operationalinsights/workspaces/query/containerappconsolelogs_cl/read")
                     or permits(p, "microsoft.operationalinsights/workspaces/analytics/query/action") for p in permissions)
        data = any(permits(p, "microsoft.operationalinsights/workspaces/tables/data/read", True) for p in permissions)
        resource = any(permits(p, "microsoft.insights/logs/" + table + "/read")
                       for p in permissions for table in ("apptraces", "azurediagnostics"))
        group_prefix = "existing_group_" if assigned_to else "potential_group_"
        group_suffix = "requires_review" if assigned_to else "membership_unverified"
        if workspace_scope and (legacy or data):
            findings.add(group_prefix + "log_grant_" + group_suffix if group else "existing_workspace_log_grant_requires_review")
        elif resource_permissions and resource and not same_id(scope, expected["app_id"]):
            findings.add(group_prefix + "resource_log_grant_" + group_suffix if group else "existing_resource_log_grant_requires_review")
    return sorted(findings)


def targets(bootstrap: dict, web: dict) -> dict:
    subscription = bootstrap.get("subscriptionId")
    tenant = bootstrap.get("tenantId")
    identity = bootstrap.get("backendIdentity", {})
    require(guid(subscription) and guid(tenant) and bootstrap.get("resourceGroup") == "rg-jarvis", "invalid_expected_scope")
    require(guid(identity.get("principalId")) and guid(identity.get("clientId")), "invalid_expected_identity")
    base = f"/subscriptions/{subscription}/resourceGroups/rg-jarvis"
    identity_id = base + "/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-jarvis-backend"
    require(same_id(identity.get("resourceId"), identity_id), "invalid_expected_identity")
    url = urlsplit(web.get("backendUrl", ""))
    match = re.fullmatch(r"(ca-jarvis-backend-([a-z0-9]{13}))\.[a-z0-9-]+\.swedencentral\.azurecontainerapps\.io", url.hostname or "")
    require(bool(match) and url.scheme == "https" and url.path in ("", "/") and not url.username and not url.password and not url.query and not url.fragment, "invalid_expected_backend")
    assert match
    return {"subscription": subscription, "tenant": tenant, "group": base,
            "identity_id": identity_id, "principal_id": identity["principalId"], "client_id": identity["clientId"],
            "app_name": match[1], "app_id": base + "/providers/Microsoft.App/containerApps/" + match[1],
            "workspace_id": base + "/providers/Microsoft.OperationalInsights/workspaces/law-jarvis-" + match[2]}


class Azure:
    def __init__(self, subscription: str, run=subprocess.run, clock=time.monotonic):
        self.subscription, self.run, self.clock = subscription, run, clock
        self.deadline = clock() + 90
        self.calls = 0

    def get(self, resource: str, version: str, query: str | None = None, parameters: dict | None = None):
        require(resource.lower().startswith(f"/subscriptions/{self.subscription}/".lower()), "unexpected_read_scope")
        url = "https://management.azure.com" + resource + "?" + urlencode({"api-version": version, **(parameters or {})})
        return self._read(url, query)

    def _read(self, url: str, query: str | None):
        self.calls += 1
        remaining = self.deadline - self.clock()
        require(self.calls <= 32 and remaining > 0, "preflight_limit")
        args = ["az", "rest", "--method", "get", "--url", url, "--subscription", self.subscription,
                "--output", "json", "--only-show-errors"]
        if query:
            args += ["--query", query]
        try:
            result = self.run(args, capture_output=True, timeout=min(30, remaining), check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise PreflightBlocked("azure_read_unavailable") from None
        require(result.returncode == 0, "azure_read_unavailable")
        require(len(result.stdout) <= MAX_BYTES, "metadata_limit")
        try:
            return json.loads(result.stdout)
        except (ValueError, UnicodeError):
            raise PreflightBlocked("invalid_metadata") from None

    def pages(self, resource: str, version: str, parameters: dict | None = None):
        value = self.get(resource, version, parameters=parameters)
        expected_path = resource.lower()
        rows = []
        for page in range(4):
            require(isinstance(value, dict) and isinstance(value.get("value"), list), "invalid_inventory")
            rows.extend(value["value"])
            require(len(rows) <= 1000, "inventory_limit")
            next_link = value.get("nextLink")
            if not next_link:
                return rows
            require(page < 3, "inventory_limit")
            require(isinstance(next_link, str), "invalid_inventory_link")
            url = urlsplit(next_link)
            require(url.scheme == "https" and url.netloc == "management.azure.com" and url.path.lower() == expected_path and not url.fragment, "invalid_inventory_link")
            value = self._read(next_link, None)
        raise PreflightBlocked("inventory_limit")


def inspect(expected: dict, azure: Azure) -> dict:
    checks = []
    identity = azure.get(expected["identity_id"], "2023-01-31", "{id:id,principalId:properties.principalId,clientId:properties.clientId,tenantId:properties.tenantId}")
    require(isinstance(identity, dict) and same_id(identity.get("id"), expected["identity_id"])
            and same_id(identity.get("principalId"), expected["principal_id"])
            and same_id(identity.get("clientId"), expected["client_id"])
            and same_id(identity.get("tenantId"), expected["tenant"]), "live_identity_mismatch")
    checks.append("live_identity_matches")
    app = azure.get(expected["app_id"], "2024-03-01", "{id:id,identities:identity.userAssignedIdentities,clientId:properties.template.containers[0].env[?name=='SQL_MANAGED_IDENTITY_CLIENT_ID'].value|[0],foundryResourceId:properties.template.containers[0].env[?name=='FOUNDRY_ACCOUNT_RESOURCE_ID'].value|[0]}")
    require(isinstance(app, dict) and same_id(app.get("id"), expected["app_id"])
            and isinstance(app.get("identities"), dict)
            and any(same_id(key, expected["identity_id"]) for key in app["identities"])
            and same_id(app.get("clientId"), expected["client_id"]), "runtime_identity_mismatch")
    checks.append("runtime_identity_matches")
    foundry_id = app.get("foundryResourceId")
    require(isinstance(foundry_id, str) and re.fullmatch(re.escape(expected["group"])
            + r"/providers/Microsoft\.CognitiveServices/accounts/jarvis-[0-9]{14}-"
            + re.escape(expected["app_name"].removeprefix("ca-jarvis-backend-")), foundry_id, re.IGNORECASE), "runtime_foundry_mismatch")
    foundry = azure.get(foundry_id, "2025-06-01", "{id:id}")
    require(isinstance(foundry, dict) and same_id(foundry.get("id"), foundry_id), "live_foundry_mismatch")
    checks.append("live_foundry_matches")
    workspace = azure.get(expected["workspace_id"], "2023-09-01", "{id:id,customerId:properties.customerId,retention:properties.retentionInDays,features:properties.features}")
    require(isinstance(workspace, dict) and same_id(workspace.get("id"), expected["workspace_id"])
            and guid(workspace.get("customerId")), "live_workspace_mismatch")
    require(workspace.get("retention") == 30, "retention_requires_review")
    features = workspace.get("features")
    require(isinstance(features, dict) and type(features.get("enableLogAccessUsingOnlyResourcePermissions")) is bool, "access_mode_unavailable")
    checks.append("live_workspace_matches")
    resource_permissions = features["enableLogAccessUsingOnlyResourcePermissions"]
    checks.append("access_mode_resource_or_workspace" if resource_permissions else "access_mode_workspace_only")
    table = azure.get(expected["workspace_id"] + "/tables/ContainerAppConsoleLogs_CL", "2022-10-01", "{id:id,plan:properties.plan,schema:properties.schema}")
    require(isinstance(table, dict) and same_id(table.get("id"), expected["workspace_id"] + "/tables/ContainerAppConsoleLogs_CL")
            and table.get("plan") == "Analytics" and isinstance(table.get("schema"), dict), "console_table_unavailable")
    schema = table["schema"]
    columns = [*schema.get("columns", []), *schema.get("standardColumns", [])]
    require(all(isinstance(column, dict) for column in columns), "console_schema_mismatch")
    types = {column.get("name"): column.get("type") for column in columns}
    require(all(types.get(key) == kind for key, kind in {"TimeGenerated": "datetime", "ContainerAppName_s": "string", "Log_s": "string"}.items()), "console_schema_mismatch")
    checks.append("console_schema_matches")
    role = azure.get(expected["workspace_id"] + "/providers/Microsoft.Authorization/roleDefinitions/" + DATA_READER, "2022-04-01")
    require(isinstance(role, dict) and same_id(role.get("name"), DATA_READER), "builtin_role_mismatch")
    props = role.get("properties", {})
    require(props.get("type") == "BuiltInRole" and isinstance(props.get("permissions"), list)
            and len(props["permissions"]) == 1, "builtin_role_mismatch")
    permission = props["permissions"][0]
    require(isinstance(permission, dict)
            and all(isinstance(permission.get(key), list) and all(isinstance(item, str) for item in permission[key])
                    for key in ("actions", "dataActions", "notActions", "notDataActions")), "builtin_role_mismatch")
    require({value.lower() for value in permission.get("actions", [])} == ACTIONS
            and {value.lower() for value in permission.get("dataActions", [])} == DATA_ACTIONS
            and permission.get("notActions") == [] and permission.get("notDataActions") == [], "builtin_role_mismatch")
    checks.append("builtin_role_matches")
    inherited = azure.pages(expected["workspace_id"] + "/providers/Microsoft.Authorization/roleAssignments", "2022-04-01", {"$filter": "atScope()"})
    group_roles = azure.pages(expected["group"] + "/providers/Microsoft.Authorization/roleAssignments", "2022-04-01")
    require(all(isinstance(row, dict) and isinstance(row.get("properties"), dict) for row in [*inherited, *group_roles]), "invalid_role_inventory")
    checks.append("role_inventory_read")
    roles = {DATA_READER: role}

    def read_role(identifier):
        if identifier not in roles:
            require(len(roles) < 12, "role_inventory_limit")
            definition = azure.get(expected["workspace_id"] + "/providers/Microsoft.Authorization/roleDefinitions/" + identifier, "2022-04-01")
            require(isinstance(definition, dict), "invalid_role_inventory")
            roles[identifier] = definition
        return roles[identifier]

    findings = inventory_findings(expected, [*inherited, *group_roles], resource_permissions, read_role)
    effective = {}
    for label, scope in (("workspace", expected["workspace_id"]), ("foundry", foundry_id),
                         ("subscription", "/subscriptions/" + expected["subscription"])):
        try:
            # ARM assignedTo includes transitive group grants for this service principal.
            rows = azure.pages(scope + "/providers/Microsoft.Authorization/roleAssignments", "2022-04-01",
                               {"$filter": "assignedTo('" + expected["principal_id"] + "')"})
            require(all(isinstance(row, dict) and isinstance(row.get("properties"), dict)
                        and guid(row["properties"].get("principalId"))
                        and (same_id(row["properties"]["principalId"], expected["principal_id"])
                             or row["properties"].get("principalType") == "Group") for row in rows), "invalid_role_inventory")
            findings.extend(inventory_findings(expected, rows, resource_permissions, read_role, assigned_to=True))
            effective[label] = rows
            checks.append("assigned_to_" + label + "_inventory_read")
        except PreflightBlocked:
            # This metadata-only stage cannot turn an incomplete inventory into proof.
            checks.append("assigned_to_" + label + "_inventory_unavailable")
    findings = sorted(set(findings))
    checks.extend(findings or ["no_obvious_log_grant_in_read_inventory"])
    def controls(rows):
        require(all(isinstance(row, dict) for row in rows), "invalid_workspace_inventory")
        pattern = (r"/subscriptions/" + re.escape(expected["subscription"])
                   + r"/resourceGroups/[a-z0-9._()-]+/providers/Microsoft\.OperationalInsights/workspaces/[a-z0-9-]+")
        return [row for row in rows if not same_id(row.get("id"), expected["workspace_id"])
                and isinstance(row.get("id"), str) and re.fullmatch(pattern, row["id"], re.IGNORECASE)
                and isinstance(row.get("properties"), dict) and guid(row["properties"].get("customerId"))
                and not same_id(row["properties"]["customerId"], workspace["customerId"])]

    peers = controls(azure.pages(expected["group"] + "/providers/Microsoft.OperationalInsights/workspaces", "2023-09-01"))
    if not peers:
        # Read only metadata already visible to this deploy identity. Never request a new grant.
        try:
            peers = controls(azure.pages("/subscriptions/" + expected["subscription"]
                                        + "/providers/Microsoft.OperationalInsights/workspaces", "2023-09-01"))
            checks.append("negative_workspace_subscription_inventory_read")
        except PreflightBlocked:
            checks.append("negative_workspace_subscription_inventory_unavailable")
    # Presence is only a candidate, never a claimed negative authorization proof.
    checks.append("negative_workspace_candidate_found" if peers else "negative_workspace_candidate_missing")
    resources = None
    source_tables = None
    try:
        resources = azure.pages(expected["group"] + "/resources", "2021-04-01")
        checks.append("whole_jarvis_resource_inventory_read")
    except PreflightBlocked:
        checks.append("whole_jarvis_resource_inventory_unavailable")
    try:
        source_tables = azure.pages(expected["workspace_id"] + "/tables", "2022-10-01")
        checks.append("whole_jarvis_table_inventory_read")
    except PreflightBlocked:
        checks.append("whole_jarvis_table_inventory_unavailable")
    try:
        source_catalogue = catalogue(expected, foundry_id, resources, source_tables)
        checks.append("whole_jarvis_scope_planning_only")
        checks.extend(source_catalogue["findings"])
    except (ValueError, TypeError, AttributeError):
        source_catalogue = None
        checks.append("whole_jarvis_source_metadata_invalid")
    return {"schema": 1, "stage": "metadata_only", "checks": checks, "targets": expected,
            "workspace": workspace, "foundry": foundry, "table": table, "role": role, "inherited_assignments": inherited,
            "resource_group_assignments": group_roles, "negative_workspace_candidates": peers,
            "assigned_to_assignments": effective, "assigned_to_inventory_complete": len(effective) == 3,
            "whole_jarvis_sources": source_catalogue,
            "role_definitions": roles, "access_findings": findings,
            "effective_group_memberships_verified": False, "provider_enforcement_verified": False,
            "reader_enabled": False, "grant_applied": False}


def private_write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output)


def main() -> int:
    try:
        require(os.environ.get("GITHUB_REF") == "refs/heads/main" and os.environ.get("GITHUB_ACTIONS") == "true", "main_oidc_required")
        root = Path(os.environ["RUNNER_TEMP"]).resolve()
        bootstrap = json.loads(Path("infra/bootstrap.output.json").read_text())
        web = json.loads(Path("apps/web/config.json").read_text())
        expected = targets(bootstrap, web)
        require(same_id(os.environ.get("SUBSCRIPTION_ID"), expected["subscription"]), "subscription_mismatch")
        report = inspect(expected, Azure(expected["subscription"]))
        private_write(root / "backend-log-preflight.private.json", report)
        print("Backend log preflight: metadata checks passed; grant and reader remain off.")
        for check in report["checks"]:
            print("Backend log preflight: " + check)
        return 0
    except PreflightBlocked as error:
        print("Backend log preflight blocked: " + str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
        # Never publish exception text, identifiers, ARM responses or subprocess arguments.
        print("Backend log preflight blocked: unexpected_metadata_failure", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

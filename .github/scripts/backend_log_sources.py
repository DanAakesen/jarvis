"""Plan whole-Jarvis log ownership from metadata; never grant access or read logs."""
from __future__ import annotations


def catalogue(expected: dict, foundry_id: str, resources: list | None, tables: list | None) -> dict:
    suffix = expected["app_name"].removeprefix("ca-jarvis-backend-")
    group = expected["group"]
    fixed = {
        "backend": expected["app_id"],
        "container_environment": group + "/providers/Microsoft.App/managedEnvironments/cae-jarvis-" + suffix,
        "vault_mirror": group + "/providers/Microsoft.App/jobs/job-jarvis-vault-mirror",
        "application_insights": group + "/providers/Microsoft.Insights/components/appi-jarvis-" + suffix,
        "foundry": foundry_id,
        "storage": group + "/providers/Microsoft.Storage/storageAccounts/stjarvis" + suffix,
        "key_vault": group + "/providers/Microsoft.KeyVault/vaults/kv-jarvis-" + suffix,
        "registry": group + "/providers/Microsoft.ContainerRegistry/registries/crjarvis" + suffix,
        "sql_server": group + "/providers/Microsoft.Sql/servers/sql-jarvis-" + suffix,
        "sql_database": group + "/providers/Microsoft.Sql/servers/sql-jarvis-" + suffix + "/databases/jarvis",
        "web": group + "/providers/Microsoft.Web/staticSites/swa-jarvis-" + suffix,
        "workspace": expected["workspace_id"],
    }
    status = dict.fromkeys(fixed, "unavailable" if resources is None else "not_found")
    owned = {}
    seen = set()
    for item in resources or []:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise TypeError("invalid_source_inventory")
        identifier = item["id"].lower()
        if identifier in seen:
            raise ValueError("ambiguous_source_inventory")
        seen.add(identifier)
        key = next((key for key, target in fixed.items() if target.lower() == identifier), None)
        if key is None:
            continue  # A Jarvis tag alone never authorizes another resource or project.
        tags = item.get("tags")
        project = [value for key, value in tags.items() if key.lower() == "project"] if isinstance(tags, dict) else []
        if len(project) == 1 and isinstance(project[0], str) and project[0].lower() == "jarvis":
            status[key] = "owned"
            owned[key] = fixed[key]
        else:
            status[key] = "ownership_unverified"

    supported = {"ContainerAppConsoleLogs_CL", "ContainerAppSystemLogs_CL", "ContainerAppConsoleLogs", "ContainerAppSystemLogs",
                 "AppTraces", "AppRequests", "AppDependencies", "AppExceptions", "AppEvents", "AppMetrics", "AzureDiagnostics", "AzureActivity"}
    table_inventory = {}
    prefix = expected["workspace_id"].lower() + "/tables/"
    for item in tables or []:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"].lower().startswith(prefix):
            raise ValueError("invalid_table_inventory")
        name = item["id"][len(prefix):]
        if name not in supported:
            continue
        if name in table_inventory:
            raise ValueError("ambiguous_table_inventory")
        properties = item.get("properties", {})
        schema = properties.get("schema", {})
        columns = [*schema.get("columns", []), *schema.get("standardColumns", [])]
        if not all(isinstance(column, dict) for column in columns):
            raise ValueError("invalid_table_inventory")
        table_inventory[name] = {"plan": properties.get("plan"), "resource_id_column": any(
            column.get("name") == "_ResourceId" and column.get("type") == "string" for column in columns)}
    findings = ["whole_jarvis_source_" + key + "_" + value for key, value in status.items()]
    for name in sorted(supported):
        table = table_inventory.get(name)
        state = "not_found" if table is None else ("analytics" if table["plan"] == "Analytics" else "unsupported_plan")
        findings.append("whole_jarvis_table_" + name.lower() + "_" + state)
        if table is not None:
            findings.append("whole_jarvis_table_" + name.lower() + ("_resource_id_present" if table["resource_id_column"] else "_resource_id_missing"))
    return {"stage": "whole_jarvis_scope_planning", "sources": status, "owned_resources": owned, "findings": findings,
            "tables": table_inventory, "resource_inventory_read": resources is not None, "table_inventory_read": tables is not None,
            "workspace_entirely_owned": False, "provider_enforcement_verified": False,
            "workspace_links_verified": False, "historical_ownership_verified": False,
            "new_grants_approved": False, "reader_enabled": False}

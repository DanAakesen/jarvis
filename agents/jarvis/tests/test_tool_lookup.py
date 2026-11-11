from types import SimpleNamespace

from jarvis_tools import BackendTool, ToolExecutionMetadata
from model_client import chat_model_tools
from tool_lookup import LOOKUP_TOOLS, resolve_lookup_calls


def _tool(name: str, description: str) -> BackendTool:
    schema = {"type": "object", "properties": {}, "additionalProperties": False}
    return BackendTool(name, description, schema, ToolExecutionMetadata("action"))


def _call(name: str, arguments: str) -> SimpleNamespace:
    return SimpleNamespace(name=name, call_id=f"call_{name}", id="", arguments=arguments)


def test_lookup_offers_two_small_tools_and_refuses_a_tool_not_looked_up() -> None:
    assert [tool["name"] for tool in LOOKUP_TOOLS] == ["find_tools", "call_tool"]
    assert len(str(LOOKUP_TOOLS)) < 1_500

    catalogue = [
        _tool("vault_task_create", "Create a task or reminder."),
        _tool("workspace_command", "Control Jarvis windows and pages."),
    ]
    discovered: set[str] = set()

    def resolve(*calls: SimpleNamespace) -> list:
        return resolve_lookup_calls(
            calls, catalogue, discovered, use_anthropic=False,
            shape_definitions=chat_model_tools,
        )

    refused = resolve(_call("call_tool", '{"name":"workspace_command","arguments":{}}'))[0]
    assert refused.local_result["outcome"] == "refused"
    assert "find_tools" in refused.local_result["result"]["refused"]

    found = resolve(_call("find_tools", '{"query":"task reminder"}'))[0]
    assert found.local_result["outcome"] == "ok"
    assert found.local_result["result"]["tools"][0]["name"] == "vault_task_create"

    real = resolve(
        _call("call_tool", '{"name":"vault_task_create","arguments":{"title":"Milk"}}')
    )[0]
    assert real.local_result is None
    assert (real.name, real.arguments) == ("vault_task_create", '{"title":"Milk"}')

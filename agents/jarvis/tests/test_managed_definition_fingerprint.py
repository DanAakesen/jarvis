"""Canonical hashes for the provisioning script and bridge; standard library data."""
import copy
import hashlib
import json

import pytest

from managed_definition_fingerprint import (
    managed_definition_fingerprint,
    normalized_managed_definition,
)
from managed_policy_template import POLICY_INPUTS, POLICY_TEMPLATE


def definition():
    return {"kind": "prompt", "harness": {"type": "microsoft_copilot_preview"},
            "model": "gpt-6.1-terra", "reasoning": {"effort": "high"}, "instructions": "Danish æøå",
            "tools": [{"type": "function", "name": "z", "strict": False,
                       "parameters": {"type": "object", "enum": ["b", "a"],
                                      "properties": {"nullable": {"default": None}}}},
                      {"type": "microsoft_copilot_toolset_preview",
                       "default_config": {"enabled": False}}]}


def test_fingerprint_exact_cross_boundary_contract_and_benign_defaults():
    base = definition()
    provider = copy.deepcopy(base)
    provider.update(skills=[], structured_inputs={}, temperature=None, text=None)
    provider["reasoning"]["summary"] = None
    provider["tools"][-1]["configs"] = []
    provider["tools"].reverse()
    expected = {"projectEndpoint": "https://fixture/api/projects/p", "agentName": "agent",
                "version": "1", "definition": normalized_managed_definition(base)}
    digest = hashlib.sha256(json.dumps(expected, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    assert managed_definition_fingerprint("https://fixture/api/projects/p/", "agent", "1",
                                          provider) == digest
    assert normalized_managed_definition(provider)["tools"][1]["parameters"] == \
        base["tools"][0]["parameters"]


def test_required_policy_template_is_hashed_and_cannot_gain_default_or_extra_bindings():
    value = definition()
    old = managed_definition_fingerprint("https://fixture", "agent", "1", value)
    value.update(instructions=POLICY_TEMPLATE, structured_inputs=copy.deepcopy(POLICY_INPUTS))
    new = managed_definition_fingerprint("https://fixture", "agent", "1", value)
    assert new != old
    assert normalized_managed_definition(value)["structured_inputs"] == POLICY_INPUTS
    for field, unexpected in [("required", False), ("default_value", "fallback"),
                              ("schema", {"type": "object"})]:
        changed = copy.deepcopy(value)
        changed["structured_inputs"]["jarvis_policy"][field] = unexpected
        with pytest.raises(ValueError):
            normalized_managed_definition(changed)
    value["structured_inputs"]["untrusted_tool_binding"] = {"required": True}
    with pytest.raises(ValueError):
        normalized_managed_definition(value)


@pytest.mark.parametrize("mutation", ["enabled", "extra", "nonfinite", "reasoning"])
def test_enabled_extra_or_noncanonical_data_is_not_discarded(mutation):
    value = definition()
    if mutation == "enabled":
        value["tools"][-1]["default_config"]["enabled"] = True
    elif mutation == "extra":
        value["tools"].append({"type": "web_search"})
    elif mutation == "nonfinite":
        value["tools"][0]["parameters"]["extra"] = float("nan")
    else:
        value["reasoning"]["mode"] = "pro"
    with pytest.raises(ValueError):
        normalized_managed_definition(value)

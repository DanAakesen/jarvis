"""Activation evidence for an exact target and policy transport; no credentials."""
from __future__ import annotations

import hashlib
import json
import re

POLICY_TRANSPORT_REVISION = "jarvis-structured-policy-v1"


def policy_compatibility_receipt(endpoint, agent_name, version, fingerprint, model, effort):
    if not isinstance(endpoint, str):
        raise ValueError("managed_policy_compatibility_invalid")
    values = [POLICY_TRANSPORT_REVISION, endpoint.rstrip("/"), agent_name, version,
              fingerprint, model, effort]
    if (not all(isinstance(value, str) and value for value in values)
            or not re.fullmatch(r"[0-9a-f]{64}", fingerprint)):
        raise ValueError("managed_policy_compatibility_invalid")
    return hashlib.sha256(json.dumps(
        values, ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()


def validated_canary_receipt(activation, canary):
    """Plain replies, diagnostics and a different target cannot activate policy."""
    if not isinstance(activation, dict) or not isinstance(canary, dict):
        raise ValueError("managed_policy_canary_invalid")
    expected = policy_compatibility_receipt(
        activation.get("projectEndpoint", ""), activation.get("agentName", ""),
        activation.get("version", ""), activation.get("fingerprint", ""),
        "gpt-6.1-terra", "high",
    )
    if (canary.get("status") != "ok" or canary.get("requestShape") != "managed_policy"
            or canary.get("model") != "gpt-6.1-terra" or canary.get("reasoningEffort") != "high"
            or canary.get("policyTransportRevision") != POLICY_TRANSPORT_REVISION
            or canary.get("policyCompatibility") != expected):
        raise ValueError("managed_policy_canary_invalid")
    return expected

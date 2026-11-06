import copy
import json
from pathlib import Path

import pytest

from managed_policy_compatibility import (
    POLICY_TRANSPORT_REVISION,
    policy_compatibility_receipt,
    validated_canary_receipt,
)

FIXTURE_PATH = (Path(__file__).resolve().parents[3]
                / ".github/scripts/tests/fixtures/managed-policy-compatibility.json")
FIXTURE = json.loads(FIXTURE_PATH.read_text())
ACTIVATION = {"projectEndpoint": FIXTURE["projectEndpoint"],
              **{key: FIXTURE["target"][key] for key in ["agentName", "version", "fingerprint"]}}
CANARY = {"status": "ok", "requestShape": "managed_policy", "model": "gpt-6.1-terra",
          "reasoningEffort": "high", "policyTransportRevision": POLICY_TRANSPORT_REVISION,
          "policyCompatibility": FIXTURE["receipt"]}


def test_canary_and_backend_agree_on_exact_target_settings_and_transport_receipt():
    assert POLICY_TRANSPORT_REVISION == FIXTURE["policyTransportRevision"]
    assert validated_canary_receipt(ACTIVATION, CANARY) == FIXTURE["receipt"]
    assert policy_compatibility_receipt(
        ACTIVATION["projectEndpoint"] + "/", ACTIVATION["agentName"], ACTIVATION["version"],
        ACTIVATION["fingerprint"], "gpt-6.1-terra", "high",
    ) == FIXTURE["receipt"]


@pytest.mark.parametrize("key", ["projectEndpoint", "agentName", "version", "fingerprint"])
def test_other_target_cannot_reuse_evidence_even_with_same_definition_hash(key):
    activation = {**ACTIVATION, key: "b" * 64 if key == "fingerprint" else "other"}
    with pytest.raises(ValueError):
        validated_canary_receipt(activation, CANARY)


@pytest.mark.parametrize("key", list(CANARY))
def test_missing_stale_or_failed_policy_evidence_cannot_activate(key):
    for value in [None, "different"]:
        canary = {**CANARY, key: value}
        with pytest.raises(ValueError):
            validated_canary_receipt(ACTIVATION, canary)
    canary = copy.deepcopy(CANARY)
    del canary[key]
    with pytest.raises(ValueError):
        validated_canary_receipt(ACTIVATION, canary)


@pytest.mark.parametrize("value", [None, [], 7, "private", {"status": "diagnostic"}])
def test_malformed_or_diagnostic_payloads_cannot_stamp_compatibility(value):
    with pytest.raises((ValueError, TypeError)):
        validated_canary_receipt(ACTIVATION, value)

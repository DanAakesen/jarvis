"""One required application-owned instruction value; never user or tool data."""

POLICY_TEMPLATE = "{{jarvis_policy}}"
POLICY_INPUTS = {
    "jarvis_policy": {
        "description": "Complete trusted Jarvis policy for the current response.",
        "required": True,
        "schema": {"type": "string"},
    },
}

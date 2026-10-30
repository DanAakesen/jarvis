"""Content-free provider diagnostics for managed policy failures."""

import re
from typing import Any


def sanitize_provider_cause(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    cause = {}
    status = value.get("httpStatus")
    if type(status) is int and 100 <= status <= 599:
        cause["httpStatus"] = status
    for key in ("code", "param"):
        field = value.get(key)
        if isinstance(field, str) and re.fullmatch(r"[a-z0-9_.]{1,48}", field):
            cause[key] = field
    name = value.get("exceptionType")
    if isinstance(name, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,47}", name):
        cause["exceptionType"] = name
    return cause


def provider_cause(error: Exception) -> dict[str, Any]:
    return sanitize_provider_cause({
        "httpStatus": getattr(error, "status_code", None),
        "code": getattr(error, "code", None),
        "param": getattr(error, "param", None),
        "exceptionType": type(error).__name__,
    })

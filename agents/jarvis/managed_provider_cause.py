"""Content-free provider diagnostics for managed policy failures."""

from typing import Any

# Closed vocabularies: even a short, regex-safe provider value can contain data.
CODES = frozenset({
    "invalid_request", "invalid_request_error", "invalid_payload", "invalid_argument",
    "unsupported_parameter", "unsupported_value", "missing_required_parameter",
    "model_not_found", "deployment_not_found", "permission_denied", "not_found",
    "rate_limit_exceeded", "insufficient_quota", "context_length_exceeded",
    "content_filter", "content_policy_violation", "server_error", "internal_error",
    "BadRequest", "InvalidRequest", "InvalidArgument", "InvalidPayload", "InvalidParameter",
    "UnsupportedParameter", "UnsupportedOperation", "OperationNotSupported",
    "DeploymentNotFound", "ModelNotFound", "Forbidden", "Unauthorized", "NotFound",
    "ResponsibleAIPolicyViolation", "ContentFilter", "QuotaExceeded", "TooManyRequests",
})
TARGETS = frozenset({
    "input", "input.role", "input.content", "input.type", "instructions", "model",
    "reasoning", "reasoning.effort", "tools", "tools.name", "tools.parameters", "tools.strict",
    "conversation", "stream", "store", "previous_response_id", "harness", "agent",
    "temperature", "top_p", "tool_choice", "text.format", "text.verbosity",
    "max_output_tokens", "max_tool_calls", "parallel_tool_calls", "truncation",
    "context_management", "top_logprobs", "safety_identifier", "prompt_cache_key",
    "prompt_cache_retention", "service_tier", "user",
})
EXCEPTIONS = frozenset({
    "BadRequestError", "AuthenticationError", "PermissionDeniedError", "NotFoundError",
    "ConflictError", "UnprocessableEntityError", "RateLimitError", "InternalServerError",
    "APIError", "APIStatusError", "APIConnectionError", "APITimeoutError",
    "APIResponseValidationError", "TimeoutError", "ConnectTimeout", "ReadTimeout",
    "WriteTimeout", "PoolTimeout", "ConnectError", "ReadError", "RemoteProtocolError",
    "ManagedChatError", "RuntimeError", "ValueError", "TypeError",
})


def _known(value: Any, allowed: frozenset[str]) -> bool:
    return isinstance(value, str) and value in allowed


def _detail(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: value[key] for key, allowed in (("code", CODES), ("target", TARGETS))
            if _known(value.get(key), allowed)}


def sanitize_provider_cause(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    cause = {}
    status = value.get("httpStatus")
    if type(status) is int and 100 <= status <= 599:
        cause["httpStatus"] = status
    for key, allowed in (("code", CODES), ("param", TARGETS), ("exceptionType", EXCEPTIONS)):
        if _known(value.get(key), allowed):
            cause[key] = value[key]
    details = value.get("details")
    if isinstance(details, list):
        safe = [detail for item in details[:4] if (detail := _detail(item))]
        if safe:
            cause["details"] = safe
    return cause


def provider_cause(error: Exception) -> dict[str, Any]:
    # OpenAI keeps the decoded error body, but its code/param properties ignore
    # Azure's nested details/innererror/target. Traverse only those documented
    # keys, with fixed depth/node/output bounds; never examine or emit messages.
    pending = [(getattr(error, "body", None), 0)]
    details: list[dict[str, str]] = []
    for _ in range(16):
        if not pending or len(details) == 4:
            break
        body, depth = pending.pop(0)
        if not isinstance(body, dict):
            continue
        detail = _detail(body)
        if detail and detail not in details:
            details.append(detail)
        if depth < 3:
            pending.extend((body.get(key), depth + 1) for key in ("error", "innererror"))
            children = body.get("details")
            if isinstance(children, list):
                pending.extend((item, depth + 1) for item in children[:4])
    # Don't repeat the top-level code unless it comes with a more precise target.
    details = [item for item in details if item != {"code": getattr(error, "code", None)}]
    return sanitize_provider_cause({
        "httpStatus": getattr(error, "status_code", None),
        "code": getattr(error, "code", None),
        "param": getattr(error, "param", None),
        "exceptionType": type(error).__name__,
        "details": details,
    })

import httpx
import pytest
from openai import BadRequestError

from managed_provider_cause import provider_cause, sanitize_provider_cause


def test_provider_cause_keeps_only_bounded_metadata():
    error = BadRequestError(
        "PRIVATE_MESSAGE", response=httpx.Response(400, request=httpx.Request("POST", "https://example.test")),
        body={"code": "unsupported_parameter", "param": "input.content"},
    )
    assert provider_cause(error) == {
        "httpStatus": 400, "code": "unsupported_parameter",
        "param": "input.content", "exceptionType": "BadRequestError",
    }


@pytest.mark.parametrize("value", ["", "a" * 49, "PRIVATE", "input[0]", "input\n", "a-b", "a b",
                                   "private_identifier", "a" * 48])
def test_provider_cause_drops_unsafe_values(value):
    assert sanitize_provider_cause({
        "httpStatus": 400, "code": value, "param": value,
        "exceptionType": "BadRequestError", "message": "PRIVATE",
    }) == {"httpStatus": 400, "exceptionType": "BadRequestError"}


@pytest.mark.parametrize("status", [True, 99, 600, "400", 400.5])
def test_provider_cause_drops_invalid_status(status):
    assert sanitize_provider_cause({"httpStatus": status}) == {}


def test_provider_cause_uses_only_known_exception_classes():
    assert sanitize_provider_cause({"exceptionType": "PrivateIdentifier"}) == {}
    assert provider_cause(RuntimeError("PRIVATE")) == {"exceptionType": "RuntimeError"}


def test_provider_cause_recovers_documented_nested_codes_and_targets_without_content():
    error = BadRequestError(
        "PRIVATE_MESSAGE", response=httpx.Response(400, request=httpx.Request("POST", "https://example.test")),
        body={"code": "invalid_request", "message": "PRIVATE_MESSAGE", "target": "input",
              "innererror": {"code": "InvalidParameter", "innererror": {
                  "code": "UnsupportedParameter", "message": "PRIVATE"}},
              "details": [{"code": "unsupported_value", "target": "input.role", "value": "PRIVATE"},
                          {"code": "private_identifier", "target": "private_identifier"}]},
    )
    result = provider_cause(error)
    assert result == {"httpStatus": 400, "code": "invalid_request",
                      "exceptionType": "BadRequestError",
                      "details": [{"code": "invalid_request", "target": "input"},
                                  {"code": "InvalidParameter"},
                                  {"code": "unsupported_value", "target": "input.role"},
                                  {"code": "UnsupportedParameter"}]}
    assert sanitize_provider_cause(result) == result


def test_nested_body_traversal_and_resanitization_are_bounded_even_for_cycles():
    body = {"code": "private_identifier", "target": "private_identifier", "message": "private"}
    body["innererror"] = body
    body["details"] = [body] * 1000
    error = RuntimeError("private")
    error.body = body
    assert provider_cause(error) == {"exceptionType": "RuntimeError"}
    assert sanitize_provider_cause({"details": [
        {"code": "invalid_request", "target": "input", "message": "private"}] * 1000,
    }) == {"details": [{"code": "invalid_request", "target": "input"}] * 4}

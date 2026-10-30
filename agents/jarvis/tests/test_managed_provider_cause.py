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


@pytest.mark.parametrize("value", ["", "a" * 49, "PRIVATE", "input[0]", "input\n", "a-b", "a b"])
def test_provider_cause_drops_unsafe_values(value):
    assert sanitize_provider_cause({
        "httpStatus": 400, "code": value, "param": value,
        "exceptionType": "BadRequestError", "message": "PRIVATE",
    }) == {"httpStatus": 400, "exceptionType": "BadRequestError"}


@pytest.mark.parametrize("status", [True, 99, 600, "400", 400.5])
def test_provider_cause_drops_invalid_status(status):
    assert sanitize_provider_cause({"httpStatus": status}) == {}


def test_provider_cause_accepts_exact_length_and_uses_exception_class_fallback():
    assert sanitize_provider_cause({"code": "a" * 48}) == {"code": "a" * 48}
    assert provider_cause(RuntimeError("PRIVATE")) == {"exceptionType": "RuntimeError"}

"""Chat timing logs and spans never contain exception or conversation content."""

import asyncio
import logging
from contextlib import contextmanager

import pytest

import chat_telemetry


@pytest.mark.parametrize("error", [None, RuntimeError("private-content"), asyncio.CancelledError()])
def test_stage_timings_are_content_free(monkeypatch, caplog, error) -> None:
    attributes = {}

    class Span:
        def set_attribute(self, key, value):
            attributes[key] = value

        def set_status(self, _status):
            pass

    class Tracer:
        @contextmanager
        def start_as_current_span(self, name, **options):
            assert name == "prompt_build"
            assert options == {"record_exception": False, "set_status_on_exception": False}
            yield Span()

    monkeypatch.setattr(chat_telemetry, "_tracer", Tracer())
    times = iter([1.0, 1.125])
    monkeypatch.setattr(chat_telemetry.time, "monotonic", lambda: next(times))
    with caplog.at_level(logging.INFO, logger="chat_telemetry"):
        if error is None:
            with chat_telemetry.latency_span("prompt_build"):
                pass
        else:
            with pytest.raises(type(error)), chat_telemetry.latency_span("prompt_build"):
                raise error
    outcome = "ok" if error is None else (
        "cancelled" if isinstance(error, asyncio.CancelledError) else "error"
    )
    assert attributes == {"duration_ms": 125.0, "outcome": outcome}
    assert caplog.messages == [
        f"chat.latency phase=prompt_build durationMs=125.00 outcome={outcome}",
    ]
    assert "private-content" not in caplog.text

"""Chat timing logs and spans never contain exception or conversation content."""

import asyncio
import logging
from contextlib import contextmanager

import pytest

import chat_telemetry


@pytest.mark.parametrize("error", [None, RuntimeError("private-content"), asyncio.CancelledError()])
@pytest.mark.parametrize("phase", ["prompt_build", "model_auth_max", "model_request_max"])
def test_stage_timings_are_content_free(monkeypatch, caplog, error, phase) -> None:
    attributes = {}

    class Span:
        def set_attribute(self, key, value):
            attributes[key] = value

        def set_status(self, _status):
            pass

    class Tracer:
        @contextmanager
        def start_as_current_span(self, name, **options):
            assert name == phase
            assert options == {"record_exception": False, "set_status_on_exception": False}
            yield Span()

    monkeypatch.setattr(chat_telemetry, "_tracer", Tracer())
    times = iter([1.0, 1.125])
    monkeypatch.setattr(chat_telemetry.time, "monotonic", lambda: next(times))
    with caplog.at_level(logging.INFO, logger="chat_telemetry"):
        if error is None:
            with chat_telemetry.latency_span(phase):
                pass
        else:
            with pytest.raises(type(error)), chat_telemetry.latency_span(phase):
                raise error
    outcome = "ok" if error is None else (
        "cancelled" if isinstance(error, asyncio.CancelledError) else "error"
    )
    assert attributes == {"duration_ms": 125.0, "outcome": outcome}
    assert caplog.messages == [
        f"chat.latency phase={phase} durationMs=125.00 outcome={outcome}",
    ]
    assert "private-content" not in caplog.text


@pytest.mark.parametrize("phase", sorted(chat_telemetry.CHAT_PHASES))
def test_completion_timings_are_allowlisted_and_bounded(monkeypatch, phase) -> None:
    timings = {}
    token = chat_telemetry.current_chat_phase_timings.set(timings)
    monkeypatch.setattr(chat_telemetry.time, "monotonic", lambda: 700.0)
    try:
        chat_telemetry.log_latency(phase, 0.0)
        chat_telemetry.log_latency(phase, 699.0)
        chat_telemetry.log_latency("private_phase", 0.0)
    finally:
        chat_telemetry.current_chat_phase_timings.reset(token)

    assert timings == {phase: 600_000}


@pytest.mark.parametrize("phase", ["model_auth_max", "model_request_max"])
def test_maximum_timings_preserve_the_slowest_sample(monkeypatch, phase) -> None:
    timings = {}
    token = chat_telemetry.current_chat_phase_timings.set(timings)
    monkeypatch.setattr(chat_telemetry.time, "monotonic", lambda: 100.0)
    try:
        for started in (99.0, 80.0, 98.0):
            chat_telemetry.log_latency(phase, started)
    finally:
        chat_telemetry.current_chat_phase_timings.reset(token)
    assert timings == {phase: 20_000}


@pytest.mark.parametrize("phase", ["model_auth_max", "model_request_max"])
@pytest.mark.parametrize("started", [float("nan"), float("inf"), -float("inf"), 101.0])
def test_maximum_timings_reject_invalid_samples(monkeypatch, caplog, phase, started) -> None:
    timings = {}
    token = chat_telemetry.current_chat_phase_timings.set(timings)
    monkeypatch.setattr(chat_telemetry.time, "monotonic", lambda: 100.0)
    try:
        with caplog.at_level(logging.INFO, logger="chat_telemetry"):
            chat_telemetry.log_latency(phase, started)
        assert timings == {}
        assert caplog.messages == []
        chat_telemetry.log_latency(phase, 99.0)
        chat_telemetry.log_latency(phase, started)
        assert timings == {phase: 1_000}
    finally:
        chat_telemetry.current_chat_phase_timings.reset(token)


@pytest.mark.parametrize("phase", ["model_request", "settings"])
def test_existing_timings_keep_the_first_sample(monkeypatch, phase) -> None:
    timings = {}
    token = chat_telemetry.current_chat_phase_timings.set(timings)
    monkeypatch.setattr(chat_telemetry.time, "monotonic", lambda: 100.0)
    try:
        chat_telemetry.log_latency(phase, 99.0)
        chat_telemetry.log_latency(phase, 80.0)
    finally:
        chat_telemetry.current_chat_phase_timings.reset(token)
    assert timings == {phase: 1_000}


@pytest.mark.asyncio
async def test_maximum_timings_are_isolated_between_concurrent_turns(monkeypatch) -> None:
    monkeypatch.setattr(chat_telemetry.time, "monotonic", lambda: 100.0)

    async def turn(duration):
        timings = {}
        token = chat_telemetry.current_chat_phase_timings.set(timings)
        try:
            chat_telemetry.log_latency("model_auth_max", 100.0 - duration)
            await asyncio.sleep(0)
            chat_telemetry.log_latency("model_request_max", 100.0 - duration * 2)
            return timings
        finally:
            chat_telemetry.current_chat_phase_timings.reset(token)

    assert await asyncio.gather(turn(1), turn(5)) == [
        {"model_auth_max": 1_000, "model_request_max": 2_000},
        {"model_auth_max": 5_000, "model_request_max": 10_000},
    ]
    assert chat_telemetry.current_chat_phase_timings.get() is None

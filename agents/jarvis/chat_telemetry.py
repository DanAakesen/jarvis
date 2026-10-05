"""Content-free timings for hosted chat preparation and streaming."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.trace import Span, Status, StatusCode

logger = logging.getLogger("chat_telemetry")
_tracer = trace.get_tracer("VoiceHostedAgent.Chat")


def log_latency(phase: str, started: float, outcome: str = "ok") -> float:
    duration_ms = max(0.0, (time.monotonic() - started) * 1000)
    trace.get_current_span().add_event("chat.latency", {
        "phase": phase, "duration_ms": duration_ms, "outcome": outcome,
    })
    logger.info(
        "chat.latency phase=%s durationMs=%.2f outcome=%s",
        phase, duration_ms, outcome,
    )
    return duration_ms


@contextmanager
def latency_span(phase: str) -> Iterator[Span]:
    started = time.monotonic()
    outcome = "ok"
    with _tracer.start_as_current_span(
        phase, record_exception=False, set_status_on_exception=False,
    ) as span:
        try:
            yield span
        except (asyncio.CancelledError, GeneratorExit):
            outcome = "cancelled"
            raise
        except BaseException:
            outcome = "error"
            span.set_status(Status(StatusCode.ERROR))
            raise
        finally:
            span.set_attribute("duration_ms", log_latency(phase, started, outcome))
            span.set_attribute("outcome", outcome)

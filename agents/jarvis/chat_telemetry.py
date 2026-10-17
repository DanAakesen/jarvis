"""Content-free timings for hosted chat preparation and streaming."""

from __future__ import annotations

import asyncio
import logging
import math
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from opentelemetry import trace
from opentelemetry.trace import Span, Status, StatusCode

logger = logging.getLogger("chat_telemetry")
_tracer = trace.get_tracer("VoiceHostedAgent.Chat")
MAX_CHAT_PHASE_DURATION_MS = 600_000
CHAT_MAX_PHASES = frozenset({"model_auth_max", "model_request_max"})
CHAT_PHASES = frozenset({
    "chat_history_verification", "chat_context", "tool_catalogue", "settings",
    "turn_context", "prompt_build", "model_coordination", "model_request", "model_first_delta",
    "model_to_first_delta", "agent_pre_model", "agent_first_delta",
}) | CHAT_MAX_PHASES
current_chat_phase_timings: ContextVar[dict[str, float] | None] = ContextVar(
    "chat_phase_timings", default=None
)
current_chat_started_at: ContextVar[float | None] = ContextVar("chat_started_at", default=None)
current_model_started_at: ContextVar[float | None] = ContextVar("model_started_at", default=None)


def log_latency(phase: str, started: float, outcome: str = "ok") -> float:
    elapsed_ms = (time.monotonic() - started) * 1000
    if phase in CHAT_MAX_PHASES:
        if not math.isfinite(elapsed_ms) or elapsed_ms < 0:
            return 0.0
        duration_ms = min(MAX_CHAT_PHASE_DURATION_MS, elapsed_ms)
    else:
        duration_ms = max(0.0, elapsed_ms)
    phase_timings = current_chat_phase_timings.get()
    if phase_timings is not None and phase in CHAT_PHASES and math.isfinite(duration_ms):
        if phase in CHAT_MAX_PHASES:
            phase_timings[phase] = max(phase_timings.get(phase, 0.0), duration_ms)
        else:
            phase_timings.setdefault(phase, min(MAX_CHAT_PHASE_DURATION_MS, duration_ms))
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

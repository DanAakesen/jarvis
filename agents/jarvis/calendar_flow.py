"""Calendar replies use backend evidence, never conversational staging claims."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from state import ModelMessage

CALENDAR_MUTATIONS = {
    "calendar_create_event", "calendar_update_event", "calendar_move_event",
    "calendar_delete_event", "calendar_confirm_change",
}
CALENDAR_READS = {
    "calendar_today_agenda", "calendar_list_events", "calendar_next_event",
    "calendar_find_free_slots",
}
_CALENDAR_CONTEXT = re.compile(
    r"\b(calendar|kalender\w*|event|events|begivenhed\w*|reservation\w*|staged|klargjort)\b",
    re.IGNORECASE,
)


def calendar_context(messages: Sequence[ModelMessage]) -> bool:
    # Context selects a workflow; it never supplies an action or approval code.
    return any(_CALENDAR_CONTEXT.search(message.content) for message in messages[-2:])


def pending_calendar(result: dict[str, Any]) -> dict[str, Any] | None:
    payload = result.get("result")
    if (
        result.get("outcome") == "ok" and isinstance(payload, dict)
        and payload.get("status") == "awaiting_confirmation"
        and isinstance(payload.get("confirmationCode"), str)
        and re.fullmatch(r"[0-9]{8}", payload["confirmationCode"])
        and isinstance(payload.get("summary"), str) and payload["summary"].strip()
    ):
        return payload
    return None


def no_calendar_evidence(danish: bool) -> str:
    return (
        "Jeg har ikke et bekræftet kalenderresultat. Jeg kan ikke sige, at ændringen er "
        "klargjort eller udført, eller at jeg har tjekket kalenderen."
        if danish else
        "I have no verified calendar result. I cannot say the change is staged or completed, "
        "or that I checked the calendar."
    )


def calendar_reply(name: str, evidence: dict[str, Any], danish: bool) -> str:
    payload = evidence.get("result")
    if evidence.get("outcome") != "ok" or not isinstance(payload, dict):
        return no_calendar_evidence(danish)
    pending = pending_calendar(evidence)
    if pending is not None and name in CALENDAR_MUTATIONS | {"calendar_pending_change"}:
        prefix = "Afventer kalendergodkendelse: " if danish else "Pending calendar approval: "
        suffix = " Intet er ændret." if danish else " Nothing has changed."
        if name in CALENDAR_MUTATIONS:
            suffix += (
                " Svar ja for at godkende eller nej for at annullere."
                if danish else " Reply yes to approve or no to cancel."
            )
        return prefix + pending["summary"] + suffix
    if name == "calendar_pending_change" and payload.get("status") == "none":
        return (
            "Der er ingen afventende kalenderændring at godkende. Jeg har ikke tjekket kalenderen."
            if danish else
            "There is no pending calendar change to approve. I have not checked the calendar."
        )
    if name == "calendar_confirm_change" and payload.get("status") in {"completed", "cancelled"}:
        detail = payload.get("detail")
        if isinstance(detail, str) and detail:
            summary = payload.get("summary")
            return detail + (" " + summary if isinstance(summary, str) else "")
    if name in CALENDAR_READS:
        time_zone = payload.get("timeZone", "UTC")
        events = payload.get("events")
        if name == "calendar_next_event":
            event = payload.get("event")
            events = [] if event is None else [event]
        if isinstance(events, list):
            lines = [
                f'{event.get("subject", "")} — {event.get("start", "")}–'
                f'{event.get("end", "")} ({time_zone})'
                for event in events if isinstance(event, dict)
            ]
            text = "\n".join(lines) or (
                "Kalenderopslaget returnerede ingen begivenheder." if danish else
                "The calendar read returned no events."
            )
        elif isinstance(payload.get("slots"), list):
            text = "\n".join(
                f'{slot.get("start", "")}–{slot.get("end", "")} ({time_zone})'
                for slot in payload["slots"] if isinstance(slot, dict)
            ) or ("Ingen ledige tider returneret." if danish else "No free slots returned.")
        else:
            return no_calendar_evidence(danish)
        if payload.get("truncated"):
            text += "\n" + (
                "Resultatet er ufuldstændigt." if danish else "The result is incomplete."
            )
        return text
    return no_calendar_evidence(danish)

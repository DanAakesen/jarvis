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
    r"\b(calendar|kalender\w*|begivenhed\w*)\b|"
    r"\b(?:add|create|schedule|tilføj|opret|læg)\b.{0,80}"
    r"\b(?:reservation\w*|appointments?|events?)\b",
    re.IGNORECASE,
)
_MAIL_CONTEXT = re.compile(r"\b(gmail|googlemail|(?:e-?)?mails?|draft|kladde\w*)\b", re.IGNORECASE)
_MAIL_RECEIPT = re.compile(
    r'(?:^|:\s*)Reply to ".{0,300}" from \S+@\S+ with this exact text:',
    re.IGNORECASE | re.DOTALL,
)
_QUOTED_CONTENT = re.compile(r'''"[^"]*"|(?<!\w)'[^']*'(?!\w)|“[^”]*”|‘[^’]*’''')
_EXPLICIT_CALENDAR_MUTATION = re.compile(
    r"^(?:(?:please|can you|could you|vil du|kan du)\s+)?"
    r"(?:add|create|schedule|move|update|delete|cancel|tilføj|opret|læg|flyt|slet|aflys)\b",
    re.IGNORECASE,
)


def _calendar_scope(text: str) -> bool:
    if _MAIL_RECEIPT.search(text):
        return False
    text = _QUOTED_CONTENT.sub("", text).strip()
    if _MAIL_CONTEXT.search(text):
        return bool(_EXPLICIT_CALENDAR_MUTATION.search(text) and re.search(
            r"\b(?:calendar|kalender\w*|begivenhed\w*)\b", text, re.IGNORECASE,
        ))
    return bool(_CALENDAR_CONTEXT.search(text) or re.match(
        r"^The event was (?:created|updated|moved|deleted)\.", text, re.IGNORECASE,
    ))


def calendar_context(messages: Sequence[ModelMessage]) -> bool:
    # Context selects a workflow; it never supplies an action or approval code.
    if not messages:
        return False
    latest = messages[-1].content
    if (
        (_MAIL_CONTEXT.search(latest) or _MAIL_RECEIPT.search(latest))
        and not _calendar_scope(latest)
    ):
        return False
    return any(_calendar_scope(message.content) for message in messages[-2:])


def calendar_approval_candidate(text: str) -> bool:
    # Routing only; the backend classifier and saved-message guard authorise execution.
    return len(text.strip()) <= 60 and bool(re.match(
        r"""^[\s"'“”’]*(?:yes|yeah|yep|yup|sure|ok|okay|approve|approved|confirm|confirmed|"""
        r"go ahead|do it|send it|proceed|please do|sounds good|looks good|ja|jep|jo|"
        r"godkend|godkendt|bekræft|bekræftet|gør det|kør|send den|fint|"
        r"no|nope|nah|cancel|stop|dont|don't|never mind|nevermind|decline|reject|"
        r"nej|annuller|afbryd|lad være)\b", text, re.IGNORECASE,
    ))


def calendar_status_question(text: str) -> bool:
    text = text.strip()
    if _MAIL_CONTEXT.search(text):
        return False
    return bool(
        _CALENDAR_CONTEXT.search(text)
        and re.match(r"^(?:is|did|have|has|status|er|har|blev|tjekkede)\b", text, re.IGNORECASE)
        or re.match(
            r"^(?:(?:is|was|has) (?:it|that|the event|the appointment) (?:already )?"
            r"(?:created|staged|added|scheduled|completed|cancelled)|"
            r"(?:did|have) you (?:already )?(?:create|stage|add|schedule|complete|cancel|check)"
            r" (?:it|that|the event|the appointment)|(?:er|blev) (?:den|det) "
            r"(?:oprettet|klargjort|tilføjet|udført)|"
            r"har du (?:oprettet|klargjort|tilføjet|tjekket) (?:den|det))\b",
            text, re.IGNORECASE,
        )
    )


def calendar_claim(text: str) -> bool:
    return bool(re.search(
        r"\b(staged|prepared|created|scheduled|booked|checked|added|completed|done|"
        r"klargjort|oprettet|tjekket|tilføjet|udført)\b|"
        r"\b(?:reply|say|answer|svar)\b.{0,40}\b(?:yes|ja)\b",
        text, re.IGNORECASE,
    ))


def calendar_clarification(text: str) -> bool:
    return bool(
        text.strip().endswith("?") and not calendar_claim(text)
        and re.match(r"^(?:what|which|when|where|who|hvad|hvilke|hvornår|hvor|hvem)\b",
                     text.strip(), re.IGNORECASE)
    )


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
        reason = None
        if isinstance(payload, dict):
            reason = next((payload[key] for key in ("refused", "failure", "error")
                           if isinstance(payload.get(key), str)), None)
        return no_calendar_evidence(danish) + (" " + reason if reason else "")
    pending = pending_calendar(evidence)
    if pending is not None and name in CALENDAR_MUTATIONS | {"calendar_get_pending_change"}:
        prefix = "Afventer kalendergodkendelse: " if danish else "Pending calendar approval: "
        suffix = " Intet er ændret." if danish else " Nothing has changed."
        if name in CALENDAR_MUTATIONS:
            suffix += (
                " Svar ja for at godkende eller nej for at annullere."
                if danish else " Reply yes to approve or no to cancel."
            )
        return prefix + pending["summary"] + suffix
    if name == "calendar_get_pending_change" and payload.get("status") == "none":
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

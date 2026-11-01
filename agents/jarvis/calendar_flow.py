"""Calendar replies use backend evidence, never conversational staging claims."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from state import ModelMessage

CALENDAR_MUTATIONS = {
    "calendar_create_event", "calendar_create_events", "calendar_update_event",
    "calendar_move_event", "calendar_delete_event", "calendar_confirm_change",
}
CALENDAR_READS = {
    "calendar_today_agenda", "calendar_list_events", "calendar_next_event",
    "calendar_find_free_slots",
}
_CALENDAR_CONTEXT = re.compile(
    r"\b(calendar|kalender\w*|begivenhed\w*|meetings?|møde\w*)\b|"
    r"\b(?:add|create|schedule|tilføj|opret|læg)\b.{0,80}"
    r"\b(?:reservation\w*|appointments?|events?)\b",
    re.IGNORECASE,
)
_MAIL_CONTEXT = re.compile(r"\b(gmail|googlemail|(?:e-?)?mails?|draft|kladde\w*)\b", re.IGNORECASE)
_NOTES_CONTEXT = re.compile(r"\b(?:notes?|notebooks?|notat\w*)\b", re.IGNORECASE)
_MAIL_RECEIPT = re.compile(
    r'(?:^|:\s*)Reply to ".{0,300}" from \S+@\S+ with this exact text:',
    re.IGNORECASE | re.DOTALL,
)
_QUOTED_CONTENT = re.compile(r'''"[^"]*"|(?<!\w)'[^']*'(?!\w)|“[^”]*”|‘[^’]*’''')
_EXPLICIT_CALENDAR_MUTATION = re.compile(
    r"^(?:(?:please|can you|could you|would you|vil du|kan du)\s+)*"
    r"(?:add?|create|schedule|put|book|move|update|delete|cancel|"
    r"tilføj|opret|læg|flyt|slet|aflys)\b",
    re.IGNORECASE,
)
_EXPLICIT_CALENDAR_CREATE = re.compile(
    r"^(?:(?:please|can you|could you|would you|vil du|kan du)\s+)*"
    r"(?:add?|create|schedule|put|book|tilføj|opret|læg)\b",
    re.IGNORECASE,
)
_CALENDAR_ACTION = (
    r"(?:add(?:ing)?|creat(?:e|ing)|schedul(?:e|ing)|put(?:ting)?|book(?:ing)?|"
    r"mov(?:e|ing)|updat(?:e|ing)|delet(?:e|ing)|cancel(?:ling)?|reschedul(?:e|ing)|"
    r"tilføje?|oprette?|lægge?|flytte?|slette?|aflyse?|ændre)"
)
_CALENDAR_OFFER = re.compile(
    r"\b(?:shall I|should I|can I|could I|would you like me to|do you want me to|"
    r"I (?:can|could|suggest|recommend)|vil du have(?:,)? at jeg|"
    r"skal jeg|kan jeg|jeg (?:kan|foreslår|anbefaler))\s+(?:(?:we|that we|at vi)\s+)?"
    rf"\b{_CALENDAR_ACTION}\b",
    re.IGNORECASE,
)


def calendar_offer(text: str) -> bool:
    return bool(_CALENDAR_OFFER.search(_QUOTED_CONTENT.sub("", text)))


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
        (
            _MAIL_CONTEXT.search(latest) or _MAIL_RECEIPT.search(latest)
            or _NOTES_CONTEXT.search(latest)
        )
        and not _calendar_scope(latest)
    ):
        return False
    return any(_calendar_scope(message.content) for message in messages[-2:])


def _calendar_request_text(message: ModelMessage) -> str:
    text = message.content.removeprefix(
        "Dan interrupted your previous reply with this message; continue accordingly:\n"
    )
    return _QUOTED_CONTENT.sub("", text).strip()


def calendar_multiple_requested(messages: Sequence[ModelMessage]) -> bool:
    if not messages:
        return False
    text = _calendar_request_text(messages[-1])
    count = (
        r"(?:[2-9]|10|two|three|four|five|six|seven|eight|nine|ten|"
        r"tre|fire|fem|seks|syv|otte|ni|ti)"
    )
    return bool(
        (
            _calendar_scope(text)
            or (
                not (_MAIL_CONTEXT.search(text) or _NOTES_CONTEXT.search(text))
                and calendar_context(messages[:-1])
            )
        )
        and _EXPLICIT_CALENDAR_CREATE.search(text)
        and (
            re.search(r"\b(?:both|begge|alle)\b|\ball\b(?![- ]day\b)", text, re.IGNORECASE)
            or re.search(
                rf"\b{count}\s+(?:(?:hotel|calendar)\s+)?"
                r"(?:bookings|events|reservations|appointments|bookinger|begivenheder|"
                r"reservationer|aftaler)\b",
                text, re.IGNORECASE,
            )
            or re.search(rf"\b(?:these|those|disse|de)\s+{count}\b", text, re.IGNORECASE)
            or re.search(r"\b(?:de|disse)\s+to\b", text, re.IGNORECASE)
            or re.search(
                rf"\b{count}\s+(?:to|in|into|on|til|i|på)\s+(?:(?:my|min)\s+)?"
                r"(?:calendar|kalender)\b", text, re.IGNORECASE,
            )
            or re.search(
                r"\b(?:tilføj|opret|læg)\b.*\bto\s+"
                r"(?:begivenheder|bookinger|reservationer|aftaler|til|i|på)\b",
                text, re.IGNORECASE,
            )
        )
    )


def calendar_batch_matches_request(
    messages: Sequence[ModelMessage], proposal: dict[str, Any] | None,
) -> bool:
    """Bind trusted backend state to verified user metadata, never assistant prose."""
    batch = isinstance(proposal, dict) and (
        isinstance(proposal.get("items"), list) or "sourceMessageId" in proposal
    )
    source_id = proposal.get("sourceMessageId") if isinstance(proposal, dict) else None
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        text = _calendar_request_text(message)
        if (
            message.role != "user" or not _EXPLICIT_CALENDAR_MUTATION.search(text)
        ):
            continue
        multiple = calendar_multiple_requested(messages[:index + 1])
        scoped = _calendar_scope(message.content) or multiple
        if not scoped and not _EXPLICIT_CALENDAR_CREATE.search(text):
            continue
        if batch:
            return bool(
                scoped and isinstance(source_id, str)
                and re.fullmatch(r"[1-9][0-9]{0,18}", source_id)
                and int(source_id) <= 9_223_372_036_854_775_807
                and message.source_message_id == source_id
            )
        if scoped:
            return not multiple
    return not batch


def calendar_response_scope(messages: Sequence[ModelMessage], text: str) -> bool:
    if (
        _calendar_scope(text) or (messages and _calendar_scope(messages[-1].content))
        or calendar_multiple_requested(messages)
    ):
        return True
    return bool(
        messages and calendar_context(messages)
        and (calendar_status_question(messages[-1].content)
             or re.match(r"^(?:why|what about|hvorfor|hvad med)\b",
                         messages[-1].content.strip(), re.IGNORECASE)
             or re.search(
                 r"(?:^|[.!?]\s+|\n)\s*(?:done|all set|both|all|they|it|that|this|"
                 r"begge|alle|de|den|det)\b", text, re.IGNORECASE,
             ))
    )


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
    """Identify affirmative action/approval claims, not the topic or explanatory wording."""
    action = (
        r"(?:staged|prepared|created|scheduled|booked|checked|added|put|completed|"
        r"updated|moved|deleted|cancelled|done|"
        r"klargjort|oprettet|tjekket|tilføjet|udført|flyttet|slettet|annulleret)"
    )
    claim = re.compile(
        rf"\b(?:I|we|jeg|vi)(?:['’]ve|\s+(?:have|has|had|har))?\s+"
        rf"(?:(?:already|just|now|successfully|allerede|nu)\s+)*{action}\b|"
        r"\b(?:it|that|this|the|your|both|all|den|det|begge)\b[^.!?;\n]{0,90}?"
        rf"\b(?:is|are|was|were|has been|have been|er|blev)\s+"
        rf"(?:(?:already|now|successfully|allerede|nu)\s+)*(?:{action}|"
        r"ready for (?:your )?approval|(?:in|on) your calendar|"
        r"in(?:\s+now)?(?=[.!?;\n]|$))\b|"
        rf"^\s*(?:{action}|all set)\b|"
        r"^\s*(?:pending calendar approval|afventer kalendergodkendelse)\s*:|"
        r"^\s*(?:reply|say|answer|svar)\b.{0,40}\b(?:yes|ja)\b",
        re.IGNORECASE,
    )
    for sentence in re.split(r"(?<=[.!?;])\s+|\n+", _QUOTED_CONTENT.sub("", text)):
        if sentence.rstrip().endswith("?") or re.match(
            r"^\s*(?:if|when|unless|once|hvis|når)\b", sentence, re.IGNORECASE,
        ):
            continue
        match = claim.search(sentence)
        if match and not re.search(
            r"\b(?:not|never|no|cannot|can't|couldn't|haven't|hasn't|didn't|"
            r"don't|doesn't|isn't|aren't|wasn't|weren't|ikke|ingen|intet)\b",
            sentence[:match.start()].replace("’", "'"), re.IGNORECASE,
        ):
            return True
    return False


def calendar_safe_prefix(text: str) -> str:
    """Release complete non-action or explicit-intent sentences; buffer unsafe wording."""
    end = 0
    for boundary in re.finditer(r"(?<=[.!?])(?:\s+|$)|\n+", text):
        sentence = text[end:boundary.end()]
        if (
            (_calendar_scope(sentence) and not _calendar_intent(sentence))
            or calendar_claim(sentence) or calendar_offer(sentence)
        ):
            break
        end = boundary.end()
    return text[:end]


def calendar_safe_acknowledgment_prefix(text: str) -> str:
    safe = calendar_safe_prefix(text)
    match = re.match(
        r"^\s*(?:I(?:'ll| will| can| am going to)\s+"
        r"(?:check|look at|review|compare|search|find|verify)\b|"
        r"Jeg\s+(?:vil|skal|kan|tjekker|undersøger|gennemgår)\b)[^.!?\n]*[.!?]",
        safe,
        re.IGNORECASE,
    )
    return match.group(0).strip() if match else ""


def _calendar_intent(sentence: str) -> bool:
    return re.match(
        r"^\s*(?:I(?:'ll| will| can| am going to)\s+"
        r"(?:check|look at|review|compare|search|find|verify)\b|"
        r"Jeg\s+(?:vil|skal|kan|tjekker|undersøger|gennemgår)\b)",
        sentence,
        re.IGNORECASE,
    ) is not None


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


def _approval_question(pending: dict[str, Any], danish: bool) -> str:
    """Ask Dan in plain words what to do with a staged change; never prescribe how to answer."""
    items = pending.get("items")
    count = len(items) if isinstance(items, list) and len(items) >= 2 else 0
    if danish:
        return (
            f" Vil du have, at jeg opretter alle {count} viste begivenheder, eller skal jeg "
            "droppe hele forslaget?"
            if count else " Vil du have, at jeg udfører ændringen?"
        )
    return (
        f" Do you want me to create all {count} listed events, or drop the entire proposal?"
        if count else " Do you want me to make this change?"
    )


def _pending_notice(pending: dict[str, Any], danish: bool, ask: bool) -> str:
    return (
        ("Afventer kalendergodkendelse: " if danish else "Pending calendar approval: ")
        + pending["summary"]
        + (" Intet er ændret." if danish else " Nothing has changed.")
        + (_approval_question(pending, danish) if ask else "")
    )


def calendar_unsettled_confirmation(
    name: str, result: dict[str, Any], state: dict[str, Any] | None,
) -> dict[str, Any]:
    """Tag a backend-refused confirmation while the change is still staged.

    The backend judges what Dan's reply means. When it cannot tell, the refusal text is written
    for the model, so Dan is asked a plain question about the staged change instead.
    """
    if name != "calendar_confirm_change" or result.get("outcome") != "refused":
        return result
    pending = pending_calendar(state) if isinstance(state, dict) else None
    return result if pending is None else {**result, "stillPending": pending}


def calendar_details_requested(text: str) -> bool:
    return bool(re.search(
        r"\b(?:read (?:them|it) (?:to me|aloud)|what (?:time|details|address|place)|"
        r"when (?:is|was|are|were)|læs (?:dem|det) (?:op|for mig)|"
        r"hvad (?:tid|var detaljerne|var adressen)|hvornår (?:er|var))\b",
        text,
        re.IGNORECASE,
    ))


def calendar_reply(
    name: str, evidence: dict[str, Any], danish: bool, include_details: bool = False
) -> str:
    payload = evidence.get("result")
    if evidence.get("outcome") != "ok" or not isinstance(payload, dict):
        unsettled = pending_calendar({"outcome": "ok", "result": evidence.get("stillPending")})
        if name == "calendar_confirm_change" and unsettled is not None:
            return (
                "Jeg var ikke sikker på, hvad du mente. " if danish
                else "I wasn't sure what you meant. "
            ) + _pending_notice(unsettled, danish, ask=True)
        reason = None
        if isinstance(payload, dict):
            reason = next((payload[key] for key in ("refused", "failure", "error")
                           if isinstance(payload.get(key), str)), None)
        return no_calendar_evidence(danish) + (" " + reason if reason else "")
    pending = pending_calendar(evidence)
    if pending is not None and name in CALENDAR_MUTATIONS | {"calendar_get_pending_change"}:
        return _pending_notice(pending, danish, ask=name in CALENDAR_MUTATIONS)
    if name == "calendar_get_pending_change" and payload.get("status") == "none":
        text = (
            "Der er ingen afventende kalenderændring at godkende. Jeg har ikke tjekket kalenderen."
            if danish else
            "There is no pending calendar change to approve. I have not checked the calendar."
        )
        last_change = payload.get("lastChange")
        if isinstance(last_change, dict):
            text += "\n\n" + (
                "Seneste registrerede resultat: " if danish else "Last recorded result: "
            ) + calendar_reply(
                "calendar_confirm_change", {"outcome": "ok", "result": last_change},
                danish, include_details,
            )
        return text
    if name == "calendar_confirm_change" and payload.get("status") in {
        "completed", "cancelled", "partial", "unverified",
    }:
        if payload.get("status") == "completed" and not include_details:
            items = payload.get("items")
            if isinstance(items, list) and len(items) > 1:
                return (
                    "Begge er i kalenderen." if danish and len(items) == 2 else
                    f"Alle {len(items)} er i kalenderen." if danish else
                    "Both are in your calendar." if len(items) == 2 else
                    f"All {len(items)} are in your calendar."
                )
            return "Kalenderændringen er gennemført." if danish else "The calendar change is done."
        detail = payload.get("detail")
        if isinstance(detail, str) and detail:
            summary = payload.get("summary")
            items = payload.get("items")
            if isinstance(items, list) and items:
                lines = []
                labels = {
                    "completed": "Oprettet" if danish else "Created",
                    "failed": "Ikke oprettet" if danish else "Not created",
                    "unverified": "Ikke bekræftet" if danish else "Unverified",
                    "not_attempted": "Ikke forsøgt" if danish else "Not attempted",
                    "cancelled": "Annulleret" if danish else "Cancelled",
                }
                for index, item in enumerate(items, 1):
                    if (
                        isinstance(item, dict)
                        and (include_details or item.get("status") != "completed")
                        and isinstance(item.get("summary"), str)
                    ):
                        status = labels.get(item.get("status"), labels["unverified"])
                        lines.append(
                            f'{index}. {item["summary"]}\n'
                            f'   {status}: {item.get("detail", "")}'
                        )
                return detail + "\n\n" + "\n\n".join(lines)
            return detail + (" " + summary if isinstance(summary, str) else "")
    if name in CALENDAR_READS:
        time_zone = payload.get("timeZone", "UTC")
        events = payload.get("events")
        if name == "calendar_next_event":
            event = payload.get("event")
            events = [] if event is None else [event]
        if isinstance(events, list):
            lines = [
                f'{event.get("subject", "")} — {event.get("startLocal", event.get("start", ""))}–'
                f'{event.get("endLocal", event.get("end", ""))} '
                f'({time_zone if event.get("startLocal") or event.get("allDay") else "ISO times"})'
                for event in events if isinstance(event, dict)
            ]
            text = "\n".join(lines) or (
                "Kalenderopslaget returnerede ingen begivenheder." if danish else
                "The calendar read returned no events."
            )
        elif isinstance(payload.get("slots"), list):
            text = "\n".join(
                f'{slot.get("startLocal", slot.get("start", ""))}–'
                f'{slot.get("endLocal", slot.get("end", ""))} '
                f'({time_zone if slot.get("startLocal") else "ISO times"})'
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

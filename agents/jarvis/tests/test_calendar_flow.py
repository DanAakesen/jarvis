"""Regression turns use the real model loop with a synthetic backend and provider."""

import json
import re
from dataclasses import replace
from itertools import count
from types import SimpleNamespace

import httpx
import pytest
from test_model_client import (
    FakeAnthropic,
    FakeAnthropicStream,
    FakeBackend,
    FakeItem,
    client,
    completed,
)

from calendar_flow import (
    calendar_batch_matches_request,
    calendar_claim,
    calendar_details_requested,
    calendar_multiple_requested,
    calendar_offer,
    calendar_reply,
    calendar_unsettled_confirmation,
    pending_calendar,
)
from jarvis_tools import current_message_id, current_steering_fetcher
from state import ModelMessage

SUMMARY = (
    'Create "Synthetic Hotel Beta reservation TEST-BOOKING-002" from '
    '2027-12-09T15:00:00.000Z '
    'to 2027-12-10T11:00:00.000Z (Europe/Copenhagen); attendees: none.'
)
PENDING = {"status": "awaiting_confirmation", "confirmationCode": "12345678", "summary": SUMMARY}
MOVE_PENDING = {
    **PENDING,
    "summary": 'Move "Synthetic meeting" to 15:00–16:00 (Europe/Copenhagen); attendees: none.',
}
MAIL_SUMMARY = (
    'Reply to "Dentist appointment" from guest@example.test with this exact text:\n'
    'Synthetic reply.'
)
HOTEL_EVENTS = [
    {"subject": "Hotel stay: Synthetic Hotel Alpha", "startDateTime": "2027-06-14T15:00:00+02:00",
     "endDateTime": "2027-06-15T11:00:00+02:00", "attendees": []},
    {"subject": "Hotel stay: Synthetic Hotel Beta", "startDateTime": "2027-12-09T16:00:00+01:00",
     "endDateTime": "2027-12-10T12:00:00+01:00", "attendees": []},
]
BATCH_SUMMARIES = [
    'Create "Hotel stay: Synthetic Hotel Alpha" from 14 June 2027 at 15:00 to '
    '15 June 2027 at 11:00 (Europe/Copenhagen local time); attendees: none.',
    'Create "Hotel stay: Synthetic Hotel Beta" from 09 December 2027 at 16:00 to '
    '10 December 2027 at 12:00 (Europe/Copenhagen local time); attendees: none.',
]
BATCH_PENDING = {
    "status": "awaiting_confirmation", "confirmationCode": "12345678",
    "sourceMessageId": "42",
    "summary": "Create 2 calendar events:\n\n1. " + BATCH_SUMMARIES[0]
    + "\n\n2. " + BATCH_SUMMARIES[1],
    "items": [{"summary": summary} for summary in BATCH_SUMMARIES],
}


def delta(text):
    return FakeItem(type="response.output_text.delta", delta=text)


_tool_call_ids = count()


def tool_call(name):
    return FakeItem(
        type="function_call", name=name, arguments="{}", call_id=f"call-{next(_tool_call_ids)}",
    )


class CalendarBackend(FakeBackend):
    def __init__(self, pending=None, outcome="ok", fail_confirmation=False, strict_reply=False):
        super().__init__(catalogue=[
            {"name": name, "description": name, "inputSchema": {"type": "object"}}
            for name in ["calendar_get_pending_change", "calendar_confirm_change",
                         "calendar_create_event", "calendar_move_event", "calendar_list_events",
                         "mail_search", "mail_confirm_action"]
        ])
        self.pending = pending
        self.stage_result = PENDING.copy()
        self.outcome = outcome
        self.fail_confirmation = fail_confirmation
        # The real backend refuses a confirmation unless it judged Dan's latest message to
        # approve or decline; the flag lets a test play that refusal.
        self.strict_reply = strict_reply
        self.reply = None
        self.applied = []

    def refuse_undecided_reply(self):
        if not self.strict_reply:
            return None
        if self.pending is None:
            message = "No change was made. There is no pending change waiting for a reply."
        elif self.reply not in {"approve", "decline"}:
            message = (
                "No change was made. The latest message did not clearly approve or decline the "
                "pending change. Ask one short, natural question about it."
            )
        else:
            return None
        return httpx.Response(200, json={"outcome": "refused", "result": {"refused": message}})

    def handle(self, request):
        name = request.url.path.rsplit("/", 1)[-1]
        if request.method == "POST" and name == "mail_confirm_action":
            self.requests.append(request)
            assert json.loads(request.content) == {"confirmationCode": "87654321"}
            return httpx.Response(200, json={"outcome": "ok", "result": {
                "status": "completed", "detail": "The Gmail reply draft was saved.",
            }})
        if request.method == "POST" and name.startswith("calendar_"):
            self.requests.append(request)
            if name == "calendar_get_pending_change":
                payload = {**(self.pending or {"status": "none"}), "reply": self.reply}
            elif name in {"calendar_create_event", "calendar_move_event"}:
                self.pending = self.stage_result.copy() if self.outcome == "ok" else None
                payload = self.stage_result.copy()
            elif name == "calendar_confirm_change":
                assert json.loads(request.content) == {"confirmationCode": "12345678"}
                refusal = self.refuse_undecided_reply()
                if refusal is not None:
                    return refusal
                if self.reply != "decline" and not self.fail_confirmation:
                    self.applied.append(self.pending)
                self.pending = None  # Consumption happens before provider execution.
                payload = {"status": "completed", "detail": "The event was created.",
                           "summary": SUMMARY,
                           "instruction": "Confirm briefly without reading details aloud."}
                if self.fail_confirmation:
                    return httpx.Response(200, json={"outcome": "error",
                                                    "result": {"error": "Provider failed"}})
            else:
                payload = {"events": [], "timeZone": "Europe/Copenhagen", "truncated": False}
            return httpx.Response(200, json={"outcome": self.outcome, "result": payload})
        return super().handle(request)

    @property
    def calendar_calls(self):
        return [r.url.path.rsplit("/", 1)[-1] for r in self.requests
                if r.method == "POST" and r.url.path.rsplit("/", 1)[-1].startswith("calendar_")]


class CalendarBatchBackend(CalendarBackend):
    def __init__(self, partial=False):
        super().__init__()
        self.catalogue.append({
            "name": "calendar_create_events", "description": "Stage all events.",
            "inputSchema": {"type": "object"},
        })
        self.partial = partial
        self.last_change = None

    def handle(self, request):
        name = request.url.path.rsplit("/", 1)[-1]
        if request.method == "POST" and name == "calendar_create_events":
            self.requests.append(request)
            assert json.loads(request.content) == {"events": HOTEL_EVENTS}
            self.pending = {
                **BATCH_PENDING, "sourceMessageId": request.headers["x-jarvis-message-id"],
            }
            self.last_change = None
            return httpx.Response(200, json={"outcome": "ok", "result": self.pending})
        if request.method == "POST" and name == "calendar_confirm_change":
            self.requests.append(request)
            assert self.pending is not None
            refusal = self.refuse_undecided_reply()
            if refusal is not None:
                return refusal
            source_id = self.pending["sourceMessageId"]
            assert self.pending == {**BATCH_PENDING, "sourceMessageId": source_id}
            assert json.loads(request.content) == {"confirmationCode": "12345678"}
            self.pending = None
            cancelled = self.reply == "decline"
            statuses = (
                ["cancelled", "cancelled"] if cancelled else
                ["completed", "unverified"] if self.partial else ["completed", "completed"]
            )
            self.last_change = {
                "status": "cancelled" if cancelled else "partial" if self.partial else "completed",
                "summary": BATCH_PENDING["summary"],
                "sourceMessageId": source_id,
                "detail": "No change was made." if cancelled else
                "1 of 2 calendar events were created." if self.partial else
                "2 of 2 calendar events were created.",
                "items": [{"summary": summary, "status": status, "detail": status}
                          for summary, status in zip(BATCH_SUMMARIES, statuses, strict=True)],
            }
            if not cancelled and not self.partial:
                self.last_change["instruction"] = (
                    "Confirm briefly without reading details aloud."
                )
            return httpx.Response(200, json={"outcome": "ok", "result": self.last_change})
        if (request.method == "POST" and name == "calendar_get_pending_change"
                and self.pending is None and self.last_change is not None):
            self.requests.append(request)
            return httpx.Response(200, json={"outcome": "ok", "result": {
                "status": "none", "reply": self.reply, "lastChange": self.last_change,
            }})
        return super().handle(request)


class UncertainCalendarBatchBackend(CalendarBatchBackend):
    def __init__(self):
        super().__init__()
        self.batch_attempts = 0
        for tool in self.catalogue:
            tool["execution"] = {
                "defaultEffect": (
                    "read" if tool["name"] in {
                        "calendar_get_pending_change", "calendar_list_events",
                    } else "action"
                ),
            }

    def handle(self, request):
        name = request.url.path.rsplit("/", 1)[-1]
        if request.method == "POST" and name == "calendar_create_events":
            self.requests.append(request)
            self.batch_attempts += 1
            assert json.loads(request.content) == {"events": HOTEL_EVENTS}
            return httpx.Response(200, json={
                "outcome": "error",
                "result": {"error": "Calendar provider outcome is uncertain."},
            })
        return super().handle(request)


async def turn(model, messages, message_id="42", voice=False):
    token = current_message_id.set(message_id)
    try:
        messages = [
            *messages[:-1], replace(messages[-1], source_message_id=message_id),
        ]
        stream = model.complete(messages) if voice else model.complete_chat(messages, "en")
        return "".join([chunk async for chunk in stream])
    finally:
        current_message_id.reset(token)


def provider_client(provider, backend, rounds):
    backend.model_name = "claude-sonnet-5" if provider == "anthropic" else "deployment"
    model, transport = client([], backend=backend, rounds=rounds)
    if provider == "anthropic":
        model._anthropic_client = FakeAnthropic([
            FakeAnthropicStream(
                [event.delta for event in events if event.type == "response.output_text.delta"],
                SimpleNamespace(content=[
                    FakeItem(type="tool_use", id=call.call_id, name=call.name,
                             input=json.loads(call.arguments))
                    for event in events if event.type == "response.completed"
                    for call in event.response.output if call.type == "function_call"
                ], usage=None),
            ) for events in rounds
        ])
    return model, transport


@pytest.mark.parametrize("voice", [False, True])
async def test_staging_then_repeated_yes_executes_once_without_restage_or_approval_loop(voice):
    backend = CalendarBackend()
    model, transport = client([], backend=backend, rounds=[[
        delta("I checked the calendar and created it. Say yes again."),
        completed(tool_call("calendar_create_event")),
    ]])
    try:
        staged = await turn(
            model, [ModelMessage("user", "Add my Synthetic Hotel Beta reservation")], voice=voice
        )
        assert SUMMARY in staged
        assert "12345678" not in staged
        assert "I checked" not in staged and "created it" not in staged
        backend.reply = "approve"
        history = [ModelMessage("assistant", staged), ModelMessage("user", "yes")]
        confirmed = await turn(model, history, "43", voice=voice)
        assert confirmed == (
            "Kalenderændringen er gennemført." if voice else "The calendar change is done."
        )
        assert SUMMARY not in confirmed
        repeated = await turn(model, [ModelMessage("assistant", confirmed),
                                     ModelMessage("user", "yes")], "44", voice=voice)
        assert "pending calendar change" in repeated or "afventende kalenderændring" in repeated
        assert "Reply yes" not in repeated
        assert backend.calendar_calls.count("calendar_confirm_change") == 1
        assert backend.calendar_calls.count("calendar_create_event") == 1
        assert len(transport.responses.requests) == 1
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("older_pending", [None, PENDING])
@pytest.mark.parametrize("voice,question,offer,yes", [
    (False, "My calendar meeting would fit better at 15:00.",
     "Shall I move your calendar meeting to 15:00?", "yes"),
    (True, "Mit kalendermøde passer bedre klokken 15.",
     "Skal jeg flytte dit kalendermøde til klokken 15?", "ja"),
])
async def test_conversational_offer_is_staged_before_delivery_and_yes_applies_it(
    provider, older_pending, voice, question, offer, yes,
):
    backend = CalendarBackend(pending=older_pending, strict_reply=True)
    backend.stage_result = MOVE_PENDING.copy()
    model, _ = provider_client(provider, backend, [
        [delta(offer), completed()],
        [completed(tool_call("calendar_move_event"))],
    ])
    try:
        staged = await turn(model, [ModelMessage("user", question)], voice=voice)
        assert offer not in staged
        assert MOVE_PENDING["summary"] in staged and backend.pending == MOVE_PENDING
        assert backend.applied == []
        assert backend.calendar_calls.count("calendar_confirm_change") == 0
        backend.reply = "approve"
        result = await turn(model, [
            ModelMessage("assistant", staged), ModelMessage("user", yes),
        ], "43", voice=voice)
        assert result == (
            "Kalenderændringen er gennemført." if voice else "The calendar change is done."
        )
        assert backend.pending is None
        assert backend.calendar_calls.count("calendar_confirm_change") == 1
        assert backend.calendar_calls.count("calendar_move_event") == 1
        assert backend.applied == [MOVE_PENDING]
        assert "no pending" not in result and "ingen afventende" not in result
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("voice,question", [
    (False, "Move my calendar meeting to 15:00."),
    (True, "Flyt mit kalendermøde til klokken 15."),
])
async def test_direct_instruction_stages_without_an_extra_preparation_question(
    provider, voice, question,
):
    backend = CalendarBackend(strict_reply=True)
    backend.stage_result = MOVE_PENDING.copy()
    model, _ = provider_client(provider, backend, [
        [delta("Do you want me to move your calendar meeting to 15:00?"), completed()],
        [completed(tool_call("calendar_move_event"))],
    ])
    try:
        text = await turn(model, [ModelMessage("user", question)], voice=voice)
        assert MOVE_PENDING["summary"] in text
        assert "to 15:00?" not in text
        assert backend.calendar_calls.count("calendar_move_event") == 1
        assert backend.calendar_calls.count("calendar_confirm_change") == 0
        assert backend.applied == []
        backend.reply = "approve"
        approved = await turn(model, [
            ModelMessage("assistant", text), ModelMessage("user", "ja" if voice else "do it"),
        ], "43", voice=voice)
        assert approved == (
            "Kalenderændringen er gennemført." if voice else "The calendar change is done."
        )
        assert backend.applied == [MOVE_PENDING]
    finally:
        await model.close()


async def test_repeated_unstaged_offer_fails_closed_without_an_unbounded_retry():
    backend = CalendarBackend()
    offer = "Shall I move your calendar meeting to 15:00?"
    model, transport = client([], backend=backend, rounds=[
        [delta(offer), completed()], [delta(offer), completed()],
    ])
    try:
        text = await turn(model, [ModelMessage("user", "Review my calendar")])
        assert offer not in text
        assert "no verified calendar result" in text
        assert backend.pending is None
        assert backend.calendar_calls == ["calendar_get_pending_change"]
        assert len(transport.responses.requests) == 2
    finally:
        await model.close()


@pytest.mark.parametrize("text", [
    "What time should the calendar event start?",
    "I cannot move it without the new time.",
    "Would you like me to find those bookings or add them to your calendar?",
    'The email says "Shall I move your meeting?"',
])
def test_detail_questions_read_offers_and_quoted_data_are_not_change_offers(text):
    assert not calendar_offer(text)


@pytest.mark.parametrize("outcome", ["error", "refused"])
async def test_failed_stage_cannot_append_a_new_unstaged_offer(outcome):
    backend = CalendarBackend(outcome=outcome)
    offer = "Shall I move your calendar meeting to 15:00?"
    model, _ = client([], backend=backend, rounds=[
        [completed(tool_call("calendar_move_event"))], [delta(offer), completed()],
    ])
    try:
        text = await turn(model, [ModelMessage("user", "Move my meeting to 15:00")])
        assert offer not in text and "no verified calendar result" in text
        assert backend.calendar_calls.count("calendar_move_event") == 1
        assert backend.applied == []
    finally:
        await model.close()


@pytest.mark.parametrize("pending", [None, {"status": "awaiting_confirmation", "summary": SUMMARY},
                                     {**PENDING, "confirmationCode": "invented"}])
async def test_missing_or_expired_or_invalid_pending_never_confirms_or_requests_yes(pending):
    backend = CalendarBackend(pending=pending)
    backend.reply = "approve"
    model, transport = client([], backend=backend)
    try:
        text = await turn(model, [ModelMessage("assistant", "Calendar change is staged; say yes."),
                                 ModelMessage("user", "yes")])
        assert "Reply yes" not in text and "The event was created" not in text
        assert backend.calendar_calls == ["calendar_get_pending_change"]
        assert transport.responses.requests == []
    finally:
        await model.close()


@pytest.mark.parametrize("outcome", ["refused", "error"])
async def test_failed_staging_cannot_be_reported_as_staged(outcome):
    backend = CalendarBackend(outcome=outcome)
    model, _ = client([], backend=backend, rounds=[[
        delta("The event is staged. I checked the calendar. Say yes."),
        completed(tool_call("calendar_create_event")),
    ]])
    try:
        text = await turn(model, [ModelMessage("user", "Add this calendar event")])
        assert SUMMARY not in text and "Reply yes" not in text
        assert "no verified calendar result" in text
    finally:
        await model.close()


async def test_failed_confirmation_is_consumed_and_repeated_yes_does_not_retry():
    backend = CalendarBackend(pending=PENDING, fail_confirmation=True)
    backend.reply = "approve"
    model, _ = client([], backend=backend)
    try:
        messages = [ModelMessage("assistant", "Pending calendar approval: " + SUMMARY),
                    ModelMessage("user", "yes")]
        first = await turn(model, messages)
        second = await turn(model, messages, "43")
        assert "The event was created" not in first + second
        assert "Reply yes" not in first + second
        assert backend.calendar_calls.count("calendar_confirm_change") == 1
    finally:
        await model.close()


@pytest.mark.parametrize("pending", [None, PENDING])
async def test_status_question_uses_actual_state_and_never_invents_calendar_read(pending):
    backend = CalendarBackend(pending=pending)
    model, _ = client([delta("I checked the calendar; the event is created."), completed()],
                      backend=backend)
    try:
        text = await turn(model, [ModelMessage("user", "Is the calendar event created?")])
        assert "I checked" not in text and "event is created" not in text
        assert "Reply yes" not in text
        assert (SUMMARY in text) == (pending is not None)
        assert backend.calendar_calls == ["calendar_get_pending_change"]
    finally:
        await model.close()


async def test_actual_read_renders_only_returned_events_not_provisional_success():
    backend = CalendarBackend()
    model, _ = client([], backend=backend, rounds=[[
        delta("I created the event."), completed(tool_call("calendar_list_events")),
    ], [delta("The event exists and was created."), completed()]])
    try:
        text = await turn(model, [ModelMessage("user", "Check my calendar")])
        assert text == "The calendar read returned no events."
        assert "calendar_list_events" in backend.calendar_calls
    finally:
        await model.close()


def test_success_requires_confirmation_tool_and_pending_requires_code():
    assert pending_calendar({
        "outcome": "ok", "result": {"status": "awaiting_confirmation"}
    }) is None
    text = calendar_reply("calendar_confirm_change", {"outcome": "ok", "result": {
        "status": "completed", "detail": "The event was created."}}, False)
    assert text == "The calendar change is done."


def test_successful_batch_confirmation_withholds_details_unless_requested():
    result = {
        "status": "completed",
        "summary": "Create 2 calendar events: " + " | ".join(BATCH_SUMMARIES),
        "detail": "2 of 2 calendar events were created.",
        "items": [{"summary": summary, "status": "completed", "detail": "created"}
                  for summary in BATCH_SUMMARIES],
    }
    evidence = {"outcome": "ok", "result": result}
    assert calendar_reply(
        "calendar_confirm_change", evidence, False
    ) == "Both are in your calendar."
    assert calendar_reply(
        "calendar_confirm_change", evidence, True
    ) == "Begge er i kalenderen."
    spoken_on_request = calendar_reply(
        "calendar_confirm_change", evidence, False, include_details=True
    )
    assert all(summary in spoken_on_request for summary in BATCH_SUMMARIES)
    assert calendar_details_requested("What time was that?")
    assert calendar_details_requested("Read them to me")
    assert calendar_details_requested("Læs dem op")
    assert not calendar_details_requested("Thanks")


async def test_calendar_read_can_be_followed_by_staging_in_the_same_turn():
    backend = CalendarBackend()
    model, _ = client([], backend=backend, rounds=[
        [completed(tool_call("calendar_list_events"))],
        [delta("I created it already."), completed(tool_call("calendar_create_event"))],
    ])
    try:
        text = await turn(model, [ModelMessage("user", "Find and add my calendar reservation")])
        assert SUMMARY in text and "Nothing has changed" in text
        assert "created it already" not in text
        assert backend.calendar_calls == ["calendar_get_pending_change", "calendar_list_events",
                                          "calendar_create_event"]
    finally:
        await model.close()


async def test_calendar_clarification_can_ask_for_dates_without_claiming_staging():
    backend = CalendarBackend()
    model, _ = client([delta("What dates should I use for the calendar reservation?"), completed()],
                      backend=backend)
    try:
        text = await turn(model, [ModelMessage("user", "Add my calendar reservation")])
        assert text == "What dates should I use for the calendar reservation?"
        assert backend.calendar_calls == ["calendar_get_pending_change"]
    finally:
        await model.close()


async def test_new_request_cannot_claim_staging_or_checking_without_any_mutation_or_read():
    backend = CalendarBackend()
    model, _ = client([delta("I checked the calendar and staged the event. Reply yes."),
                       completed()], backend=backend)
    try:
        text = await turn(model, [ModelMessage("user", "Add my Synthetic Hotel Beta reservation")])
        assert "Reply yes" not in text and "I checked" not in text
        assert "no pending calendar change" in text
        assert backend.calendar_calls == ["calendar_get_pending_change"]
    finally:
        await model.close()


@pytest.mark.parametrize("code", [None, "invalid"])
async def test_successful_staging_envelope_without_valid_code_cannot_start_approval_flow(code):
    backend = CalendarBackend()
    backend.stage_result = {"status": "awaiting_confirmation", "summary": SUMMARY}
    if code is not None:
        backend.stage_result["confirmationCode"] = code
    model, _ = client([], backend=backend, rounds=[[
        completed(tool_call("calendar_create_event")),
    ]])
    try:
        text = await turn(model, [ModelMessage("user", "Add my calendar reservation")])
        assert SUMMARY not in text and "Reply yes" not in text
        backend.reply = "approve"
        repeated = await turn(model, [ModelMessage("assistant", text),
                                     ModelMessage("user", "yes")], "43")
        assert "Reply yes" not in repeated
        assert "calendar_confirm_change" not in backend.calendar_calls
    finally:
        await model.close()


async def test_reading_a_reservation_email_does_not_become_a_calendar_approval_turn():
    backend = CalendarBackend()
    model, _ = client([], backend=backend, rounds=[
        [completed(tool_call("mail_search"))],
        [delta("The direct email result contains booking details."), completed()],
    ])
    try:
        text = await turn(model, [ModelMessage("user", "Find my hotel reservation email")])
        assert text == "The direct email result contains booking details."
        assert backend.calendar_calls == []
        assert any(r.url.path.endswith("/mail_search") for r in backend.requests)
    finally:
        await model.close()


async def test_a_new_unrelated_request_is_not_overridden_by_previous_calendar_context():
    backend = CalendarBackend(pending=PENDING)
    model, _ = client([delta("Here is the weather answer."), completed()], backend=backend)
    try:
        text = await turn(model, [
            ModelMessage("assistant", "Pending calendar approval: " + SUMMARY),
            ModelMessage("user", "Tell me about the weather"),
        ])
        assert text == "Here is the weather answer."
        assert "calendar_confirm_change" not in backend.calendar_calls
    finally:
        await model.close()


@pytest.mark.parametrize("pending", [None, PENDING])
@pytest.mark.parametrize("earlier_calendar", [False, True])
async def test_gmail_staging_prose_cannot_route_yes_to_an_older_calendar(pending, earlier_calendar):
    backend = CalendarBackend(pending=pending)
    backend.reply = "approve"
    model, _ = client([], backend=backend, rounds=[
        [completed(FakeItem(type="function_call", name="mail_confirm_action",
                            arguments='{"confirmationCode":"87654321"}', call_id="mail-call"))],
        [delta("The Gmail reply draft was saved."), completed()],
    ])
    history = ([ModelMessage("assistant", "Pending calendar approval: " + SUMMARY)]
               if earlier_calendar else [])
    history += [
        ModelMessage("assistant", "I staged the Gmail reply draft to guest@example.test. "
                     "Reply yes to save it."),
        ModelMessage("user", "yes"),
    ]
    try:
        assert await turn(model, history, "43") == "The Gmail reply draft was saved."
        assert backend.calendar_calls == []
        assert any(r.url.path.endswith("/mail_confirm_action") for r in backend.requests)
        assert backend.pending == pending
    finally:
        await model.close()


@pytest.mark.parametrize("pending", [None, PENDING])
@pytest.mark.parametrize("question", [
    "Is it raining tomorrow?", "Did you find my reservation email?",
    "Have you checked the build status?", "Is Gmail working now?",
])
async def test_unrelated_status_question_never_relays_or_confirms_stale_calendar(pending, question):
    backend = CalendarBackend(pending=pending)
    answer = "The answer concerns only the current request."
    model, _ = client([delta(answer), completed()], backend=backend)
    try:
        assert await turn(model, [
            ModelMessage("assistant", "Pending calendar approval: " + SUMMARY),
            ModelMessage("user", question),
        ]) == answer
        assert "calendar_confirm_change" not in backend.calendar_calls
        assert "calendar_create_event" not in backend.calendar_calls
        assert backend.pending == pending
    finally:
        await model.close()


@pytest.mark.parametrize("question", [
    "Is it created?", "Did you create it?", "Er den oprettet?", "Is the appointment created?",
])
async def test_genuine_calendar_status_still_recovers_receipt_without_confirming(question):
    backend = CalendarBackend(pending=PENDING)
    model, _ = client([delta("I created it."), completed()], backend=backend)
    try:
        text = await turn(model, [
            ModelMessage("assistant", "Pending calendar approval: " + SUMMARY),
            ModelMessage("user", question),
        ])
        assert SUMMARY in text and "I created it." not in text
        assert backend.calendar_calls == ["calendar_get_pending_change"]
    finally:
        await model.close()


@pytest.mark.parametrize("voice", [False, True])
@pytest.mark.parametrize("pending", [None, PENDING])
async def test_actual_dentist_mail_receipt_approval_cannot_confirm_calendar(pending, voice):
    backend = CalendarBackend(pending=pending)
    backend.reply = "approve"
    model, transport = client([], backend=backend, rounds=[
        [completed(FakeItem(type="function_call", name="mail_confirm_action",
                            arguments='{"confirmationCode":"87654321"}', call_id="mail-call"))],
        [delta("The Gmail reply draft was saved."), completed()],
    ])
    history = ([ModelMessage("assistant", "Pending calendar approval: " + SUMMARY)]
               if pending is not None else [])
    history += [ModelMessage("assistant", "Pending approval: " + MAIL_SUMMARY),
                ModelMessage("user", "yes")]
    try:
        assert await turn(model, history, "43", voice=voice) == "The Gmail reply draft was saved."
        assert backend.calendar_calls == []
        assert backend.pending == pending
        assert any(r.url.path.endswith("/mail_confirm_action") for r in backend.requests)
        assert len(transport.responses.requests) == 2
    finally:
        await model.close()


@pytest.mark.parametrize("pending", [None, PENDING])
@pytest.mark.parametrize("question", [
    "Find my dentist appointment confirmation email",
    "Find my hotel reservation email",
    'Find the email titled "Calendar appointment"',
])
async def test_mail_read_topics_are_not_calendar_intent(pending, question):
    backend = CalendarBackend(pending=pending)
    model, transport = client([], backend=backend, rounds=[
        [completed(tool_call("mail_search"))],
        [delta("The independent mail answer."), completed()],
    ])
    try:
        assert await turn(model, [
            ModelMessage("assistant", "Pending calendar approval: " + SUMMARY),
            ModelMessage("user", question),
        ]) == "The independent mail answer."
        assert backend.calendar_calls == []
        assert backend.pending == pending
        assert any(r.url.path.endswith("/mail_search") for r in backend.requests)
        assert len(transport.responses.requests) == 2
    finally:
        await model.close()


@pytest.mark.parametrize("question", [
    "Schedule my dentist appointment",
    "Add this appointment confirmation email to my calendar",
    "Tilføj min aftalemail til min kalender",
])
async def test_explicit_calendar_mutation_intent_is_preserved(question):
    backend = CalendarBackend()
    model, _ = client([], backend=backend, rounds=[[
        completed(tool_call("calendar_create_event")),
    ]])
    try:
        assert SUMMARY in await turn(model, [ModelMessage("user", question)])
        assert backend.calendar_calls == ["calendar_get_pending_change", "calendar_create_event"]
    finally:
        await model.close()


@pytest.mark.parametrize(("question", "answer"), [
    ("I have 3 hotel bookings before 20 Dec 2027, can",
     "Would you like me to find those hotel bookings or add them to your calendar?"),
    ("Why did you not create both?",
     "I handled only the first approval. "
     "The second booking still needs its own calendar approval."),
    ("Is this a default respons? You are not answering my question?",
     "You're right. That repeated calendar reply did not answer your question."),
    ("Are you broken?",
     "My calendar reply guard is repeating a fallback instead of answering you."),
    ("Can you explain how calendar approvals work?",
     "Each calendar change needs a later approval. Preparing one is not the same as creating it."),
    ("Can you explain how calendar approvals work?",
     '"Pending calendar approval:" is a proposal label, not proof that an event exists.'),
    ("Add my calendar reservation",
     "I cannot create it without the dates. Please provide the check-in and check-out times."),
    ("Check my calendar",
     "I haven't checked your calendar because the tool is unavailable."),
    ("Check my calendar",
     "No calendar event has been created or checked."),
])
@pytest.mark.parametrize("prior_fallback", [False, True])
async def test_calendar_topics_explanations_and_incomplete_requests_are_not_completion_claims(
    question, answer, prior_fallback,
):
    backend = CalendarBackend()
    model, _ = client([delta(answer), completed()], backend=backend)
    history = [ModelMessage("assistant", (
        "I have no verified calendar result. I cannot say the change is staged or completed, "
        "or that I checked the calendar."
    ))] if prior_fallback else []
    try:
        assert await turn(model, [*history, ModelMessage("user", question)]) == answer
        assert "calendar_confirm_change" not in backend.calendar_calls
    finally:
        await model.close()


async def test_general_tool_failure_is_not_swallowed_by_calendar_topic():
    backend = CalendarBackend()
    model, _ = client([], backend=backend, rounds=[
        [completed(tool_call("get_system_health"))],
        [delta("My health check failed; I cannot diagnose the calendar issue from it."),
         completed()],
    ])
    try:
        assert await turn(model, [
            ModelMessage("assistant", "I have no verified calendar result."),
            ModelMessage("user", "Are you broken?"),
        ]) == "My health check failed; I cannot diagnose the calendar issue from it."
        assert "calendar_confirm_change" not in backend.calendar_calls
    finally:
        await model.close()


async def test_calendar_read_does_not_swallow_a_later_explicit_tool_error():
    backend = CalendarBackend()
    answer = "The calendar lookup returned no events, but my system-health check failed."
    model, _ = client([], backend=backend, rounds=[
        [completed(tool_call("calendar_list_events"))],
        [completed(tool_call("get_system_health"))],
        [delta(answer), completed()],
    ])
    try:
        assert await turn(model, [
            ModelMessage("user", "Check my calendar and system health"),
        ]) == answer
    finally:
        await model.close()


async def test_a_successful_unrelated_action_is_not_reclassified_by_old_calendar_context():
    backend = CalendarBackend()
    model, _ = client([], backend=backend, rounds=[
        [completed(tool_call("create_task"))],
        [delta("I created the coding task."), completed()],
    ])
    try:
        assert await turn(model, [
            ModelMessage("assistant", "Pending calendar approval: " + SUMMARY),
            ModelMessage("user", "Create the coding task"),
        ]) == "I created the coding task."
    finally:
        await model.close()


@pytest.mark.parametrize("answer", [
    "I checked your calendar and created both events.",
    "Both events are staged. Reply yes to approve.",
    "Your calendar events have been added.",
    "The calendar change is ready for your approval.",
    "Done - both hotel bookings are in your calendar.",
    "Pending calendar approval: Create two calendar events.",
    "Afventer kalendergodkendelse: Opret to kalenderbegivenheder.",
    "I've put both in your calendar.",
])
@pytest.mark.parametrize("pending_tool_available", [False, True])
@pytest.mark.parametrize("provider", ["openai", "anthropic"])
async def test_unsupported_completion_claims_are_blocked_even_without_recovery_tool(
    answer, pending_tool_available, provider,
):
    backend = CalendarBackend()
    if not pending_tool_available:
        backend.catalogue = []
    model, _ = provider_client(provider, backend, [[delta(answer), completed()]])
    try:
        text = await turn(model, [ModelMessage("user", "Add both bookings to my calendar")])
        assert text != answer
        assert "Reply yes" not in text and "ready for your approval" not in text
        assert "Pending calendar approval:" not in text
        assert "Afventer kalendergodkendelse:" not in text
        assert not any(name == "calendar_confirm_change" for name in backend.calendar_calls)
    finally:
        await model.close()


def batch_call():
    return FakeItem(type="function_call", name="calendar_create_events",
                    arguments=json.dumps({"events": HOTEL_EVENTS}), call_id="both-hotels")


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
async def test_uncertain_combined_calendar_retry_with_new_ids_does_not_dispatch_batch_again(
    provider,
):
    backend = UncertainCalendarBatchBackend()
    initial_calls = [
        FakeItem(
            type="function_call", name="calendar_create_event", call_id=f"initial-{index}",
            arguments=json.dumps(event),
        )
        for index, event in enumerate(HOTEL_EVENTS)
    ]
    retry_calls = [
        FakeItem(
            type="function_call", name="calendar_create_event", call_id=f"retry-{index}",
            arguments=json.dumps(event),
        )
        for index, event in enumerate(HOTEL_EVENTS)
    ]
    model, transport = provider_client(provider, backend, [
        [completed(*initial_calls)],
        [completed(*retry_calls)],
        [delta("The calendar result remains uncertain."), completed()],
    ])
    history = [
        ModelMessage("user", "Add both hotel bookings to my calendar", source_message_id="20"),
        ModelMessage("assistant", "Synthetic Hotel Alpha and Synthetic Hotel Beta."),
        ModelMessage("user", "Add those two.", source_message_id="42"),
    ]
    try:
        reply = await turn(model, history)
        assert backend.batch_attempts == 1
        assert "uncertain" in reply.lower()
        assert "created" not in reply.lower()

        requests = (
            model._anthropic_client.messages.requests if provider == "anthropic"
            else transport.responses.requests
        )
        assert len(requests) == 3

        def results_for(request, call_ids):
            if provider == "anthropic":
                return {
                    item["tool_use_id"]: json.loads(item["content"])
                    for message in request["messages"]
                    if message["role"] == "user" and isinstance(message["content"], list)
                    for item in message["content"]
                    if item.get("type") == "tool_result"
                    and item["tool_use_id"] in call_ids
                }
            return {
                item["call_id"]: json.loads(item["output"])
                for item in request["input"]
                if item.get("type") == "function_call_output"
                and item["call_id"] in call_ids
            }

        for continuation_index, call_ids in [
            (1, {"initial-0", "initial-1"}),
            (2, {"retry-0", "retry-1"}),
        ]:
            result_by_call = results_for(requests[continuation_index], call_ids)
            assert set(result_by_call) == call_ids
            assert all(result["outcome"] == "error" for result in result_by_call.values())
            assert all(
                result["result"] == {"error": "Calendar provider outcome is uncertain."}
                for result in result_by_call.values()
            )
    finally:
        await model.close()


@pytest.mark.parametrize(("text", "multiple"), [
    ("Ad those 2 to my calendar", True),
    ("Can you please put both hotel bookings on my calendar?", True),
    ("Add three hotel bookings to my calendar", True),
    ("Add two to my calendar", True),
    ("Tilføj to begivenheder til min kalender", True),
    ("Add a calendar event on 9 December 2027", False),
    ("Create an all-day calendar event on 10 December 2027", False),
    ("Add those to my calendar.", False),
    ("Tilføj kalenderbegivenheden den 9 december 2027.", False),
    ('Tilføj "de to" til min kalender.', False),
    ("Add this hotel booking to my calendar", False),
    ('Add "Both hotels" to my calendar', False),
    ("Why did you not create both calendar events?", False),
    ("Add those two.", False),
])
def test_multiple_creation_routing_uses_quantities_not_calendar_dates(text, multiple):
    assert calendar_multiple_requested([ModelMessage("user", text)]) is multiple


@pytest.mark.parametrize(("context", "request_text", "multiple"), [
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", "Add those two.", True),
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", "Tilføj de to.", True),
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", "Tilføj disse to.", True),
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", "Tilføj de to til mine notater.", False),
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", "Tilføj disse to til min mail.", False),
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", "Add those two to my notes.", False),
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", "Add both to the email draft.", False),
    ("Here are the two Notes entries.", "Add those two.", False),
    ("Here are the two Gmail drafts.", "Add those two.", False),
    ("Her er de to Notes-notater.", "Tilføj de to.", False),
    ("Her er de to Gmail-kladder.", "Tilføj disse to.", False),
    ("Here are the two Notes entries.", "Add those two notes to my calendar.", True),
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", 'Add "Both hotels".', False),
])
def test_contextual_quantity_routing_keeps_other_workflows_separate(
    context, request_text, multiple,
):
    history = [
        ModelMessage("user", "Add both hotel bookings to my calendar", source_message_id="20"),
        ModelMessage("assistant", context),
        ModelMessage("user", request_text, source_message_id="42"),
    ]
    assert calendar_multiple_requested(history) is multiple


@pytest.mark.parametrize("text", [
    "Have you put both in my calendar?",
    "I have not put either in your calendar.",
    "I haven't put either in your calendar.",
    "If I have put both in your calendar, the tool result will show it.",
])
def test_put_claim_policy_preserves_questions_negatives_and_conditions(text):
    assert not calendar_claim(text)


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("reply", ["yes", "cancel"])
@pytest.mark.parametrize("request_text", ["Add those two.", "Tilføj de to.", "Tilføj disse to."])
async def test_contextual_two_hotel_request_refuses_single_then_uses_bound_batch_reply(
    provider, reply, request_text,
):
    backend = CalendarBatchBackend()
    model, _ = provider_client(provider, backend, [
        [completed(tool_call("calendar_create_event"))], [completed(batch_call())],
    ])
    history = [
        ModelMessage("user", "Add both hotel bookings to my calendar", source_message_id="20"),
        ModelMessage("assistant", "Synthetic Hotel Alpha and Synthetic Hotel Beta."),
        ModelMessage("user", request_text, source_message_id="42"),
    ]
    try:
        staged = await turn(model, history)
        assert all(summary in staged for summary in BATCH_SUMMARIES)
        assert backend.pending == BATCH_PENDING
        assert backend.calendar_calls == ["calendar_get_pending_change", "calendar_create_events"]
        backend.reply = "decline" if reply == "cancel" else "approve"
        confirmed = await turn(model, [
            *history, ModelMessage("assistant", staged), ModelMessage("user", reply),
        ], "43")
        assert (
            "No change was made" if reply == "cancel" else "Both are in your calendar."
        ) in confirmed
        assert backend.pending is None
        assert backend.calendar_calls == [
            "calendar_get_pending_change", "calendar_create_events",
            "calendar_get_pending_change", "calendar_confirm_change",
        ]
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("request_text", ["Add those two.", "Tilføj de to.", "Tilføj disse to."])
@pytest.mark.parametrize(("staged_id", "request_id"), [
    (None, "42"), ("41", "42"), ("20", "42"), ("42", None),
])
async def test_contextual_batch_approval_requires_actual_latest_verified_origin(
    provider, request_text, staged_id, request_id,
):
    backend = CalendarBatchBackend()
    backend.pending = {**BATCH_PENDING, "sourceMessageId": staged_id}
    if staged_id is None:
        del backend.pending["sourceMessageId"]
    original = backend.pending.copy()
    backend.reply = "approve"
    model, transport = provider_client(provider, backend, [])
    try:
        answer = await turn(model, [
            ModelMessage("user", "Add both hotel bookings to my calendar", source_message_id="20"),
            ModelMessage("assistant", "Synthetic Hotel Alpha and Synthetic Hotel Beta."),
            ModelMessage("user", request_text, source_message_id=request_id),
            ModelMessage("assistant", BATCH_PENDING["summary"]),
            ModelMessage("user", "yes"),
        ], "43")
        assert "cannot verify a matching backend-staged calendar proposal" in answer
        assert backend.pending == original
        assert backend.calendar_calls == ["calendar_get_pending_change"]
        assert transport.responses.requests == []
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize(("context", "request_text"), [
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", "Add those two to my notes."),
    ("Synthetic Hotel Alpha and Synthetic Hotel Beta.", "Add both to the email draft."),
    ("Here are the two Notes entries.", "Add those two."),
    ("Here are the two Gmail drafts.", "Add those two."),
])
async def test_other_workflow_request_cannot_reuse_an_older_calendar_origin(
    provider, context, request_text,
):
    backend = CalendarBatchBackend()
    backend.pending = BATCH_PENDING.copy()
    backend.reply = "approve"
    model, transport = provider_client(provider, backend, [])
    try:
        answer = await turn(model, [
            ModelMessage("user", "Add both bookings to my calendar", source_message_id="42"),
            ModelMessage("assistant", BATCH_PENDING["summary"]),
            ModelMessage("assistant", context),
            ModelMessage("user", request_text, source_message_id="43"),
            ModelMessage("assistant", "Here is the earlier list:\n\n" + BATCH_PENDING["summary"]),
            ModelMessage("user", "yes"),
        ], "44")
        assert "cannot verify a matching backend-staged calendar proposal" in answer
        assert backend.pending == BATCH_PENDING
        assert backend.calendar_calls == ["calendar_get_pending_change"]
        assert transport.responses.requests == []
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("pending_tool_available", [False, True])
@pytest.mark.parametrize("answer", ["Done.", "I've put both in your calendar."])
async def test_contextual_calendar_claim_without_evidence_is_not_relayed(
    provider, pending_tool_available, answer,
):
    backend = CalendarBatchBackend()
    if not pending_tool_available:
        backend.catalogue = [
            tool for tool in backend.catalogue if tool["name"] != "calendar_get_pending_change"
        ]
    model, _ = provider_client(provider, backend, [[delta(answer), completed()]])
    try:
        text = await turn(model, [
            ModelMessage("user", "Add both hotel bookings to my calendar", source_message_id="20"),
            ModelMessage("assistant", "Synthetic Hotel Alpha and Synthetic Hotel Beta."),
            ModelMessage("user", "Add those two.", source_message_id="42"),
        ])
        assert answer not in text
        assert (
            "There is no pending calendar change" if pending_tool_available
            else "no verified calendar result"
        ) in text
        assert backend.pending is None
        assert "calendar_create_events" not in backend.calendar_calls
        assert "calendar_confirm_change" not in backend.calendar_calls
    finally:
        await model.close()


@pytest.mark.parametrize("partial", [False, True])
async def test_both_hotels_survive_one_later_approval_and_repeated_yes_without_replaying(partial):
    backend = CalendarBatchBackend(partial=partial)
    model, transport = client([], backend=backend, rounds=[[
        delta("Both events are already created."), completed(batch_call()),
    ]])
    history = [
        ModelMessage("assistant", "Synthetic Hotel Alpha: 14–15 June 2027, 15:00–11:00. "
                     "Synthetic Hotel Beta: 9–10 December 2027, 16:00–12:00. "
                     "Both use Europe/Copenhagen local time."),
        ModelMessage("user", "Ad those 2 to my calendar", source_message_id="42"),
    ]
    try:
        staged = await turn(model, history)
        assert all(summary in staged for summary in BATCH_SUMMARIES)
        assert "Do you want me to create all 2 listed events" in staged
        assert "already created" not in staged
        assert backend.calendar_calls == ["calendar_get_pending_change", "calendar_create_events"]
        backend.reply = "approve"
        confirmed = await turn(model, [
            *history, ModelMessage("assistant", staged), ModelMessage("user", "Approved"),
        ], "43")
        if partial:
            assert "1 of 2" in confirmed and BATCH_SUMMARIES[1] in confirmed
            assert BATCH_SUMMARIES[0] not in confirmed
            assert "unverified" in confirmed
        else:
            assert confirmed == "Both are in your calendar."
            assert all(summary not in confirmed for summary in BATCH_SUMMARIES)
        repeated = await turn(model, [
            *history, ModelMessage("assistant", confirmed), ModelMessage("user", "yes"),
        ], "44")
        assert "There is no pending calendar change" in repeated
        assert "Last recorded result" in repeated
        assert "Reply yes" not in repeated
        assert backend.calendar_calls.count("calendar_confirm_change") == 1
        assert backend.calendar_calls.count("calendar_create_events") == 1
        assert len(transport.responses.requests) == 1
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("invalid", [False, True])
async def test_two_proposed_single_events_are_coalesced_and_validated_before_staging(
    provider, invalid,
):
    class ValidatedBatchBackend(CalendarBatchBackend):
        def handle(self, request):
            if request.url.path.endswith("/calendar_create_events"):
                events = json.loads(request.content)["events"]
                if any("endDateTime" not in event for event in events):
                    self.requests.append(request)
                    return httpx.Response(200, json={
                        "outcome": "refused", "result": {"refused": "Missing second endDateTime."},
                    })
            return super().handle(request)

    backend = ValidatedBatchBackend()
    events = [dict(event) for event in HOTEL_EVENTS]
    if invalid:
        del events[1]["endDateTime"]
    calls = [
        FakeItem(type="function_call", name="calendar_create_event",
                 arguments=json.dumps(event), call_id=f"hotel-{index}")
        for index, event in enumerate(events)
    ]
    model, _ = provider_client(provider, backend, [[completed(*calls)]])
    try:
        staged = await turn(model, [ModelMessage("user", "Add both bookings to my calendar")])
        if invalid:
            assert "Missing second endDateTime" in staged
            assert backend.pending is None
            assert "Pending calendar approval" not in staged
        else:
            assert all(summary in staged for summary in BATCH_SUMMARIES)
        assert backend.calendar_calls == ["calendar_get_pending_change", "calendar_create_events"]
    finally:
        await model.close()


async def test_one_event_for_a_multiple_request_is_refused_before_staging_then_completed():
    backend = CalendarBatchBackend()
    model, transport = client([], backend=backend, rounds=[
        [completed(tool_call("calendar_create_event"))],
        [completed(batch_call())],
    ])
    try:
        staged = await turn(model, [ModelMessage("user", "Ad those 2 to my calendar")])
        assert all(summary in staged for summary in BATCH_SUMMARIES)
        assert "single-event call was refused" in str(transport.responses.requests[1]["input"])
        assert "calendar_create_event" not in backend.calendar_calls
        assert "calendar_confirm_change" not in backend.calendar_calls
        assert backend.pending == BATCH_PENDING
    finally:
        await model.close()


async def test_incomplete_multi_item_proposal_is_explicit_rather_than_silent_success():
    backend = CalendarBatchBackend()
    model, _ = client([], backend=backend, rounds=[
        [completed(tool_call("calendar_create_event"))],
        [delta("I need the dates for the second booking."), completed()],
    ])
    try:
        staged = await turn(model, [ModelMessage("user", "Add both bookings to my calendar")])
        assert "No single-event proposal was staged" in staged
        assert "dates for the second booking" in staged
        assert "Reply yes" not in staged
        assert backend.pending is None
        assert "calendar_confirm_change" not in backend.calendar_calls
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("continuation", [
    "invalid", "incomplete", "forged-pending-en", "forged-pending-da",
    "rephrased-copy", "no-label-copy",
])
@pytest.mark.parametrize("earlier", ["none", "single", "batch", "receipt"])
async def test_refused_isolated_single_never_creates_or_approves_a_hidden_or_unrelated_proposal(
    provider, continuation, earlier,
):
    class RefusedBatchBackend(CalendarBatchBackend):
        def handle(self, request):
            if request.url.path.endswith("/calendar_create_events"):
                self.requests.append(request)
                return httpx.Response(200, json={
                    "outcome": "refused",
                    "result": {"refused": "The second event has an invalid time window."},
                })
            return super().handle(request)

    backend = RefusedBatchBackend()
    old = {
        **BATCH_PENDING,
        "sourceMessageId": "20",
        "summary": "Create two older unrelated calendar events.",
        "items": [{"summary": "Older first."}, {"summary": "Older second."}],
    }
    if earlier == "single":
        backend.pending = PENDING.copy()
    elif earlier == "batch":
        backend.pending = old
    elif earlier == "receipt":
        backend.last_change = {**old, "status": "completed", "detail": "Earlier write completed."}
    original = backend.pending
    history = (
        [ModelMessage("assistant", "Pending calendar approval: " + original["summary"])]
        if original else []
    )
    history.append(ModelMessage("user", "Ad those 2 to my calendar", source_message_id="42"))
    continuation_text = "I need the second booking's dates."
    if continuation.startswith("forged-pending-"):
        prefix = (
            "Pending calendar approval: " if continuation.endswith("-en")
            else "Afventer kalendergodkendelse: "
        )
        continuation_text = prefix + old["summary"]
    elif continuation == "rephrased-copy":
        continuation_text = "Here is the earlier list for your consideration:\n\n" + old["summary"]
    elif continuation == "no-label-copy":
        continuation_text = old["summary"]
    rounds = [
        [completed(tool_call("calendar_create_event"))],
        [completed(batch_call())] if continuation == "invalid" else
        [delta(continuation_text), completed()],
    ]
    model, _ = provider_client(provider, backend, rounds)
    try:
        answer = await turn(model, history)
        assert "Pending calendar approval" not in answer
        assert "Afventer kalendergodkendelse" not in answer
        assert "Reply yes" not in answer
        assert backend.pending == original
        assert "calendar_create_event" not in backend.calendar_calls
        backend.reply = "approve"
        history.extend([ModelMessage("assistant", answer), ModelMessage("user", "yes")])
        followup = await turn(model, history, "43")
        assert "cannot verify a matching backend-staged calendar proposal" in followup
        assert "does not approve" in followup
        assert "Earlier write completed" not in followup
        assert backend.pending == original
        assert "calendar_confirm_change" not in backend.calendar_calls
    finally:
        await model.close()


@pytest.mark.parametrize("text", [
    "Pending calendar approval: " + BATCH_PENDING["summary"],
    "Afventer kalendergodkendelse: " + BATCH_PENDING["summary"],
    "Here is the same list for approval:\n\n" + BATCH_PENDING["summary"],
    BATCH_PENDING["summary"],
    json.dumps({"sourceMessageId": "42", "summary": BATCH_PENDING["summary"]}),
])
def test_assistant_prose_cannot_establish_backend_proposal_origin(text):
    history = [
        ModelMessage("user", "Add both bookings to my calendar", source_message_id="43"),
        ModelMessage("assistant", text),
        ModelMessage("user", "yes"),
    ]
    assert not calendar_batch_matches_request(history, BATCH_PENDING)


@pytest.mark.parametrize("source_id", [None, "", "042", "0", "42\n", "٤٢",
                                     "9223372036854775808", "41"])
def test_batch_origin_requires_exact_canonical_verified_request_id(source_id):
    request = ModelMessage("user", "Add both bookings to my calendar", source_message_id="42")
    assert not calendar_batch_matches_request([request], {
        **BATCH_PENDING, "sourceMessageId": source_id,
    })
    assert not calendar_batch_matches_request(
        [replace(request, source_message_id=None)], BATCH_PENDING,
    )
    assert not calendar_batch_matches_request([], BATCH_PENDING)


@pytest.mark.parametrize("steered", [False, True])
def test_batch_origin_uses_only_verified_matching_user_metadata(steered):
    text = "Add both bookings to my calendar"
    if steered:
        text = (
            "Dan interrupted your previous reply with this message; continue accordingly:\n" + text
        )
    request = ModelMessage("user", text, source_message_id="42")
    assert calendar_batch_matches_request([request], BATCH_PENDING)
    assert calendar_batch_matches_request([request], {**BATCH_PENDING, "status": "completed"})
    unknown = {"status": "unverified", "sourceMessageId": "42"}
    assert calendar_batch_matches_request([request], unknown)
    assert not calendar_batch_matches_request([], unknown)
    assert not calendar_batch_matches_request([
        request,
        ModelMessage("user", "Add both other bookings to my calendar", source_message_id="43"),
        ModelMessage("assistant", BATCH_PENDING["summary"]),
    ], BATCH_PENDING)


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
async def test_missing_history_origin_does_not_claim_an_existing_batch_was_never_staged(provider):
    backend = CalendarBatchBackend()
    backend.pending = BATCH_PENDING.copy()
    backend.reply = "approve"
    model, transport = provider_client(provider, backend, [])
    try:
        answer = await turn(model, [
            ModelMessage("user", "Add both bookings to my calendar"),
            ModelMessage("user", "yes"),
        ], "43")
        assert "cannot verify a matching backend-staged calendar proposal" in answer
        assert "I have not staged" not in answer
        assert backend.pending == BATCH_PENDING
        assert backend.calendar_calls == ["calendar_get_pending_change"]
        assert transport.responses.requests == []
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("shape", [
    "two-batches", "batch-then-single", "single-then-batch", "batch-then-confirm",
])
async def test_conflicting_proposals_cannot_leave_a_hidden_stage_with_the_same_source_id(
    provider, shape,
):
    backend = CalendarBatchBackend()
    name = (
        "calendar_create_events" if shape == "two-batches"
        else "calendar_confirm_change" if shape == "batch-then-confirm"
        else "calendar_create_event"
    )
    arguments = (
        {"events": [HOTEL_EVENTS[0], {"subject": "Incomplete second booking"}]}
        if shape == "two-batches"
        else {"confirmationCode": BATCH_PENDING["confirmationCode"]}
        if shape == "batch-then-confirm" else HOTEL_EVENTS[0]
    )
    other = FakeItem(
        type="function_call", name=name, arguments=json.dumps(arguments), call_id="other-proposal",
    )
    calls = [other, batch_call()] if shape == "single-then-batch" else [batch_call(), other]
    model, _ = provider_client(provider, backend, [
        [completed(*calls)], [delta("I need one complete set of booking details."), completed()],
    ])
    history = [
        ModelMessage("user", "Add both bookings to my calendar", source_message_id="42"),
    ]
    try:
        answer = await turn(model, history)
        assert "No calendar proposal was staged" in answer or "No single-event proposal" in answer
        assert "Pending calendar approval" not in answer
        assert backend.pending is None
        assert backend.calendar_calls == ["calendar_get_pending_change"]
        backend.reply = "approve"
        followup = await turn(model, [
            *history, ModelMessage("assistant", answer), ModelMessage("user", "yes"),
        ], "43")
        assert "cannot verify a matching backend-staged calendar proposal" in followup
        assert backend.pending is None
        assert "calendar_confirm_change" not in backend.calendar_calls
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("source_id", ["42", "20", None])
@pytest.mark.parametrize("recovery_available", [False, True])
@pytest.mark.parametrize("batch_tool_available", [False, True])
async def test_model_confirmation_cannot_bypass_backend_proposal_origin(
    provider, source_id, recovery_available, batch_tool_available,
):
    backend = CalendarBatchBackend()
    unavailable = {
        name for name, available in [
            ("calendar_get_pending_change", recovery_available),
            ("calendar_create_events", batch_tool_available),
        ] if not available
    }
    backend.catalogue = [tool for tool in backend.catalogue if tool["name"] not in unavailable]
    backend.pending = {**BATCH_PENDING, "sourceMessageId": source_id}
    backend.reply = "approve"
    call = FakeItem(
        type="function_call", name="calendar_confirm_change", call_id="confirm",
        arguments=json.dumps({"confirmationCode": BATCH_PENDING["confirmationCode"]}),
    )
    model, _ = provider_client(provider, backend, [[completed(call)]])
    try:
        answer = await turn(model, [
            ModelMessage("user", "Add both bookings to my calendar", source_message_id="42"),
            ModelMessage("assistant", "Here is the earlier list:\n\n" + BATCH_PENDING["summary"]),
            ModelMessage("user", (
                "Dan interrupted your previous reply with this message; continue accordingly:\nyes"
            )),
        ], "43")
        if not recovery_available:
            # Without the pending-change tool no origin can be verified, so the model's own
            # confirmation is refused before it reaches the backend.
            assert "No matching backend-staged proposal origin" in answer
            assert "calendar_confirm_change" not in backend.calendar_calls
            assert backend.pending is not None
        elif source_id == "42":
            assert "Both are in your calendar." in answer
            assert backend.calendar_calls.count("calendar_confirm_change") == 1
        else:
            # The backend decided the reply approves, but the stage does not belong to this
            # request, so the up-front probe refuses before anything is confirmed.
            assert "cannot verify a matching backend-staged calendar proposal" in answer
            assert "calendar_confirm_change" not in backend.calendar_calls
            assert backend.pending is not None
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("source_id", ["42", "20", None])
async def test_model_confirmation_after_an_undecided_reply_is_still_origin_bound_and_refused(
    provider, source_id,
):
    backend = CalendarBatchBackend()
    backend.strict_reply = True
    backend.pending = {**BATCH_PENDING, "sourceMessageId": source_id}
    backend.reply = None
    call = FakeItem(
        type="function_call", name="calendar_confirm_change", call_id="confirm",
        arguments=json.dumps({"confirmationCode": BATCH_PENDING["confirmationCode"]}),
    )
    model, _ = provider_client(provider, backend, [[completed(call)]])
    try:
        answer = await turn(model, [
            ModelMessage("user", "Add both bookings to my calendar", source_message_id="42"),
            ModelMessage("assistant", "Here is the earlier list:\n\n" + BATCH_PENDING["summary"]),
            ModelMessage("user", "hmm, let me think about it"),
        ], "43")
        assert backend.pending is not None
        if source_id == "42":
            # The backend, not the model, refused: the reply was not read as approval.
            assert backend.calendar_calls.count("calendar_confirm_change") == 1
            assert answer.startswith("I wasn't sure what you meant.")
            assert "Do you want me to create all 2 listed events" in answer
        else:
            assert "calendar_confirm_change" not in backend.calendar_calls
            assert "No matching backend-staged proposal origin" in answer
    finally:
        await model.close()


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
async def test_steering_preserves_actual_staging_origin_for_later_batch_approval(provider):
    backend = CalendarBatchBackend()
    backend.catalogue.append({
        "name": "get_system_health", "description": "Read synthetic system health.",
        "inputSchema": {"type": "object", "properties": {}},
    })
    model, _ = provider_client(provider, backend, [
        [completed(tool_call("get_system_health"))], [completed(batch_call())],
    ])
    steered = False

    async def fetch_steering():
        nonlocal steered
        if not steered and any(
            request.url.path.endswith("/get_system_health") for request in backend.requests
        ):
            steered = True
            return [("43", "Add both bookings to my calendar", "en")]
        return []

    token = current_steering_fetcher.set(fetch_steering)
    try:
        staged = await turn(model, [ModelMessage("user", "Check system health")])
        assert steered
        assert backend.pending is not None and backend.pending["sourceMessageId"] == "43"
        backend.reply = "approve"
        confirmed = await turn(model, [
            ModelMessage("user", "Check system health", source_message_id="42"),
            ModelMessage("user", "Add both bookings to my calendar", source_message_id="43"),
            ModelMessage("assistant", staged), ModelMessage("user", "yes"),
        ], "44")
        assert "Both are in your calendar." in confirmed
        assert backend.calendar_calls.count("calendar_confirm_change") == 1
    finally:
        current_steering_fetcher.reset(token)
        await model.close()


async def test_batch_cancellation_and_explanation_followups_do_not_restage_or_confirm_again():
    backend = CalendarBatchBackend()
    model, _ = client([], backend=backend, rounds=[
        [completed(batch_call())],
        [delta("I have not created either event. "
               "Your cancellation stopped that calendar proposal."),
         completed()],
    ])
    history = [
        ModelMessage("user", "Add both bookings to my calendar", source_message_id="42"),
    ]
    try:
        staged = await turn(model, history)
        backend.reply = "decline"
        cancelled = await turn(model, [
            *history, ModelMessage("assistant", staged), ModelMessage("user", "no"),
        ], "43")
        assert "No change was made" in cancelled
        assert "cancelled" in cancelled
        backend.reply = None
        explanation = await turn(model, [
            ModelMessage("assistant", cancelled),
            ModelMessage("user", "Why did you not create both?"),
        ], "44")
        assert explanation == (
            "I have not created either event. Your cancellation stopped that calendar proposal."
        )
        assert backend.calendar_calls.count("calendar_confirm_change") == 1
        assert backend.calendar_calls.count("calendar_create_events") == 1
    finally:
        await model.close()


async def test_multiple_single_calls_cannot_overwrite_each_other_on_a_legacy_backend():
    backend = CalendarBackend()
    calls = [
        FakeItem(type="function_call", name="calendar_create_event",
                 arguments=json.dumps(event), call_id=f"hotel-{index}")
        for index, event in enumerate(HOTEL_EVENTS)
    ]
    model, _ = client([], backend=backend, rounds=[[completed(*calls)]])
    try:
        text = await turn(model, [ModelMessage("user", "Add both bookings to my calendar")])
        assert "other requested events are not included in this approval" in text
        assert backend.calendar_calls.count("calendar_create_event") == 1
        assert "calendar_confirm_change" not in backend.calendar_calls
    finally:
        await model.close()


async def test_reported_conversation_completes_both_then_answers_ordinary_followups():
    backend = CalendarBatchBackend()
    booking_list = (
        "1. Synthetic Hotel Alpha: 14 June 2027 at 15:00 to 15 June 2027 at 11:00.\n\n"
        "2. Synthetic Hotel Beta: 09 December 2027 at 16:00 to 10 December 2027 at 12:00.\n\n"
        "Europe/Copenhagen local time."
    )
    replies = [
        "Hello, Dan. What can I help you with?",
        "Would you like me to find those bookings or add them to your calendar?",
        booking_list,
        "Both listed bookings now have recorded results. "
        "Each was part of your one calendar proposal.",
        "That repeated calendar fallback was a bug, not an answer to your question.",
        "My health-check result cannot establish what happened in Google Calendar.",
    ]
    model, _ = client([], backend=backend, rounds=[
        [delta(replies[0]), completed()],
        [delta(replies[1]), completed()],
        [completed(tool_call("mail_search"))],
        [delta(replies[2]), completed()],
        [completed(batch_call())],
        [delta(replies[3]), completed()],
        [delta(replies[4]), completed()],
        [completed(tool_call("get_system_health"))],
        [delta(replies[5]), completed()],
    ])
    history = []
    try:
        questions = [
            "Hey jarvis",
            "I have 3 hotel bookings before 20 Dec 2027, can",
            "Can you check my email for those hotel bookings?",
            "Ad those 2 to my calendar",
            "Approved",
            "Why did you not create both?",
            "Is this a default respons? You are not answering my question?",
            "Are you broken?",
        ]
        answers = []
        for index, question in enumerate(questions):
            backend.reply = "approve" if question == "Approved" else None
            history.append(ModelMessage("user", question, source_message_id=str(42 + index)))
            answer = await turn(model, history, str(42 + index))
            history.append(ModelMessage("assistant", answer))
            answers.append(answer)
        assert answers[:3] == replies[:3]
        assert all(summary in answers[3] for summary in BATCH_SUMMARIES)
        assert answers[4] == "Both are in your calendar."
        assert answers[5:] == replies[3:]
        assert all("I have no verified calendar result" not in answer for answer in answers)
        assert backend.calendar_calls.count("calendar_create_events") == 1
        assert backend.calendar_calls.count("calendar_confirm_change") == 1
    finally:
        await model.close()


# The bridge never reads Dan's words: the backend decides what a reply means and exposes only
# the verdict, so these replies are deliberately not phrases any local pattern could match.
WORD_LIST = re.compile(
    r"\b(yes|approved|confirmed|go ahead|ja|godkendt|bekræftet)\b", re.IGNORECASE,
)


@pytest.mark.parametrize(("reply", "voice", "done"), [
    ("perfect, go for it", False, "The calendar change is done."),
    ("yes please, book both", False, "The calendar change is done."),
    ("looks good, add them", False, "The calendar change is done."),
    ("ja tak, book dem begge", True, "Kalenderændringen er gennemført."),
])
async def test_natural_approval_the_backend_accepted_confirms_without_phrase_matching(
    reply, voice, done,
):
    backend = CalendarBackend(pending=PENDING, strict_reply=True)
    backend.reply = "approve"
    model, transport = client([], backend=backend)
    try:
        text = await turn(model, [
            ModelMessage("assistant", "Pending calendar approval: " + SUMMARY),
            ModelMessage("user", reply),
        ], voice=voice)
        assert done in text and SUMMARY not in text
        assert backend.calendar_calls == ["calendar_get_pending_change", "calendar_confirm_change"]
        assert backend.pending is None
        assert transport.responses.requests == []
    finally:
        await model.close()


@pytest.mark.parametrize("voice", [False, True])
@pytest.mark.parametrize("reply", [
    "hmm, which hotel was that again?", "yes but make it 9", "wait", "nej tak",
])
async def test_reply_the_backend_did_not_read_as_approval_is_never_confirmed_by_the_bridge(
    voice, reply,
):
    backend = CalendarBackend(pending=PENDING, strict_reply=True)
    backend.reply = None
    answer = "That was the Synthetic Hotel Beta booking."
    model, _ = client([delta(answer), completed()], backend=backend)
    try:
        text = await turn(model, [
            ModelMessage("assistant", "Pending calendar approval: " + SUMMARY),
            ModelMessage("user", reply),
        ], voice=voice)
        assert text == answer
        assert "calendar_confirm_change" not in backend.calendar_calls
        assert backend.pending == PENDING
    finally:
        await model.close()


@pytest.mark.parametrize("voice", [False, True])
async def test_undecided_reply_gets_one_natural_question_and_never_a_list_of_words(voice):
    backend = CalendarBackend(pending=PENDING, strict_reply=True)
    call = FakeItem(
        type="function_call", name="calendar_confirm_change", call_id="confirm",
        arguments=json.dumps({"confirmationCode": "12345678"}),
    )
    model, _ = client([], backend=backend, rounds=[[completed(call)]])
    try:
        text = await turn(model, [
            ModelMessage("assistant", "Pending calendar approval: " + SUMMARY),
            ModelMessage("user", "hmm, not sure about the dates"),
        ], voice=voice)
        lead = (
            "Jeg var ikke sikker på, hvad du mente. " if voice
            else "I wasn't sure what you meant. "
        )
        assert text.startswith(lead + ("Afventer" if voice else "Pending"))
        assert SUMMARY in text
        assert ("Intet er ændret." if voice else "Nothing has changed.") in text
        assert text.endswith("?") and text.count("?") == 1
        assert not WORD_LIST.search(text.replace(SUMMARY, ""))
        assert "Ask one short, natural question" not in text
        assert backend.calendar_calls.count("calendar_confirm_change") == 1
        assert backend.pending == PENDING
    finally:
        await model.close()


async def test_refusal_with_nothing_staged_is_reported_as_the_actual_refusal():
    backend = CalendarBackend(pending=None, strict_reply=True)
    call = FakeItem(
        type="function_call", name="calendar_confirm_change", call_id="confirm",
        arguments=json.dumps({"confirmationCode": "12345678"}),
    )
    model, _ = client([], backend=backend, rounds=[[completed(call)]])
    try:
        text = await turn(model, [
            ModelMessage("assistant", "Calendar change is staged."),
            ModelMessage("user", "yes please, book both"),
        ])
        assert text.startswith("I have no verified calendar result.")
        assert "There is no pending change waiting for a reply." in text
        assert "I wasn't sure" not in text and "?" not in text
    finally:
        await model.close()


@pytest.mark.parametrize(("pending", "danish", "question"), [
    (PENDING, False, "Do you want me to make this change?"),
    (PENDING, True, "Vil du have, at jeg udfører ændringen?"),
    (BATCH_PENDING, False,
     "Do you want me to create all 2 listed events, or drop the entire proposal?"),
    (BATCH_PENDING, True,
     "Vil du have, at jeg opretter alle 2 viste begivenheder, eller skal jeg droppe hele "
     "forslaget?"),
])
def test_staging_notice_ends_with_a_natural_question_and_never_prescribes_words(
    pending, danish, question,
):
    envelope = {"outcome": "ok", "result": pending}
    staged = calendar_reply("calendar_create_event", envelope, danish)
    assert staged.endswith(question)
    assert not WORD_LIST.search(staged.replace(pending["summary"], ""))
    status = calendar_reply("calendar_get_pending_change", envelope, danish)
    assert pending["summary"] in status and question not in status


def test_only_a_refused_confirmation_with_a_staged_change_is_marked_unsettled():
    state = {"outcome": "ok", "result": PENDING}
    refused = {"outcome": "refused", "result": {"refused": "No change was made."}}
    marked = calendar_unsettled_confirmation("calendar_confirm_change", refused, state)
    assert marked == {**refused, "stillPending": PENDING}
    assert calendar_unsettled_confirmation("calendar_create_event", refused, state) == refused
    nothing_staged = {"outcome": "ok", "result": {"status": "none"}}
    assert calendar_unsettled_confirmation(
        "calendar_confirm_change", refused, nothing_staged,
    ) == refused
    assert calendar_unsettled_confirmation("calendar_confirm_change", refused, None) == refused
    completed_result = {"outcome": "ok", "result": {"status": "completed", "detail": "Done."}}
    assert calendar_unsettled_confirmation(
        "calendar_confirm_change", completed_result, state,
    ) == completed_result
    failed = {"outcome": "error", "result": {"error": "Provider failed"}}
    assert calendar_unsettled_confirmation("calendar_confirm_change", failed, state) == failed


def test_unsettled_confirmation_is_explained_in_plain_words_without_the_model_instruction():
    refused = calendar_unsettled_confirmation(
        "calendar_confirm_change",
        {"outcome": "refused", "result": {"refused": "No change was made. Ask one question."}},
        {"outcome": "ok", "result": PENDING},
    )
    assert calendar_reply("calendar_confirm_change", refused, False) == (
        "I wasn't sure what you meant. Pending calendar approval: " + SUMMARY
        + " Nothing has changed. Do you want me to make this change?"
    )
    assert "Ask one question" not in calendar_reply("calendar_confirm_change", refused, True)

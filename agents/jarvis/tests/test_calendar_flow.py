"""Regression turns use the real model loop with a synthetic backend and provider."""

import json

import httpx
import pytest
from test_model_client import FakeBackend, FakeItem, client, completed

from calendar_flow import calendar_reply, pending_calendar
from jarvis_tools import current_message_id
from state import ModelMessage

SUMMARY = (
    'Create "Copenhagen Marriott reservation 99210189" from 2026-11-05T15:00:00.000Z '
    'to 2026-11-06T11:00:00.000Z (Europe/Copenhagen); attendees: none.'
)
PENDING = {"status": "awaiting_confirmation", "confirmationCode": "12345678", "summary": SUMMARY}


def delta(text):
    return FakeItem(type="response.output_text.delta", delta=text)


def tool_call(name):
    return FakeItem(type="function_call", name=name, arguments="{}", call_id="call-1")


class CalendarBackend(FakeBackend):
    def __init__(self, pending=None, outcome="ok", fail_confirmation=False):
        super().__init__(catalogue=[
            {"name": name, "description": name, "inputSchema": {"type": "object"}}
            for name in ["calendar_pending_change", "calendar_confirm_change",
                         "calendar_create_event", "calendar_list_events"]
        ])
        self.pending = pending
        self.outcome = outcome
        self.fail_confirmation = fail_confirmation
        self.reply = None

    def handle(self, request):
        name = request.url.path.rsplit("/", 1)[-1]
        if request.method == "POST" and name.startswith("calendar_"):
            self.requests.append(request)
            if name == "calendar_pending_change":
                payload = {**(self.pending or {"status": "none"}), "reply": self.reply}
            elif name == "calendar_create_event":
                self.pending = PENDING.copy() if self.outcome == "ok" else None
                payload = PENDING.copy()
            elif name == "calendar_confirm_change":
                assert json.loads(request.content) == {"confirmationCode": "12345678"}
                self.pending = None  # Consumption happens before provider execution.
                payload = {"status": "completed", "detail": "The event was created.",
                           "summary": SUMMARY}
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


async def turn(model, messages, message_id="42", voice=False):
    token = current_message_id.set(message_id)
    try:
        stream = model.complete(messages) if voice else model.complete_chat(messages, "en")
        return "".join([chunk async for chunk in stream])
    finally:
        current_message_id.reset(token)


@pytest.mark.parametrize("voice", [False, True])
async def test_staging_then_repeated_yes_executes_once_without_restage_or_approval_loop(voice):
    backend = CalendarBackend()
    model, transport = client([], backend=backend, rounds=[[
        delta("I checked the calendar and created it. Say yes again."),
        completed(tool_call("calendar_create_event")),
    ]])
    try:
        staged = await turn(
            model, [ModelMessage("user", "Add my Marriott reservation")], voice=voice
        )
        assert SUMMARY in staged
        assert "12345678" not in staged
        assert "I checked" not in staged and "created it" not in staged
        backend.reply = "approve"
        history = [ModelMessage("assistant", staged), ModelMessage("user", "yes")]
        confirmed = await turn(model, history, "43", voice=voice)
        assert "The event was created." in confirmed and SUMMARY in confirmed
        repeated = await turn(model, [ModelMessage("assistant", confirmed),
                                     ModelMessage("user", "yes")], "44", voice=voice)
        assert "pending calendar change" in repeated or "afventende kalenderændring" in repeated
        assert "Reply yes" not in repeated
        assert backend.calendar_calls.count("calendar_confirm_change") == 1
        assert backend.calendar_calls.count("calendar_create_event") == 1
        assert len(transport.responses.requests) == 1
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
        assert backend.calendar_calls == ["calendar_pending_change"]
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
        assert backend.calendar_calls == ["calendar_pending_change"]
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
    text = calendar_reply("calendar_create_event", {"outcome": "ok", "result": {
        "status": "completed", "detail": "The event was created."}}, False)
    assert "The event was created" not in text


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
        assert backend.calendar_calls == ["calendar_pending_change", "calendar_list_events",
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
        assert backend.calendar_calls == ["calendar_pending_change"]
    finally:
        await model.close()

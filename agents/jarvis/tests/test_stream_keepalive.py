import asyncio
from contextvars import ContextVar

import pytest

from stream_keepalive import with_keepalive


async def test_quiet_work_survives_heartbeats_and_keeps_one_context():
    context = ContextVar("turn", default="outside")
    finish = asyncio.Event()
    closed = asyncio.Event()

    async def source():
        token = context.set("working")
        try:
            yield "acknowledgment"
            await finish.wait()
            assert context.get() == "working"
            yield "final reply"
        finally:
            context.reset(token)
            closed.set()

    stream = with_keepalive(source(), interval_seconds=0.001)
    assert await anext(stream) == "acknowledgment"
    for _ in range(3):
        assert await anext(stream) == ": keepalive\n\n"
    assert not closed.is_set()
    assert context.get() == "outside"
    finish.set()
    assert [frame async for frame in stream if not frame.startswith(":")] == ["final reply"]
    assert closed.is_set()


async def test_closing_response_cancels_and_joins_source():
    closed = asyncio.Event()

    async def source():
        try:
            yield "started"
            await asyncio.Event().wait()
        finally:
            closed.set()

    stream = with_keepalive(source(), interval_seconds=0.001)
    assert await anext(stream) == "started"
    assert await anext(stream) == ": keepalive\n\n"
    await stream.aclose()
    assert closed.is_set()


async def test_drains_frames_before_propagating_failure():
    async def source():
        yield "acknowledgment"
        yield "tool finished"
        raise ValueError("failed")

    stream = with_keepalive(source())
    assert await anext(stream) == "acknowledgment"
    assert await anext(stream) == "tool finished"
    with pytest.raises(ValueError, match="failed"):
        await anext(stream)


async def test_slow_consumer_keeps_production_bounded_and_ordered():
    produced = []

    async def source():
        for index in range(100):
            produced.append(index)
            yield str(index)

    stream = with_keepalive(source())
    assert await anext(stream) == "0"
    await asyncio.sleep(0)
    assert len(produced) <= 10
    assert [frame async for frame in stream] == [str(index) for index in range(1, 100)]

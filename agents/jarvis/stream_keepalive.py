"""Keep a streamed turn connected without putting a time limit on its work."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import aclosing


async def with_keepalive(
    source: AsyncIterator[str], *, interval_seconds: float = 15,
) -> AsyncIterator[str]:
    """Run the whole producer in one context; comments are transport liveness only.

    A bounded queue preserves backpressure. Closing the response cancels/joins its
    producer, including source cleanup; no tool is restarted or replayed here.
    """
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=8)

    async def produce() -> None:
        async with aclosing(source):
            async for frame in source:
                await queue.put(frame)

    producer = asyncio.create_task(produce())
    pending: asyncio.Task[str] | None = None
    try:
        while True:
            if producer.done() and queue.empty():
                await producer
                break
            pending = asyncio.create_task(queue.get())
            while not pending.done():
                done, _ = await asyncio.wait(
                    {pending, producer}, timeout=interval_seconds,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if pending in done:
                    break
                if producer in done:
                    # Drain queued frames first, then propagate a terminal failure.
                    if queue.empty():
                        await producer
                        return
                    await asyncio.sleep(0)
                else:
                    yield ": keepalive\n\n"
            yield pending.result()
            pending = None
    finally:
        if pending is not None:
            pending.cancel()
        producer.cancel()
        await asyncio.gather(producer, *([pending] if pending is not None else []),
                             return_exceptions=True)

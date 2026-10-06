using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class SingleFlightFocusPollerTests
{
    [Fact]
    public async Task Blocking_cancellation_callback_never_blocks_replacement_or_disposal()
    {
        using var poller = new SingleFlightFocusPoller();
        using var callbackEntered = new ManualResetEventSlim();
        using var releaseCallback = new ManualResetEventSlim();
        var pollEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        CancellationTokenRegistration registration = default;
        var replacementRan = false;
        var flight = poller.ReplaceAsync(async token =>
        {
            registration = token.Register(() =>
            {
                callbackEntered.Set();
                releaseCallback.Wait();
            });
            pollEntered.SetResult();
            await Task.Delay(Timeout.Infinite, token);
        });
        await pollEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        try
        {
            await Task.Run(() =>
            {
                Assert.Same(flight, poller.ReplaceAsync(_ =>
                {
                    replacementRan = true;
                    return Task.CompletedTask;
                }));
            }).WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(callbackEntered.Wait(TimeSpan.FromSeconds(5)));
            Assert.False(flight.IsCompleted);
            Assert.False(replacementRan);
            await Task.Run(poller.Dispose).WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(flight.IsCompleted);
        }
        finally { releaseCallback.Set(); }
        await flight.WaitAsync(TimeSpan.FromSeconds(5));
        registration.Dispose();
        Assert.False(replacementRan);
    }

    [Fact]
    public async Task Stalled_native_poll_keeps_the_slot_until_actual_completion()
    {
        using var poller = new SingleFlightFocusPoller();
        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        var replacements = 0;
        var flight = poller.ReplaceAsync(_ =>
        {
            entered.Set();
            release.Wait();
            return Task.CompletedTask;
        });
        Assert.True(entered.Wait(TimeSpan.FromSeconds(5)));
        try
        {
            for (var index = 0; index < 100; index++)
                Assert.Same(flight, poller.ReplaceAsync(_ =>
                {
                    Interlocked.Increment(ref replacements);
                    return Task.CompletedTask;
                }));
            poller.Dispose();
            Assert.False(flight.IsCompleted);
            Assert.Equal(0, replacements);
        }
        finally { release.Set(); }
        await flight.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(0, replacements);
    }

    [Fact]
    public async Task New_launch_cancels_previous_but_never_overlaps_and_keeps_only_latest_pending()
    {
        using var poller = new SingleFlightFocusPoller();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var active = 0;
        var latest = -1;
        var flight = poller.ReplaceAsync(async token =>
        {
            Assert.Equal(1, Interlocked.Increment(ref active));
            using var registration = token.Register(() => cancelled.TrySetResult());
            entered.SetResult();
            await release.Task;
            Interlocked.Decrement(ref active);
        });
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        for (var index = 0; index < 100; index++)
        {
            var requested = index;
            Assert.Same(flight, poller.ReplaceAsync(_ =>
            {
                Assert.Equal(1, Interlocked.Increment(ref active));
                latest = requested;
                Interlocked.Decrement(ref active);
                return Task.CompletedTask;
            }));
        }
        await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(-1, latest);
        release.SetResult();
        await flight.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(99, latest);
        Assert.Equal(0, active);
    }

    [Fact]
    public async Task Disposal_cancels_active_poll_and_drops_pending_work()
    {
        using var poller = new SingleFlightFocusPoller();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var flight = poller.ReplaceAsync(async token =>
        {
            entered.SetResult();
            await Task.Delay(Timeout.Infinite, token);
        });
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        poller.Dispose();
        var invoked = false;
        _ = poller.ReplaceAsync(_ => { invoked = true; return Task.CompletedTask; });
        await flight.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(invoked);
    }

    [Fact]
    public async Task Completed_flights_can_be_restarted_and_cancelled_request_never_polls()
    {
        using var poller = new SingleFlightFocusPoller();
        var calls = 0;
        for (var index = 0; index < 100; index++)
            await poller.ReplaceAsync(_ =>
            {
                Interlocked.Increment(ref calls);
                return Task.CompletedTask;
            }).WaitAsync(TimeSpan.FromSeconds(5));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await poller.ReplaceAsync(_ =>
        {
            Interlocked.Increment(ref calls);
            return Task.CompletedTask;
        }, cancellation.Token).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(100, calls);
    }
}

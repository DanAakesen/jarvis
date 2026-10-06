using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class BoundedCommandWorkerTests : IDisposable
{
    private readonly string _directory = Path.GetFullPath(Path.Combine(".test-diagnostics", Guid.NewGuid().ToString("N")));
    private readonly List<(BoundedCommandWorker Worker, Task Cleanup)> _workers = [];
    private BridgeDiagnostics Diagnostics => new(_directory);

    private BoundedCommandWorker Worker(CommandWorkerOptions? options = null,
        Func<BridgeResourceSample>? sample = null, Action? cleanup = null)
    {
        var cleaned = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new BoundedCommandWorker(Diagnostics, options ?? new()
        {
            CommandTimeout = TimeSpan.FromMilliseconds(120),
            UiAutomationTimeout = TimeSpan.FromMilliseconds(60),
            PollInterval = TimeSpan.FromMilliseconds(10),
            MaxCpuCores = double.MaxValue,
            MaxHandles = int.MaxValue,
            MaxHandleGrowth = int.MaxValue,
        }, sample ?? (() => default), () =>
        {
            cleanup?.Invoke();
            cleaned.SetResult();
            return Task.CompletedTask;
        });
        _workers.Add((worker, cleaned.Task));
        return worker;
    }

    [Fact]
    public async Task Sequential_successful_commands_release_slot_before_completing_the_caller()
    {
        var worker = Worker(new()
        {
            CommandTimeout = TimeSpan.FromSeconds(5),
            MaxCpuCores = double.MaxValue,
            MaxHandles = int.MaxValue,
            MaxHandleGrowth = int.MaxValue,
        });
        for (var index = 0; index < 1000; index++)
        {
            var expected = index;
            var result = await worker.ExecuteAsync("active_window",
                _ => Task.FromResult<object>(expected), CancellationToken.None);
            Assert.Equal(expected, result);
        }
    }

    [Fact]
    public async Task Native_hang_times_out_but_keeps_single_slot_and_thread_until_native_returns()
    {
        using var release = new ManualResetEventSlim();
        var entered = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        var worker = Worker();
        try
        {
            var hung = worker.ExecuteAsync("open_url", _ =>
            {
                Interlocked.Increment(ref calls);
                entered.SetResult(Environment.CurrentManagedThreadId);
                release.Wait();
                return Task.FromResult<object>("late");
            }, CancellationToken.None);
            var thread = await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.NotEqual(Environment.CurrentManagedThreadId, thread);
            var refusal = await Assert.ThrowsAsync<CommandWorkerRefusedException>(() => hung.WaitAsync(TimeSpan.FromSeconds(5)));
            Assert.Equal("timeout", refusal.Code);
            for (var i = 0; i < 1000; i++)
                Assert.Equal("busy", (await Assert.ThrowsAsync<CommandWorkerRefusedException>(() =>
                    worker.ExecuteAsync("uia_snapshot", _ =>
                    {
                        Interlocked.Increment(ref calls);
                        return Task.FromResult<object>(0);
                    }, CancellationToken.None))).Code);
            Assert.Equal(1, calls);
            release.Set();
            var next = await RetryUntilReleased(worker);
            Assert.Equal(thread, (int)next);
        }
        finally { release.Set(); }
    }

    [Fact]
    public async Task Noncooperative_async_operation_remains_busy_after_caller_cancellation()
    {
        var release = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var caller = new CancellationTokenSource();
        var worker = Worker();
        var task = worker.ExecuteAsync("browser_tabs", _ =>
        {
            entered.SetResult();
            return release.Task;
        }, caller.Token);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        caller.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task.WaitAsync(TimeSpan.FromSeconds(5)));
        await Assert.ThrowsAsync<CommandWorkerRefusedException>(() =>
            worker.ExecuteAsync("active_window", _ => Task.FromResult<object>(0), CancellationToken.None));
        release.SetResult("late");
        await RetryUntilReleased(worker);
    }

    [Fact]
    public async Task Async_native_continuations_return_to_same_worker_and_uia_has_shorter_deadline()
    {
        var worker = Worker();
        await worker.ExecuteAsync("active_window", async _ =>
        {
            var thread = Environment.CurrentManagedThreadId;
            await Task.Delay(10);
            Assert.Equal(thread, Environment.CurrentManagedThreadId);
            if (OperatingSystem.IsWindows()) Assert.Equal(ApartmentState.MTA, Thread.CurrentThread.GetApartmentState());
            return thread;
        }, CancellationToken.None);
        var release = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            var task = worker.ExecuteAsync("uia_act", _ => release.Task, CancellationToken.None);
            Assert.Equal("timeout", (await Assert.ThrowsAsync<CommandWorkerRefusedException>(() =>
                task.WaitAsync(TimeSpan.FromSeconds(5)))).Code);
        }
        finally { release.TrySetResult(0); }
        await RetryUntilReleased(worker);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Watchdog_cancels_cpu_core_equivalent_or_handle_budget_and_logs_no_content(bool cpu)
    {
        var reads = 0;
        var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = Worker(new()
        {
            CommandTimeout = TimeSpan.FromSeconds(5),
            PollInterval = TimeSpan.FromMilliseconds(10),
            MaxCpuCores = 1,
            MaxHandles = 100,
        }, () => Interlocked.Increment(ref reads) == 1 ? default :
            cpu ? new(TimeSpan.FromSeconds(1), 5, 1) : new(TimeSpan.Zero, 5, 101));
        try
        {
            var task = worker.ExecuteAsync("uia_snapshot", token =>
            {
                token.Register(() => cancelled.TrySetResult());
                return release.Task;
            }, CancellationToken.None);
            Assert.Equal("watchdog", (await Assert.ThrowsAsync<CommandWorkerRefusedException>(() =>
                task.WaitAsync(TimeSpan.FromSeconds(5)))).Code);
            await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
        }
        finally { release.TrySetResult(0); }
        await RetryUntilReleased(worker);
        Assert.Contains("pc_bridge.watchdog", File.ReadAllText(Path.Combine(_directory, "diagnostics.log")));
    }

    [Fact]
    public async Task Disposal_is_nonblocking_and_defers_cleanup_until_native_exit()
    {
        using var release = new ManualResetEventSlim();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cleaned = false;
        var worker = Worker(cleanup: () => cleaned = true);
        var task = worker.ExecuteAsync("open_app", _ =>
        {
            entered.TrySetResult();
            release.Wait();
            return Task.FromResult<object>(0);
        }, CancellationToken.None);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        try
        {
            worker.Dispose();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task.WaitAsync(TimeSpan.FromSeconds(5)));
            Assert.False(cleaned);
            await Assert.ThrowsAsync<ObjectDisposedException>(() =>
                worker.ExecuteAsync("open_app", _ => Task.FromResult<object>(0), CancellationToken.None));
        }
        finally { release.Set(); }
    }

    [Fact]
    public async Task Cancellation_callback_hang_cannot_block_caller_or_allow_replacement_work()
    {
        using var callbackRelease = new ManualResetEventSlim();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var operationRelease = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var caller = new CancellationTokenSource();
        var worker = Worker();
        var task = worker.ExecuteAsync("browser_act", token =>
        {
            token.Register(() => callbackRelease.Wait());
            entered.SetResult();
            return operationRelease.Task;
        }, caller.Token);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        try
        {
            caller.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task.WaitAsync(TimeSpan.FromSeconds(5)));
            operationRelease.SetResult(0);
            await Assert.ThrowsAsync<CommandWorkerRefusedException>(() =>
                worker.ExecuteAsync("open_url", _ => Task.FromResult<object>(0), CancellationToken.None));
        }
        finally { callbackRelease.Set(); operationRelease.TrySetResult(0); }
        await RetryUntilReleased(worker);
    }

    [Fact]
    public async Task Deadline_is_independent_of_blocked_resource_sampling()
    {
        using var release = new ManualResetEventSlim();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = Worker(sample: () =>
        {
            entered.TrySetResult();
            release.Wait();
            return default;
        });
        try
        {
            var task = worker.ExecuteAsync("open_url", _ => Task.FromResult<object>(0), CancellationToken.None);
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal("timeout", (await Assert.ThrowsAsync<CommandWorkerRefusedException>(() =>
                task.WaitAsync(TimeSpan.FromSeconds(5)))).Code);
            await Assert.ThrowsAsync<CommandWorkerRefusedException>(() =>
                worker.ExecuteAsync("open_app", _ => Task.FromResult<object>(0), CancellationToken.None));
        }
        finally { release.Set(); }
        await RetryUntilReleased(worker);
    }

    private static async Task<object> RetryUntilReleased(BoundedCommandWorker worker)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (true)
        {
            deadline.Token.ThrowIfCancellationRequested();
            try { return await worker.ExecuteAsync("active_window",
                _ => Task.FromResult<object>(Environment.CurrentManagedThreadId), deadline.Token); }
            catch (CommandWorkerRefusedException ex) when (ex.Code == "busy")
            { await Task.Delay(10, deadline.Token); }
        }
    }

    public void Dispose()
    {
        foreach (var (worker, cleanup) in _workers)
        {
            worker.Dispose();
            cleanup.WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
        }
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }
}

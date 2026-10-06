using System.Diagnostics;
using System.Text.Json;
using Jarvis.PcBridge.Core;
using Jarvis.PcBridge.Stress;

var iterations = 48;
if (args.Length == 2 && args[0] == "--iterations" &&
    int.TryParse(args[1], out var requested) && requested is >= 8 and <= 200)
    iterations = requested;
else if (args.Length != 0)
{
    Console.Error.WriteLine("Usage: dotnet run --project pc-bridge/Jarvis.PcBridge.Stress -c Release -- [--iterations 8..200]");
    return 2;
}

var logDirectory = Path.Combine(Path.GetTempPath(), "Jarvis.PcBridge.Stress", Guid.NewGuid().ToString("N"));
var workerCleanup = new List<Task>();
try
{
    Console.WriteLine("P7-41 stress: modeled pre-fix baseline; controlled fake providers; NOT a real Windows-machine reproduction.");
    Console.WriteLine("CPU core%=CPU time/wall time*100; machine%=core%/logical cores. Independent scheduler probe=5ms timer lateness, NOT WinForms responsiveness. Native-hang responsiveness is measured by production worker replies to fake active_window commands; maxima are sampled, not OS lifetime peaks.");
    Console.WriteLine("Model: 3ms CPU-bound discovery/scan; independent 200ms baseline focus polling retained until loop ends; 200ms cancellable hardened focus delay. Production watchdog diagnostics included; logs use the configured temporary root and are removed after worker cleanup. CPU/wall ratios are measurements, not speedup assertions.");
    Console.WriteLine("Hang comparison is an adversarial unbounded timeout/replacement model, not a claim that the previous bridge spawned these replacement workers.");
    Console.WriteLine("Synchronous native-hang baseline latency is a lower bound: the 160ms observer stops measuring while the original command remains blocked.");
    await RunCommands(false);
    await RunCommands(true);
    await RunModeledHang();
    await RunModeledReplacementHang();
    await RunHardenedHang();
    await RunDiscoveryHang();
    await RunFocusHang();
    Console.WriteLine("PASS: command loop, discovery caching, bounded focus, timeout, fail-fast busy, noncooperative worker/discovery/focus no replacement growth, bounded disposal.");
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine($"FAIL: {exception}");
    return 1;
}
finally
{
    await Task.WhenAll(workerCleanup).WaitAsync(TimeSpan.FromSeconds(3));
    if (Directory.Exists(logDirectory)) Directory.Delete(logDirectory, recursive: true);
}

async Task RunCommands(bool hardened)
{
    using var probe = new ResourceProbe();
    using var provider = new FakeUiAutomationProvider();
    var automation = new UiAutomationExecutor(provider);
    var scans = 0;
    IReadOnlyList<InstalledApp> Scan(CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref scans);
        var elapsed = Stopwatch.StartNew();
        while (elapsed.ElapsedMilliseconds < 3)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Thread.SpinWait(128);
        }
        return [new InstalledApp("Notepad", "notepad.exe")];
    }
    using var cache = hardened ? new InstalledAppCache(Scan) : null;
    using var focus = hardened ? new SingleFlightFocusPoller() : null;
    using var worker = hardened ? CreateWorker() : null;
    using var releaseFocus = new ManualResetEventSlim();
    var oldFocusThreads = new List<Thread>();
    var focusActive = 0;
    var focusPeak = 0;
    var fakeMediaCalls = 0;
    var open = false;
    Task focusFlight = Task.CompletedTask;
    if (cache is not null) await cache.RefreshIfDueAsync().WaitAsync(TimeSpan.FromSeconds(2));

    Task<object> Execute(string command, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        switch (command)
        {
            case "open_app":
                var matches = cache?.FindBestMatches("Notepad") ??
                    InstalledAppMatcher.FindBestMatches("Notepad", Scan(token));
                Check(matches.Count == 1, "fake installed app must resolve uniquely");
                open = true;
                if (focus is not null)
                {
                    focusFlight = focus.ReplaceAsync(async cancellationToken =>
                    {
                        var active = Interlocked.Increment(ref focusActive);
                        Max(ref focusPeak, active);
                        try { await Task.Delay(200, cancellationToken); }
                        finally { Interlocked.Decrement(ref focusActive); }
                    });
                }
                else
                {
                    var thread = new Thread(() =>
                    {
                        var active = Interlocked.Increment(ref focusActive);
                        Max(ref focusPeak, active);
                        try { while (!releaseFocus.Wait(200)) Thread.SpinWait(64); }
                        finally { Interlocked.Decrement(ref focusActive); }
                    }) { IsBackground = true, Name = "modeled-pre-fix-focus-poll" };
                    oldFocusThreads.Add(thread);
                    thread.Start();
                }
                return Task.FromResult<object>(new { opened = true });
            case "close_app":
                Check(open, "close_app must have a matching fake open");
                open = false;
                return Task.FromResult<object>(new { closing = true });
            case "uia_snapshot":
                return Task.FromResult<object>(automation.Observe(token));
            case "media":
                Check(CommandPolicy.TryGetMediaVirtualKey("play_pause", out _), "real media policy");
                fakeMediaCalls++;
                return Task.FromResult<object>(new { controlled = true, fake = true });
            default: throw new InvalidOperationException(command);
        }
    }
    try
    {
        for (var i = 0; i < iterations; i++)
            foreach (var command in new[] { "open_app", "uia_snapshot", "media", "close_app" })
                await probe.CommandAsync(() => worker is null
                    ? Execute(command, CancellationToken.None)
                    : worker.ExecuteAsync(command, token => Execute(command, token), CancellationToken.None))
                    .WaitAsync(TimeSpan.FromSeconds(3));
        Check(scans == (hardened ? 1 : iterations), "discovery count");
        Check(provider.Calls == iterations && fakeMediaCalls == iterations, "full command loop");
        if (hardened) Check(focusPeak <= 1, "focus concurrency must be at most one");
        else Check(SpinWait.SpinUntil(() => Volatile.Read(ref focusActive) == iterations, 2000),
            "modeled independent focus threads must all start");
        probe.Print(hardened ? "hardened_production_fake_command_loop" : "modeled_pre_fix_fake_command_loop",
            new { iterations, discoveryCalls = scans, focusPeak, fakeMediaCalls, passed = true });
    }
    finally
    {
        releaseFocus.Set();
        foreach (var thread in oldFocusThreads) Check(thread.Join(2000), "baseline focus cleanup");
        focus?.Dispose();
        await focusFlight.WaitAsync(TimeSpan.FromSeconds(2));
        if (!hardened)
        {
            var teardown = Stopwatch.StartNew();
            while (BridgeResourceSample.Read().Threads > probe.StartThreads + 16 &&
                teardown.Elapsed < TimeSpan.FromSeconds(3))
                await Task.Delay(10);
            Check(BridgeResourceSample.Read().Threads <= probe.StartThreads + 16,
                "modeled baseline OS threads must finish teardown before hardened measurement");
        }
    }
}

async Task RunModeledHang()
{
    using var probe = new ResourceProbe();
    using var provider = new FakeUiAutomationProvider { Hang = true };
    var automation = new UiAutomationExecutor(provider);
    var completion = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
    var thread = new Thread(() =>
    {
        try { completion.TrySetResult(automation.Observe(CancellationToken.None)); }
        catch (Exception exception) { completion.TrySetException(exception); }
    }) { IsBackground = true, Name = "modeled-pre-fix-synchronous-uia" };
    thread.Start();
    try
    {
        await probe.CommandAsync(async () =>
        {
            try { return await completion.Task.WaitAsync(TimeSpan.FromMilliseconds(160)); }
            catch (TimeoutException) { return (object)"observer_deadline_only_no_command_response"; }
        });
        Check(!completion.Task.IsCompleted && provider.Active == 1,
            "modeled synchronous native call must still block the caller");
        probe.Print("modeled_pre_fix_synchronous_noncooperative_uia", new
        {
            nativeCalls = provider.Calls, observerDeadlineMs = 160,
            commandStillBlocked = true, passed = true,
        });
    }
    finally
    {
        provider.Release();
        Check(thread.Join(2000), "synchronous baseline native cleanup");
    }
}

async Task RunModeledReplacementHang()
{
    using var probe = new ResourceProbe();
    using var provider = new FakeUiAutomationProvider { Hang = true };
    var automation = new UiAutomationExecutor(provider);
    var threads = new List<Thread>();
    try
    {
        for (var i = 0; i < 12; i++)
        {
            var completion = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            var thread = new Thread(() =>
            {
                try { completion.TrySetResult(automation.Observe(CancellationToken.None)); }
                catch (Exception ex) { completion.TrySetException(ex); }
            }) { IsBackground = true, Name = "modeled-unbounded-native-replacement" };
            threads.Add(thread);
            thread.Start();
            await probe.CommandAsync(async () =>
            {
                try { return await completion.Task.WaitAsync(TimeSpan.FromMilliseconds(15)); }
                catch (TimeoutException) { return (object)"modeled_caller_timeout"; }
            });
        }
        Check(provider.PeakActive == 12, "modeled unbounded replacement count");
        probe.Print("modeled_unbounded_replacement_noncooperative_uia", new
        {
            nativeCalls = provider.Calls, nativePeakActive = provider.PeakActive,
            retainedWorkers = threads.Count, passed = true,
        });
    }
    finally
    {
        provider.Release();
        foreach (var thread in threads) Check(thread.Join(2000), "baseline hang cleanup");
    }
}

async Task RunHardenedHang()
{
    using var probe = new ResourceProbe();
    using var provider = new FakeUiAutomationProvider { Hang = true };
    var automation = new UiAutomationExecutor(provider);
    using var worker = CreateWorker();
    try
    {
        var started = Stopwatch.StartNew();
        var outcome = await probe.CommandAsync(() => Refusal(() => worker.ExecuteAsync("uia_snapshot",
            token => Task.FromResult<object>(automation.Observe(token)), CancellationToken.None)))
            .WaitAsync(TimeSpan.FromSeconds(2));
        Check(outcome == "timeout", $"noncooperative UIA outcome was {outcome}");
        Check(started.Elapsed < TimeSpan.FromSeconds(2), "native timeout must bound caller wall time");
        var maxBusyReplyLatencyMs = 0d;
        for (var retry = 0; retry < 100; retry++)
        {
            var replyStarted = Stopwatch.GetTimestamp();
            var command = retry % 2 == 0 ? "uia_snapshot" : "active_window";
            var refusal = await probe.CommandAsync(() => Refusal(() => worker.ExecuteAsync(command,
                token => Task.FromResult<object>(automation.Observe(token)), CancellationToken.None)))
                .WaitAsync(TimeSpan.FromMilliseconds(500));
            Check(refusal == "busy", "hung native worker must reject replacement");
            maxBusyReplyLatencyMs = Math.Max(maxBusyReplyLatencyMs,
                Stopwatch.GetElapsedTime(replyStarted).TotalMilliseconds);
        }
        Check(maxBusyReplyLatencyMs < 500, "worker must promptly reply busy to responsiveness probes");
        Check(provider.Calls == 1 && provider.PeakActive == 1 && provider.Active == 1,
            "native hang must retain exactly one operation, without replacement growth");
        var afterRetries = BridgeResourceSample.Read();
        Check(Math.Max(probe.PeakThreads, afterRetries.Threads) - probe.StartThreads <= 12,
            "100 rejected replacements must not cause linear process-thread growth");
        Check(Math.Max(probe.PeakHandles, afterRetries.Handles) - probe.StartHandles <= 16,
            "100 rejected replacements must not cause linear process-handle growth");
        started.Restart();
        worker.Dispose();
        Check(started.Elapsed < TimeSpan.FromMilliseconds(500), "noncooperative disposal must be bounded");
        probe.Print("hardened_production_noncooperative_uia", new
        {
            nativeCalls = provider.Calls, nativePeakActive = provider.PeakActive,
            rejectedReplacements = 100, timeoutMs = 80,
            fakeActiveWindowResponsivenessProbes = 50,
            maxWorkerBusyReplyLatencyMs = Math.Round(maxBusyReplyLatencyMs, 2),
            maxAdditionalThreads = 12, maxAdditionalHandles = 16, passed = true,
        });
    }
    finally
    {
        provider.Release();
        Check(SpinWait.SpinUntil(() => Volatile.Read(ref provider.Active) == 0, 2000), "native release");
    }
}

async Task RunDiscoveryHang()
{
    using var release = new ManualResetEventSlim();
    using var entered = new ManualResetEventSlim();
    var calls = 0;
    var now = DateTimeOffset.UtcNow;
    using var cache = new InstalledAppCache(_ =>
    {
        Interlocked.Increment(ref calls);
        entered.Set();
        release.Wait();
        return [new InstalledApp("Notepad", "notepad.exe")];
    }, () => now);
    Check(entered.Wait(2000), "native discovery entered");
    try
    {
        var flight = cache.RefreshIfDueAsync();
        for (var i = 0; i < 100; i++)
        {
            now += TimeSpan.FromHours(1);
            Check(ReferenceEquals(flight, cache.RefreshIfDueAsync(cacheMiss: true)),
                "hung scan must retain its flight even after refresh deadline");
            Check(cache.FindBestMatches("Notepad").Count == 0, "cold hung scan must not invent matches");
        }
        Check(calls == 1, "noncooperative discovery must not grow replacement threads");
        cache.Dispose();
        release.Set();
        await flight.WaitAsync(TimeSpan.FromSeconds(2));
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            scenario = "hardened_production_noncooperative_discovery",
            nativeCalls = calls, rejectedReplacementScans = 100, passed = true,
        }));
    }
    finally { release.Set(); }
}

async Task RunFocusHang()
{
    using var poller = new SingleFlightFocusPoller();
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var calls = 0;
    var replacements = 0;
    var flight = poller.ReplaceAsync(async _ =>
    {
        Interlocked.Increment(ref calls);
        entered.SetResult();
        await release.Task; // A provider that ignores cancellation must retain the only flight.
    });
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
    try
    {
        for (var i = 0; i < 100; i++)
            Check(ReferenceEquals(flight, poller.ReplaceAsync(_ =>
            {
                Interlocked.Increment(ref replacements);
                return Task.CompletedTask;
            })), "focus replacements share one retained flight");
        Check(calls == 1 && replacements == 0, "noncooperative focus must not start replacements");
    }
    finally
    {
        poller.Dispose();
        release.TrySetResult();
        await flight.WaitAsync(TimeSpan.FromSeconds(2));
    }
    Check(replacements == 0, "disposal discards the pending focus request");
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        scenario = "hardened_production_noncooperative_focus",
        activeNativeCalls = calls, replacementCalls = replacements, coalescedRequests = 100, passed = true,
    }));
}

BoundedCommandWorker CreateWorker()
{
    var cleanedUp = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    workerCleanup.Add(cleanedUp.Task);
    return new BoundedCommandWorker(new BridgeDiagnostics(logDirectory), new CommandWorkerOptions
    {
        CommandTimeout = TimeSpan.FromSeconds(2),
        UiAutomationTimeout = TimeSpan.FromMilliseconds(80),
        PollInterval = TimeSpan.FromMilliseconds(5),
        MaxCpuCores = double.MaxValue,
        MaxHandles = int.MaxValue,
        MaxHandleGrowth = int.MaxValue,
    }, cleanup: () =>
    {
        cleanedUp.TrySetResult();
        return Task.CompletedTask;
    });
}

static async Task<string> Refusal(Func<Task<object>> execute)
{
    try { await execute(); return "unexpected_success"; }
    catch (CommandWorkerRefusedException exception) { return exception.Code; }
}

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static void Max(ref int destination, int value)
{
    int previous;
    do
    {
        previous = Volatile.Read(ref destination);
        if (value <= previous) return;
    } while (Interlocked.CompareExchange(ref destination, value, previous) != previous);
}

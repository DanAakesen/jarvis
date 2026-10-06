using System.Collections.Concurrent;
using System.Diagnostics;

namespace Jarvis.PcBridge.Core;

public sealed class CommandWorkerRefusedException(string code) : Exception
{
    public string Code { get; } = code;
}

public sealed record CommandWorkerOptions
{
    public TimeSpan CommandTimeout { get; init; } = TimeSpan.FromSeconds(10);
    public TimeSpan UiAutomationTimeout { get; init; } = TimeSpan.FromSeconds(2);
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromMilliseconds(250);
    public double MaxCpuCores { get; init; } = 1.5;
    public int MaxHandles { get; init; } = 4096;
    public int MaxHandleGrowth { get; init; } = 512;
}

// The slot belongs to the native operation, not to its caller. A timed-out operation
// keeps the same background MTA thread and slot until it really returns.
public sealed class BoundedCommandWorker : IDisposable
{
    private readonly object _gate = new();
    private readonly AutoResetEvent _wake = new(false);
    private readonly Thread _thread;
    private readonly CommandWorkerOptions _options;
    private readonly BridgeDiagnostics _diagnostics;
    private readonly Func<BridgeResourceSample> _sample;
    private readonly Func<Task>? _cleanup;
    private Work? _work;
    private bool _disposed;

    public BoundedCommandWorker(BridgeDiagnostics diagnostics, CommandWorkerOptions? options = null,
        Func<BridgeResourceSample>? sample = null, Func<Task>? cleanup = null)
    {
        _diagnostics = diagnostics;
        _options = options ?? new();
        if (_options.CommandTimeout <= TimeSpan.Zero || _options.UiAutomationTimeout <= TimeSpan.Zero ||
            _options.PollInterval <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(options));
        _sample = sample ?? BridgeResourceSample.Read;
        _cleanup = cleanup;
        _thread = new Thread(Run) { IsBackground = true, Name = "Jarvis PC command worker" };
        if (OperatingSystem.IsWindows()) _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
    }

    public Task<object> ExecuteAsync(string command, Func<CancellationToken, Task<object>> execute,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(BoundedCommandWorker));
            if (_work is not null) throw new CommandWorkerRefusedException("busy");
            var work = new Work(command, execute, cancellationToken,
                command.StartsWith("uia_", StringComparison.Ordinal) ? _options.UiAutomationTimeout : _options.CommandTimeout,
                _diagnostics);
            _work = work;
            _wake.Set();
            return work.Completion.Task;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _work?.Stop("cancelled");
            _wake.Set();
        }
    }

    private void Run()
    {
        using var context = new WorkerContext();
        SynchronizationContext.SetSynchronizationContext(context);
        try
        {
            while (true)
            {
                _wake.WaitOne();
                Work? work;
                lock (_gate)
                {
                    work = _work;
                    if (work is null && _disposed) break;
                }
                if (work is null) continue;
                Execute(work, context);
                lock (_gate)
                {
                    _work = null;
                    work.Publish();
                    if (_disposed) break;
                }
            }
        }
        finally
        {
            try { if (_cleanup is not null) context.Wait(_cleanup()); }
            catch { /* Cleanup failures cannot escape the background thread. */ }
            _wake.Dispose();
        }
    }

    private void Execute(Work work, WorkerContext context)
    {
        var started = Stopwatch.StartNew();
        var baseline = ReadSample();
        work.Sample = baseline;
        var previous = baseline;
        var previousAt = TimeSpan.Zero;
        var polling = 0;
        using var watchdog = new Timer(_ =>
        {
            if (Interlocked.CompareExchange(ref polling, 1, 0) != 0) return;
            try
            {
                var elapsed = started.Elapsed;
                var sample = ReadSample();
                work.Sample = sample;
                var span = elapsed - previousAt;
                var cores = span.TotalSeconds > 0 ? (sample.CpuTime - previous.CpuTime).TotalSeconds / span.TotalSeconds : 0;
                previous = sample;
                previousAt = elapsed;
                var reason = cores > _options.MaxCpuCores || sample.Handles > _options.MaxHandles ||
                    sample.Handles - baseline.Handles > _options.MaxHandleGrowth ? "budget" : null;
                if (reason is not null && work.Stop(reason))
                    _diagnostics.Write("watchdog", work.Command, reason, elapsed, sample, cores);
            }
            finally { Volatile.Write(ref polling, 0); }
        }, null, _options.PollInterval, _options.PollInterval);
        try
        {
            work.Token.ThrowIfCancellationRequested();
            var task = work.Execute(work.Token);
            context.Wait(task);
            if (started.Elapsed >= work.Timeout) work.Stop("timeout");
            work.Result = task.GetAwaiter().GetResult();
        }
        catch (OperationCanceledException) { work.Stop("cancelled"); }
        catch (Exception ex) { work.Failure = ex; }
        finally
        {
            _diagnostics.Write("command", work.Command,
                work.Reason ?? (work.Failure is null ? "completed" : "failed"),
                started.Elapsed, ReadSample(), 0);
            context.Wait(watchdog.DisposeAsync().AsTask());
            try { context.Wait(work.FinishCancellation()); }
            catch { }
            context.Wait(work.FinishDeadlineAsync());
            work.Dispose();
        }
    }

    private BridgeResourceSample ReadSample()
    {
        try { return _sample(); }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException)
        { return default; }
    }

    private sealed class Work : IDisposable
    {
        private readonly object _gate = new();
        private readonly CancellationTokenSource _token = new();
        private readonly CancellationTokenRegistration _registration;
        private readonly Timer _deadline;
        private BridgeResourceSample _sample;
        private Task? _cancellation;
        private bool _finished;
        public string Command { get; }
        public Func<CancellationToken, Task<object>> Execute { get; }
        public TimeSpan Timeout { get; }
        public string? Reason { get; private set; }
        public CancellationToken Token => _token.Token;
        public TaskCompletionSource<object> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public object? Result { get; set; }
        public Exception? Failure { get; set; }
        public BridgeResourceSample Sample
        {
            get { lock (_gate) return _sample; }
            set { lock (_gate) _sample = value; }
        }

        public void Publish()
        {
            if (Failure is { } failure) Completion.TrySetException(failure);
            else Completion.TrySetResult(Result!);
        }

        public Work(string command, Func<CancellationToken, Task<object>> execute, CancellationToken caller,
            TimeSpan timeout, BridgeDiagnostics diagnostics)
        {
            Command = command;
            Execute = execute;
            Timeout = timeout;
            _deadline = new Timer(_ =>
            {
                if (Stop("timeout"))
                    diagnostics.Write("watchdog", Command, "timeout", Timeout, Sample, 0);
            }, null, System.Threading.Timeout.InfiniteTimeSpan, System.Threading.Timeout.InfiniteTimeSpan);
            _registration = caller.Register(() => Stop("cancelled"));
            _deadline.Change(timeout, System.Threading.Timeout.InfiniteTimeSpan);
        }

        public bool Stop(string reason)
        {
            lock (_gate)
            {
                if (_finished || Reason is not null || Completion.Task.IsCompleted) return false;
                Reason = reason;
                if (reason == "cancelled") Completion.TrySetCanceled();
                else Completion.TrySetException(new CommandWorkerRefusedException(reason == "budget" ? "watchdog" : "timeout"));
                // Caller completion is independent even of a blocking cancellation callback.
                _cancellation = _token.CancelAsync();
                return true;
            }
        }

        public void Dispose()
        {
            _registration.Dispose();
            _deadline.Dispose();
            lock (_gate)
            {
                _finished = true;
                if (_cancellation is { } cancellation)
                    _ = cancellation.ContinueWith(task =>
                    {
                        _ = task.Exception;
                        _token.Dispose();
                    }, TaskScheduler.Default);
                else _token.Dispose();
            }
        }
        public Task FinishCancellation()
        {
            lock (_gate)
            {
                _finished = true;
                return _cancellation ?? Task.CompletedTask;
            }
        }
        public Task FinishDeadlineAsync() => _deadline.DisposeAsync().AsTask();
    }

    private sealed class WorkerContext : SynchronizationContext, IDisposable
    {
        private readonly ConcurrentQueue<(SendOrPostCallback Callback, object? State)> _pending = new();
        private readonly AutoResetEvent _ready = new(false);
        public override void Post(SendOrPostCallback callback, object? state)
        {
            _pending.Enqueue((callback, state));
            _ready.Set();
        }
        public void Wait(Task task)
        {
            while (!task.IsCompleted)
            {
                if (_pending.TryDequeue(out var item)) item.Callback(item.State);
                else _ready.WaitOne(25);
            }
            task.GetAwaiter().GetResult();
        }
        public void Dispose() => _ready.Dispose();
    }
}

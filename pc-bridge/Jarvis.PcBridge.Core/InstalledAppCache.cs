namespace Jarvis.PcBridge.Core;

public sealed class InstalledAppCache : IDisposable
{
    public static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan MissRefreshInterval = TimeSpan.FromSeconds(30);
    private readonly object _gate = new();
    private readonly Func<CancellationToken, IReadOnlyList<InstalledApp>> _scan;
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly Timer _timer;
    private IReadOnlyList<InstalledApp> _snapshot = Array.Empty<InstalledApp>();
    private Task _flight = Task.CompletedTask;
    private DateTimeOffset? _lastAttempt;
    private bool _disposed;

    public InstalledAppCache(
        Func<CancellationToken, IReadOnlyList<InstalledApp>> scan,
        Func<DateTimeOffset>? utcNow = null)
    {
        _scan = scan;
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
        _timer = new Timer(_ => RefreshIfDueAsync(), null, RefreshInterval, RefreshInterval);
        _ = RefreshIfDueAsync();
    }

    public IReadOnlyList<InstalledApp> FindBestMatches(string requestedName)
    {
        var matches = InstalledAppMatcher.FindBestMatches(requestedName, Volatile.Read(ref _snapshot));
        _ = RefreshIfDueAsync(cacheMiss: matches.Count == 0);
        return matches;
    }

    public Task RefreshIfDueAsync(bool cacheMiss = false)
    {
        lock (_gate)
        {
            if (_disposed || !_flight.IsCompleted) return _flight;
            var now = _utcNow();
            if (_lastAttempt is { } previous &&
                now - previous < (cacheMiss ? MissRefreshInterval : RefreshInterval))
                return _flight;
            _lastAttempt = now;
            _timer.Change(RefreshInterval, RefreshInterval);
            var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            _flight = completion.Task;
            // Keep this flight occupied until the actual scanner returns, even if COM hangs.
            var thread = new Thread(() =>
            {
                try
                {
                    var apps = Array.AsReadOnly(_scan(_lifetime.Token).Take(4_000).ToArray());
                    lock (_gate)
                    {
                        if (!_disposed) Volatile.Write(ref _snapshot, apps);
                    }
                }
                catch (OperationCanceledException) when (_lifetime.IsCancellationRequested) { }
                catch { /* Keep the last usable snapshot if discovery fails. */ }
                finally { completion.TrySetResult(); }
            }) { IsBackground = true, Name = "Jarvis installed app discovery" };
            if (OperatingSystem.IsWindows()) thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            return _flight;
        }
    }

    public void Dispose()
    {
        Task flight;
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            flight = _flight;
        }
        _timer.Dispose();
        _lifetime.Cancel();
        _ = flight.ContinueWith(_ => _lifetime.Dispose(), TaskScheduler.Default);
    }
}

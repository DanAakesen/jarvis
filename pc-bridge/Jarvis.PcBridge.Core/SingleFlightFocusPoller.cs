namespace Jarvis.PcBridge.Core;

public sealed class SingleFlightFocusPoller : IDisposable
{
    private readonly object _gate = new();
    private (Func<CancellationToken, Task> Poll, CancellationToken Token)? _pending;
    private CancellationTokenSource? _active;
    private Task _activeCancellation = Task.CompletedTask;
    private Task _flight = Task.CompletedTask;
    private bool _running;
    private bool _disposed;

    public Task ReplaceAsync(Func<CancellationToken, Task> poll, CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            if (_disposed) return _flight;
            _pending = (poll, cancellationToken);
            CancelActive();
            if (!_running)
            {
                _running = true;
                _flight = Task.Run(RunAsync);
            }
            return _flight;
        }
    }

    private async Task RunAsync()
    {
        while (true)
        {
            (Func<CancellationToken, Task> Poll, CancellationToken Token) work;
            CancellationTokenSource cancellation;
            lock (_gate)
            {
                if (_disposed || _pending is null)
                {
                    _running = false;
                    return;
                }
                work = _pending.Value;
                _pending = null;
                cancellation = CancellationTokenSource.CreateLinkedTokenSource(work.Token);
                _active = cancellation;
            }
            try
            {
                cancellation.Token.ThrowIfCancellationRequested();
                await work.Poll(cancellation.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
            catch { /* Foreground activation is best effort after a successful launch. */ }
            finally
            {
                Task cancellationCallbacks;
                lock (_gate)
                {
                    _active = null;
                    cancellationCallbacks = _activeCancellation;
                    _activeCancellation = Task.CompletedTask;
                }
                try { await cancellationCallbacks.ConfigureAwait(false); }
                catch { /* Cancellation callback failures must not strand the focus slot. */ }
                cancellation.Dispose();
            }
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _pending = null;
            CancelActive();
        }
    }

    private void CancelActive()
    {
        if (_active is { IsCancellationRequested: false })
            _activeCancellation = _active.CancelAsync();
    }
}

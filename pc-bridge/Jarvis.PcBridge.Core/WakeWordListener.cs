namespace Jarvis.PcBridge.Core;

/// <summary>
/// On-device keyword spotter. Implementations open the microphone only while
/// <see cref="RecognizeOnceAsync"/> runs and never store or send audio.
/// </summary>
public interface IKeywordRecognizer : IAsyncDisposable
{
    /// <summary>
    /// Listens until the keyword is heard (true), listening stops without a keyword (false),
    /// or <paramref name="cancellationToken"/> is cancelled.
    /// </summary>
    Task<bool> RecognizeOnceAsync(CancellationToken cancellationToken);
}

public enum WakeWordState
{
    Off,
    Listening,
    PausedForVoice,
    Unavailable,
}

/// <summary>
/// Runs the keyword recognizer only while the tray toggle is on and no Jarvis voice session is
/// active, reports each detection once, and ignores repeats inside the debounce interval.
/// </summary>
public sealed class WakeWordListener
{
    public static readonly TimeSpan DebounceInterval = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan FailureBackoff = TimeSpan.FromSeconds(5);

    private readonly IKeywordRecognizer _recognizer;
    private readonly Func<DateTimeOffset, CancellationToken, Task> _detected;
    private readonly TimeProvider _time;
    private readonly object _gate = new();
    private TaskCompletionSource _changed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private CancellationTokenSource? _listening;
    private DateTimeOffset? _lastDetection;
    private bool _enabled;
    private bool _voiceActive;
    private bool _unavailable;
    private WakeWordState _reportedState = WakeWordState.Off;

    public WakeWordListener(
        IKeywordRecognizer recognizer,
        Func<DateTimeOffset, CancellationToken, Task> detected,
        bool enabled,
        TimeProvider? time = null)
    {
        _recognizer = recognizer;
        _detected = detected;
        _enabled = enabled;
        _time = time ?? TimeProvider.System;
        _reportedState = ComputeState();
    }

    public event Action<WakeWordState>? StateChanged;

    public WakeWordState State
    {
        get { lock (_gate) return ComputeState(); }
    }

    public void SetEnabled(bool enabled) => Update(() =>
    {
        _enabled = enabled;
        _unavailable = false;
    });

    public void SetVoiceActive(bool active) => Update(() => _voiceActive = active);

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Task changed;
            CancellationTokenSource? cycle = null;
            lock (_gate)
            {
                changed = _changed.Task;
                if (ShouldListen)
                {
                    cycle = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    _listening = cycle;
                }
            }

            if (cycle is null)
            {
                await changed.WaitAsync(cancellationToken).ConfigureAwait(false);
                continue;
            }

            bool recognized;
            bool stopped;
            try
            {
                recognized = await _recognizer.RecognizeOnceAsync(cycle.Token).ConfigureAwait(false);
                stopped = cycle.IsCancellationRequested;
            }
            catch (OperationCanceledException) when (cycle.IsCancellationRequested)
            {
                recognized = false;
                stopped = true;
            }
            catch (Exception) when (!cancellationToken.IsCancellationRequested)
            {
                recognized = false;
                stopped = false;
            }
            finally
            {
                lock (_gate)
                {
                    if (ReferenceEquals(_listening, cycle)) _listening = null;
                }
                cycle.Dispose();
            }

            cancellationToken.ThrowIfCancellationRequested();
            if (stopped) continue;
            if (!recognized)
            {
                // A recognizer that stops by itself (no microphone, invalid model) must not spin.
                Update(() => _unavailable = true);
                await Task.Delay(FailureBackoff, _time, cancellationToken).ConfigureAwait(false);
                continue;
            }

            var now = _time.GetUtcNow();
            lock (_gate)
            {
                if (!ShouldListen) continue;
                if (_lastDetection is { } last && now - last < DebounceInterval) continue;
                _lastDetection = now;
            }
            Update(() => _unavailable = false);

            try
            {
                await _detected(now, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception) when (!cancellationToken.IsCancellationRequested)
            {
            }
        }
    }

    private bool ShouldListen => _enabled && !_voiceActive;

    private WakeWordState ComputeState() =>
        !_enabled ? WakeWordState.Off
        : _voiceActive ? WakeWordState.PausedForVoice
        : _unavailable ? WakeWordState.Unavailable
        : WakeWordState.Listening;

    private void Update(Action change)
    {
        WakeWordState? changedState = null;
        lock (_gate)
        {
            change();
            if (!ShouldListen) _listening?.Cancel();
            var previous = _changed;
            _changed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            previous.TrySetResult();
            var state = ComputeState();
            if (state != _reportedState)
            {
                _reportedState = state;
                changedState = state;
            }
        }
        if (changedState is { } reported) StateChanged?.Invoke(reported);
    }
}

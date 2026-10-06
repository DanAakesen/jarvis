using System.Text;
using System.Text.Json;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class WakeWordListenerTests
{
    [Fact]
    public async Task Listens_only_while_the_toggle_is_on()
    {
        await using var harness = new Harness(enabled: false);
        await Task.Delay(50);
        Assert.Equal(0, harness.Recognizer.Calls);
        Assert.Equal(WakeWordState.Off, harness.Listener.State);

        harness.Listener.SetEnabled(true);
        await harness.Recognizer.WaitUntilListeningAsync();
        Assert.Equal(WakeWordState.Listening, harness.Listener.State);

        harness.Listener.SetEnabled(false);
        await harness.Recognizer.WaitUntilStoppedAsync();
        await Task.Delay(50);
        Assert.False(harness.Recognizer.IsListening);
        Assert.Equal(1, harness.Recognizer.Calls);
        Assert.Empty(harness.Detections);
    }

    [Fact]
    public async Task Pauses_during_a_voice_session_and_resumes_when_it_ends()
    {
        await using var harness = new Harness(enabled: true);
        await harness.Recognizer.WaitUntilListeningAsync();

        harness.Listener.SetVoiceActive(true);
        await harness.Recognizer.WaitUntilStoppedAsync();
        Assert.Equal(WakeWordState.PausedForVoice, harness.Listener.State);
        await Task.Delay(50);
        Assert.False(harness.Recognizer.IsListening);
        Assert.False(harness.Recognizer.Hear());

        harness.Listener.SetVoiceActive(false);
        await harness.Recognizer.WaitUntilListeningAsync();
        Assert.Equal(WakeWordState.Listening, harness.Listener.State);
        Assert.Equal(2, harness.Recognizer.Calls);
        Assert.Empty(harness.Detections);
    }

    [Fact]
    public async Task Reports_each_detection_once_and_debounces_repeats_for_three_seconds()
    {
        await using var harness = new Harness(enabled: true);
        await harness.Recognizer.WaitUntilListeningAsync();

        Assert.True(harness.Recognizer.Hear());
        await harness.WaitForDetectionsAsync(1);
        Assert.Equal(harness.Time.Now, Assert.Single(harness.Detections));

        await harness.Recognizer.WaitUntilListeningAsync();
        harness.Time.Advance(TimeSpan.FromSeconds(2.9));
        Assert.True(harness.Recognizer.Hear());
        await harness.Recognizer.WaitUntilListeningAsync();
        await Task.Delay(50);
        Assert.Single(harness.Detections);

        harness.Time.Advance(TimeSpan.FromSeconds(3));
        Assert.True(harness.Recognizer.Hear());
        await harness.WaitForDetectionsAsync(2);
        await harness.Recognizer.WaitUntilListeningAsync();
        await Task.Delay(50);
        Assert.Equal(2, harness.Detections.Count);
        Assert.Equal(TimeSpan.FromSeconds(5.9), harness.Detections[1] - harness.Detections[0]);
    }

    [Fact]
    public void Serializes_the_wake_word_event_and_reads_only_exact_voice_state_messages()
    {
        using var wake = JsonDocument.Parse(BridgeProtocol.WakeWord(
            new DateTimeOffset(2026, 10, 6, 16, 24, 37, 78, TimeSpan.FromHours(2))));
        Assert.Equal("wake_word", wake.RootElement.GetProperty("type").GetString());
        Assert.Equal("2026-10-06T14:24:37.078Z", wake.RootElement.GetProperty("at").GetString());
        Assert.Equal(2, wake.RootElement.EnumerateObject().Count());

        using var status = JsonDocument.Parse(BridgeProtocol.ControlState(false, wakeWord: true));
        Assert.True(status.RootElement.GetProperty("wakeWord").GetBoolean());

        Assert.True(BridgeProtocol.TryReadVoiceState(
            Encoding.UTF8.GetBytes("""{"type":"voice_state","active":true}"""), out var active));
        Assert.True(active);
        Assert.True(BridgeProtocol.TryReadVoiceState(
            Encoding.UTF8.GetBytes("""{"type":"voice_state","active":false}"""), out active));
        Assert.False(active);
        Assert.False(BridgeProtocol.TryReadVoiceState(
            Encoding.UTF8.GetBytes("""{"type":"voice_state","active":"yes"}"""), out _));
        Assert.False(BridgeProtocol.TryReadVoiceState(
            Encoding.UTF8.GetBytes("""{"type":"voice_state","active":true,"extra":1}"""), out _));
        Assert.False(BridgeProtocol.TryReadVoiceState(
            Encoding.UTF8.GetBytes("""{"id":"1730aa51-f380-4df9-a345-1feb862cb1c4","type":"command"}"""), out _));
        Assert.False(BridgeProtocol.TryReadVoiceState(Encoding.UTF8.GetBytes("not json"), out _));
    }

    private sealed class Harness : IAsyncDisposable
    {
        private readonly CancellationTokenSource _stopping = new();
        private readonly Task _run;
        private readonly object _gate = new();
        private readonly List<DateTimeOffset> _detections = [];

        public Harness(bool enabled)
        {
            Listener = new WakeWordListener(Recognizer, (at, _) =>
            {
                lock (_gate) _detections.Add(at);
                return Task.CompletedTask;
            }, enabled, Time);
            _run = Listener.RunAsync(_stopping.Token);
        }

        public FakeKeywordRecognizer Recognizer { get; } = new();
        public ManualTimeProvider Time { get; } = new();
        public WakeWordListener Listener { get; }

        public IReadOnlyList<DateTimeOffset> Detections
        {
            get { lock (_gate) return _detections.ToArray(); }
        }

        public Task WaitForDetectionsAsync(int count) => WaitUntilAsync(() => Detections.Count >= count);

        public async ValueTask DisposeAsync()
        {
            _stopping.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _run);
            _stopping.Dispose();
        }
    }

    private sealed class FakeKeywordRecognizer : IKeywordRecognizer
    {
        private readonly object _gate = new();
        private TaskCompletionSource<bool>? _pending;
        private int _calls;

        public int Calls
        {
            get { lock (_gate) return _calls; }
        }

        public bool IsListening
        {
            get { lock (_gate) return _pending is not null; }
        }

        public Task<bool> RecognizeOnceAsync(CancellationToken cancellationToken)
        {
            var pending = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (_gate)
            {
                _calls++;
                _pending = pending;
            }
            cancellationToken.Register(() =>
            {
                Clear(pending);
                pending.TrySetCanceled(cancellationToken);
            });
            return pending.Task;
        }

        // Simulates hearing "Wake up Jarvis"; false when the microphone is not being listened to.
        public bool Hear()
        {
            TaskCompletionSource<bool>? pending;
            lock (_gate)
            {
                pending = _pending;
                _pending = null;
            }
            return pending?.TrySetResult(true) == true;
        }

        public Task WaitUntilListeningAsync() => WaitUntilAsync(() => IsListening);

        public Task WaitUntilStoppedAsync() => WaitUntilAsync(() => !IsListening);

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        private void Clear(TaskCompletionSource<bool> pending)
        {
            lock (_gate)
            {
                if (ReferenceEquals(_pending, pending)) _pending = null;
            }
        }
    }

    private sealed class ManualTimeProvider : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 10, 6, 14, 24, 37, TimeSpan.Zero);

        public DateTimeOffset Now => _now;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan delta) => _now += delta;
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!condition())
        {
            await Task.Delay(5, timeout.Token);
        }
    }
}

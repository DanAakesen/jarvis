using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Stress;

internal sealed class FakeUiAutomationProvider : IUiAutomationProvider, IDisposable
{
    private readonly ManualResetEventSlim _release = new();
    public bool Hang { get; set; }
    public int Calls;
    public int Active;
    public int PeakActive;

    public UiAutomationView Observe(CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref Calls);
        var active = Interlocked.Increment(ref Active);
        UpdatePeak(active);
        try
        {
            if (Hang) _release.Wait(); // Deliberately models a native call ignoring cancellation.
            else cancellationToken.ThrowIfCancellationRequested();
            return new UiAutomationView("notepad", "owned-fake-window",
                [new UiAutomationControl("edit", "Edit", "Document", true, false, false, false, true, false)]);
        }
        finally { Interlocked.Decrement(ref Active); }
    }

    private void UpdatePeak(int value)
    {
        int previous;
        do
        {
            previous = Volatile.Read(ref PeakActive);
            if (value <= previous) return;
        } while (Interlocked.CompareExchange(ref PeakActive, value, previous) != previous);
    }

    public void Act(UiAutomationControl control, UiAutomationAction action, string? value,
        CancellationToken cancellationToken) => cancellationToken.ThrowIfCancellationRequested();

    public void Release() => _release.Set();

    public void Dispose() => _release.Dispose();
}

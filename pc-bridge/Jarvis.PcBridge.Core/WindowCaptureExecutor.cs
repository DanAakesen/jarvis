namespace Jarvis.PcBridge.Core;

public enum WindowPointAction
{
    Click,
    ScrollUp,
    ScrollDown,
}

public sealed class WindowCaptureRefusedException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

public sealed record WindowCaptureFrame(
    string Application,
    string WindowId,
    int Left,
    int Top,
    int WindowWidth,
    int WindowHeight,
    int Width,
    int Height,
    byte[] Png);

public sealed record WindowCaptureResult(
    string SnapshotId,
    string Application,
    int Width,
    int Height,
    string Png);

public interface IWindowCaptureProvider
{
    WindowCaptureFrame? Capture(CancellationToken cancellationToken);
    void ActAt(WindowCaptureFrame frame, int x, int y, WindowPointAction action, CancellationToken cancellationToken);
}

public sealed class WindowCaptureExecutor(IWindowCaptureProvider provider)
{
    private const int MaxImageWidth = 1280;
    private const int MaxImageHeight = 720;
    private const int MaxPngBytes = 750_000;
    private static readonly TimeSpan SnapshotLifetime = TimeSpan.FromSeconds(30);
    private static readonly byte[] PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    private SnapshotState? _snapshot;

    public WindowCaptureResult Capture(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var frame = provider.Capture(cancellationToken);
        if (frame is null) throw new WindowCaptureRefusedException("not_found");

        try
        {
            if (!IsValidFrame(frame)) throw new WindowCaptureRefusedException("failed");
            var id = Guid.NewGuid().ToString("D");
            _snapshot = new SnapshotState(id, frame, DateTimeOffset.UtcNow);
            return new WindowCaptureResult(id, frame.Application, frame.Width, frame.Height,
                Convert.ToBase64String(frame.Png));
        }
        finally
        {
            Array.Clear(frame.Png);
        }
    }

    public void ActAt(
        string snapshotId,
        int x,
        int y,
        WindowPointAction action,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var snapshot = _snapshot;
        if (snapshot is null || snapshot.Id != snapshotId ||
            DateTimeOffset.UtcNow - snapshot.CreatedAt > SnapshotLifetime)
        {
            throw new WindowCaptureRefusedException("stale");
        }
        if (x < 0 || x >= snapshot.Frame.Width || y < 0 || y >= snapshot.Frame.Height)
            throw new WindowCaptureRefusedException("not_allowed");

        _snapshot = null;
        provider.ActAt(snapshot.Frame, x, y, action, cancellationToken);
    }

    private static bool IsValidFrame(WindowCaptureFrame frame) =>
        frame.Application.Length is > 0 and <= 128 &&
        UiAutomationPolicy.IsAllowedApplication(frame.Application) &&
        frame.WindowId.Length is > 0 and <= 32 &&
        frame.WindowWidth is > 0 and <= 16_384 &&
        frame.WindowHeight is > 0 and <= 16_384 &&
        frame.Width is > 0 and <= MaxImageWidth &&
        frame.Height is > 0 and <= MaxImageHeight &&
        frame.Png.Length is >= 8 and <= MaxPngBytes &&
        frame.Png.AsSpan(0, PngSignature.Length).SequenceEqual(PngSignature);

    private sealed record SnapshotState(string Id, WindowCaptureFrame Frame, DateTimeOffset CreatedAt);
}

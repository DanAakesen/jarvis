using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class WindowCaptureExecutorTests
{
    private static readonly byte[] Png = [137, 80, 78, 71, 13, 10, 26, 10, 1];

    [Fact]
    public void Captures_bounded_png_and_uses_one_fresh_window_relative_point()
    {
        var frame = Frame();
        var provider = new FakeWindowCaptureProvider(frame);
        var executor = new WindowCaptureExecutor(provider);

        var capture = executor.Capture(CancellationToken.None);

        Assert.Equal("PuzzleGame", capture.Application);
        Assert.Equal(1280, capture.Width);
        Assert.Equal(720, capture.Height);
        Assert.Equal(Png, Convert.FromBase64String(capture.Png));
        Assert.All(frame.Png, value => Assert.Equal(0, value));

        executor.ActAt(capture.SnapshotId, 1279, 719, WindowPointAction.Click, CancellationToken.None);
        Assert.Equal((1279, 719, WindowPointAction.Click), provider.Action);
        Assert.Throws<WindowCaptureRefusedException>(() =>
            executor.ActAt(capture.SnapshotId, 0, 0, WindowPointAction.Click, CancellationToken.None));
    }

    [Theory]
    [InlineData(-1, 0)]
    [InlineData(1280, 0)]
    [InlineData(0, -1)]
    [InlineData(0, 720)]
    public void Rejects_coordinates_outside_the_captured_window(int x, int y)
    {
        var executor = new WindowCaptureExecutor(new FakeWindowCaptureProvider(Frame()));
        var capture = executor.Capture(CancellationToken.None);

        Assert.Throws<WindowCaptureRefusedException>(() =>
            executor.ActAt(capture.SnapshotId, x, y, WindowPointAction.ScrollDown, CancellationToken.None));
    }

    [Fact]
    public void Rejects_invalid_capture_frames()
    {
        var frame = Frame() with { Png = [1, 2, 3] };
        var executor = new WindowCaptureExecutor(new FakeWindowCaptureProvider(frame));

        Assert.Throws<WindowCaptureRefusedException>(() => executor.Capture(CancellationToken.None));
    }

    private static WindowCaptureFrame Frame() =>
        new("PuzzleGame", "42", -100, 20, 1920, 1080, 1280, 720, [.. Png]);

    private sealed class FakeWindowCaptureProvider(WindowCaptureFrame frame) : IWindowCaptureProvider
    {
        public (int X, int Y, WindowPointAction Action)? Action { get; private set; }

        public WindowCaptureFrame Capture(CancellationToken cancellationToken) => frame;

        public void ActAt(
            WindowCaptureFrame captured,
            int x,
            int y,
            WindowPointAction action,
            CancellationToken cancellationToken)
        {
            Action = (x, y, action);
        }
    }
}

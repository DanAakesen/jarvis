using System.Net.WebSockets;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class FakeCdpTargetTests
{
    private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(5);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Disposal_cancels_and_drains_pending_handlers_before_closing_the_listener(bool webSocket)
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var exited = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var target = await FakeCdpTarget.StartAsync();
        target.BeforeHandler = async (isWebSocket, token) =>
        {
            Assert.Equal(webSocket, isWebSocket);
            using var registration = token.Register(() => cancelled.SetResult());
            entered.SetResult();
            try
            {
                await release.Task;
                token.ThrowIfCancellationRequested();
            }
            finally { exited.SetResult(); }
        };

        using var http = new HttpClient();
        using var socket = new ClientWebSocket();
        Task client;
        if (webSocket)
        {
            await socket.ConnectAsync(WebSocketUri(target), CancellationToken.None).WaitAsync(Deadline);
            client = socket.ReceiveAsync(new byte[128], CancellationToken.None);
        }
        else
        {
            client = http.GetAsync(target.TargetsUri);
        }

        Task? disposal = null;
        try
        {
            await entered.Task.WaitAsync(Deadline);
            disposal = target.DisposeAsync().AsTask();
            await cancelled.Task.WaitAsync(Deadline);
            Assert.True(target.IsListening);
            Assert.False(disposal.IsCompleted);
            release.SetResult();
            await disposal.WaitAsync(Deadline);
            Assert.True(exited.Task.IsCompletedSuccessfully);
            Assert.False(target.IsListening);
            var error = await Record.ExceptionAsync(() => client.WaitAsync(Deadline));
            if (webSocket)
                Assert.IsType<WebSocketException>(error);
            else
                Assert.IsType<HttpRequestException>(error);
        }
        finally
        {
            release.TrySetResult();
            if (disposal is not null)
                await disposal.WaitAsync(Deadline);
            else
                await target.DisposeAsync().AsTask().WaitAsync(Deadline);
            await Record.ExceptionAsync(() => client.WaitAsync(Deadline));
        }
    }

    [Fact]
    public async Task Disposal_reports_unexpected_handler_faults()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var failure = new InvalidOperationException("Controlled handler failure.");
        var target = await FakeCdpTarget.StartAsync();
        target.BeforeHandler = (_, _) =>
        {
            entered.SetResult();
            return Task.FromException(failure);
        };
        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(WebSocketUri(target), CancellationToken.None).WaitAsync(Deadline);
        await entered.Task.WaitAsync(Deadline);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => target.DisposeAsync().AsTask().WaitAsync(Deadline));

        Assert.Same(failure, error);
        Assert.False(target.IsListening);
    }

    private static Uri WebSocketUri(FakeCdpTarget target) =>
        new UriBuilder(target.TargetsUri) { Scheme = "ws", Path = "/devtools/page/tab_1" }.Uri;
}

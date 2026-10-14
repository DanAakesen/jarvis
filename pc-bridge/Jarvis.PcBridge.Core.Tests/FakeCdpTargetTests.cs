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

    [Theory]
    [InlineData(false, "handler")]
    [InlineData(true, "handler")]
    [InlineData(true, "cancellation")]
    [InlineData(true, "socket")]
    [InlineData(true, "disposed")]
    public async Task Disposal_reports_unexpected_handler_faults(bool webSocket, string kind)
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Exception failure = kind switch
        {
            "cancellation" => new OperationCanceledException(new CancellationToken(true)),
            "socket" => new WebSocketException(WebSocketError.InvalidMessageType),
            "disposed" => new ObjectDisposedException("System.Net.Sockets.NetworkStream"),
            _ => new InvalidOperationException("Controlled handler failure."),
        };
        var target = await FakeCdpTarget.StartAsync();
        target.BeforeHandler = (_, _) =>
        {
            entered.SetResult();
            return Task.FromException(failure);
        };
        using var http = new HttpClient();
        using var socket = new ClientWebSocket();
        Task? request = null;
        if (webSocket)
            await socket.ConnectAsync(WebSocketUri(target), CancellationToken.None).WaitAsync(Deadline);
        else
            request = http.GetAsync(target.TargetsUri);
        await entered.Task.WaitAsync(Deadline);

        var error = await Record.ExceptionAsync(() => target.DisposeAsync().AsTask().WaitAsync(Deadline));

        Assert.Same(failure, error);
        Assert.False(target.IsListening);
        if (request is not null)
            Assert.IsType<HttpRequestException>(await Record.ExceptionAsync(() => request.WaitAsync(Deadline)));
    }

    [Fact]
    public async Task Disposal_drains_all_concurrent_http_and_websocket_handlers()
    {
        var httpEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var socketEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var httpCancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var socketCancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseHttp = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseSocket = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var httpExited = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var socketExited = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var target = await FakeCdpTarget.StartAsync();
        target.BeforeHandler = async (webSocket, token) =>
        {
            using var registration = token.Register(
                () => (webSocket ? socketCancelled : httpCancelled).SetResult());
            (webSocket ? socketEntered : httpEntered).SetResult();
            try
            {
                await (webSocket ? releaseSocket : releaseHttp).Task;
                token.ThrowIfCancellationRequested();
            }
            finally { (webSocket ? socketExited : httpExited).SetResult(); }
        };
        using var http = new HttpClient();
        using var socket = new ClientWebSocket();
        var request = http.GetAsync(target.TargetsUri);
        Task? disposal = null;
        try
        {
            await httpEntered.Task.WaitAsync(Deadline);
            await socket.ConnectAsync(WebSocketUri(target), CancellationToken.None).WaitAsync(Deadline);
            await socketEntered.Task.WaitAsync(Deadline);
            disposal = target.DisposeAsync().AsTask();
            await Task.WhenAll(httpCancelled.Task, socketCancelled.Task).WaitAsync(Deadline);
            releaseHttp.SetResult();
            await httpExited.Task.WaitAsync(Deadline);
            Assert.False(disposal.IsCompleted);
            Assert.True(target.IsListening);
            releaseSocket.SetResult();
            await disposal.WaitAsync(Deadline);
            Assert.True(socketExited.Task.IsCompletedSuccessfully);
            Assert.False(target.IsListening);
            Assert.IsType<HttpRequestException>(await Record.ExceptionAsync(() => request.WaitAsync(Deadline)));
        }
        finally
        {
            releaseHttp.TrySetResult();
            releaseSocket.TrySetResult();
            await (disposal ?? target.DisposeAsync().AsTask()).WaitAsync(Deadline);
            await Record.ExceptionAsync(() => request.WaitAsync(Deadline));
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Disposal_finishes_after_client_websocket_closure(bool graceful)
    {
        var target = await FakeCdpTarget.StartAsync();
        using var socket = new ClientWebSocket();
        try
        {
            await socket.ConnectAsync(WebSocketUri(target), CancellationToken.None).WaitAsync(Deadline);
            if (graceful)
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None)
                    .WaitAsync(Deadline);
                Assert.Equal(WebSocketState.Closed, socket.State);
            }
            else
            {
                socket.Abort();
            }
        }
        finally
        {
            await target.DisposeAsync().AsTask().WaitAsync(Deadline);
        }

        Assert.False(target.IsListening);
    }

    private static Uri WebSocketUri(FakeCdpTarget target) =>
        new UriBuilder(target.TargetsUri) { Scheme = "ws", Path = "/devtools/page/tab_1" }.Uri;
}

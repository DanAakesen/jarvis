using System.Buffers.Binary;
using System.IO.Pipes;
using System.Text.Json;
using Jarvis.PcBridge;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class NativeMessagingBrowserPortTests
{
    [Fact]
    public async Task Disposal_closes_connected_idle_extension_without_waiting_for_another_frame()
    {
        var pipeName = $"Jarvis.PcBridge.Test.{Guid.NewGuid():N}";
        var port = new NativeMessagingBrowserPort(pipeName);
        Task? disposing = null;
        await using var extension = new NamedPipeClientStream(
            ".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        try
        {
            await extension.ConnectAsync(5000);
            await WaitUntilConnectedAsync(port);
            Assert.True(port.IsConnected);

            // The healthy idle read has no artificial disconnect deadline.
            disposing = port.DisposeAsync().AsTask();
            await disposing.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(port.IsConnected);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            Assert.Equal(0, await extension.ReadAsync(new byte[1], deadline.Token));
        }
        finally
        {
            extension.Dispose();
            await (disposing ?? port.DisposeAsync().AsTask()).WaitAsync(TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public async Task Disposal_completes_pending_request_when_connected_extension_stops_responding()
    {
        var pipeName = $"Jarvis.PcBridge.Test.{Guid.NewGuid():N}";
        var port = new NativeMessagingBrowserPort(pipeName);
        Task? disposing = null;
        await using var extension = new NamedPipeClientStream(
            ".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        try
        {
            await extension.ConnectAsync(5000);
            await WaitUntilConnectedAsync(port);
            var request = port.ListTabsAsync(0, 20, CancellationToken.None);
            using var frame = await ReadMessageAsync(extension);
            Assert.Equal("list_tabs", frame.RootElement.GetProperty("type").GetString());
            disposing = port.DisposeAsync().AsTask();
            await disposing.WaitAsync(TimeSpan.FromSeconds(5));
            var failure = await Record.ExceptionAsync(() => request.WaitAsync(TimeSpan.FromSeconds(5)));
            Assert.True(failure is OperationCanceledException ||
                failure is BrowserActionRefusedException { Code: "not_found" });
        }
        finally
        {
            extension.Dispose();
            await (disposing ?? port.DisposeAsync().AsTask()).WaitAsync(TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public async Task Competing_pipe_owner_backs_off_and_disposal_cancels_retry_without_disrupting_owner()
    {
        var pipeName = $"Jarvis.PcBridge.Test.{Guid.NewGuid():N}";
        using var owner = new NamedPipeServerStream(
            pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
            OperatingSystem.IsWindows() ? PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly : PipeOptions.Asynchronous);
        var creating = Task.Run(() => new NativeMessagingBrowserPort(pipeName));
        NativeMessagingBrowserPort? competitor = null;
        Task? disposing = null;
        try
        {
            // Without the asynchronous backoff the constructor spins until the owner closes.
            competitor = await creating.WaitAsync(TimeSpan.FromSeconds(5));
            disposing = competitor.DisposeAsync().AsTask();
            await disposing.WaitAsync(TimeSpan.FromSeconds(5));
            await using var client = new NamedPipeClientStream(
                ".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var accepting = owner.WaitForConnectionAsync(deadline.Token);
            await client.ConnectAsync(deadline.Token);
            await accepting;
            Assert.True(owner.IsConnected);
        }
        finally
        {
            owner.Dispose();
            competitor ??= await creating.WaitAsync(TimeSpan.FromSeconds(5));
            await (disposing ?? competitor.DisposeAsync().AsTask()).WaitAsync(TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public async Task Requests_a_validated_active_foreground_extension_tab()
    {
        var pipeName = $"Jarvis.PcBridge.Test.{Guid.NewGuid():N}";
        await using var port = new NativeMessagingBrowserPort(pipeName);
        await using var extension = new NamedPipeClientStream(
            ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous);
        await extension.ConnectAsync(5000);
        await WaitUntilConnectedAsync(port);

        var openTask = port.OpenUrlAsync("https://google.com", CancellationToken.None);
        using (var request = await ReadMessageAsync(extension))
        {
            Assert.Equal("open_url", request.RootElement.GetProperty("type").GetString());
            Assert.Equal("https://google.com/", request.RootElement.GetProperty("url").GetString());
            await RespondAsync(extension, request.RootElement.GetProperty("id").GetString()!,
                """{"opened":true,"focused":true}""");
        }
        await openTask;

        await Assert.ThrowsAsync<BrowserActionRefusedException>(() =>
            port.OpenUrlAsync("javascript:alert(1)", CancellationToken.None));
    }

    [Fact]
    public async Task Correlates_tab_cdp_and_detach_messages_with_a_fake_extension_port()
    {
        var pipeName = $"Jarvis.PcBridge.Test.{Guid.NewGuid():N}";
        await using var port = new NativeMessagingBrowserPort(pipeName);
        await using var extension = new NamedPipeClientStream(
            ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous);
        await extension.ConnectAsync(5000);
        await WaitUntilConnectedAsync(port);

        var tabsTask = port.ListTabsAsync(20, 20, CancellationToken.None);
        using (var request = await ReadMessageAsync(extension))
        {
            Assert.Equal("list_tabs", request.RootElement.GetProperty("type").GetString());
            Assert.Equal(20, request.RootElement.GetProperty("offset").GetInt32());
            Assert.Equal(20, request.RootElement.GetProperty("limit").GetInt32());
            await RespondAsync(extension, request.RootElement.GetProperty("id").GetString()!,
                """{"tabs":[{"id":"tab_21","title":"Search","url":"https://example.test","focused":true}],"nextOffset":null}""");
        }

        var page = await tabsTask;
        Assert.Equal("tab_21", Assert.Single(page.Tabs).Id);
        Assert.Null(page.NextOffset);

        using var parameters = JsonDocument.Parse("""{"expression":"fixed snapshot"}""");
        var commandTask = port.SendCommandAsync("tab_21", "Runtime.evaluate", parameters.RootElement, CancellationToken.None);
        using (var request = await ReadMessageAsync(extension))
        {
            Assert.Equal("cdp", request.RootElement.GetProperty("type").GetString());
            Assert.Equal("tab_21", request.RootElement.GetProperty("tabId").GetString());
            Assert.Equal("Runtime.evaluate", request.RootElement.GetProperty("method").GetString());
            await RespondAsync(extension, request.RootElement.GetProperty("id").GetString()!,
                """{"result":{"type":"object","objectId":"node_1"}}""");
        }

        using var cdpResponse = await commandTask;
        Assert.Equal("node_1", cdpResponse.RootElement.GetProperty("result").GetProperty("result")
            .GetProperty("objectId").GetString());

        await Assert.ThrowsAsync<BrowserActionRefusedException>(() =>
            port.SendCommandAsync("tab_21", "Runtime.runIfWaitingForDebugger", parameters.RootElement, CancellationToken.None));

        var detachTask = port.DetachAsync("tab_21", CancellationToken.None);
        using (var request = await ReadMessageAsync(extension))
        {
            Assert.Equal("detach", request.RootElement.GetProperty("type").GetString());
            await RespondAsync(extension, request.RootElement.GetProperty("id").GetString()!, "{}");
        }
        await detachTask;
    }

    [Fact]
    public async Task Rejects_malformed_tab_pages_from_the_extension()
    {
        var pipeName = $"Jarvis.PcBridge.Test.{Guid.NewGuid():N}";
        await using var port = new NativeMessagingBrowserPort(pipeName);
        await using var extension = new NamedPipeClientStream(
            ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous);
        await extension.ConnectAsync(5000);
        await WaitUntilConnectedAsync(port);

        var tabsTask = port.ListTabsAsync(0, 1, CancellationToken.None);
        using (var request = await ReadMessageAsync(extension))
        {
            await RespondAsync(extension, request.RootElement.GetProperty("id").GetString()!,
                """{"tabs":[{"id":"not-a-tab","title":"Bad","url":"https://example.test","focused":false}],"nextOffset":null}""");
        }

        await Assert.ThrowsAsync<BrowserActionRefusedException>(() => tabsTask);
    }

    [Fact]
    public async Task Relays_closed_tab_events_from_the_extension()
    {
        var pipeName = $"Jarvis.PcBridge.Test.{Guid.NewGuid():N}";
        await using var port = new NativeMessagingBrowserPort(pipeName);
        await using var extension = new NamedPipeClientStream(
            ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous);
        await extension.ConnectAsync(5000);
        await WaitUntilConnectedAsync(port);
        var removed = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        port.TabRemoved += tabId => removed.TrySetResult(tabId);

        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            id = Guid.NewGuid().ToString("D"),
            type = "event",
            @event = "tab_removed",
            tabId = "tab_21",
        });
        await WriteFrameAsync(extension, payload);

        Assert.Equal("tab_21", await removed.Task.WaitAsync(TimeSpan.FromSeconds(5)));
    }

    // The server registers its connection after WaitForConnectionAsync resumes, which can lag the
    // client's ConnectAsync (notably on Linux). Sending before that is refused, so wait for it.
    private static async Task WaitUntilConnectedAsync(NativeMessagingBrowserPort port)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!port.IsConnected)
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("The browser port did not register the connection.");
            await Task.Delay(10);
        }
    }

    private static async Task<JsonDocument> ReadMessageAsync(Stream stream)
    {
        var header = new byte[sizeof(int)];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await stream.ReadExactlyAsync(header, timeout.Token);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        Assert.InRange(length, 1, BridgeProtocol.MaxMessageBytes);
        var payload = new byte[length];
        await stream.ReadExactlyAsync(payload, timeout.Token);
        return JsonDocument.Parse(payload);
    }

    private static async Task RespondAsync(Stream stream, string id, string result)
    {
        using var document = JsonDocument.Parse(result);
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            id,
            type = "result",
            result = document.RootElement,
        });
        await WriteFrameAsync(stream, payload);
    }

    private static async Task WriteFrameAsync(Stream stream, byte[] payload)
    {
        var header = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(header, payload.Length);
        await stream.WriteAsync(header);
        await stream.WriteAsync(payload);
        await stream.FlushAsync();
    }
}

using System.Buffers.Binary;
using System.IO.Pipes;
using System.Text.Json;
using Jarvis.PcBridge;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class NativeMessagingBrowserPortTests
{
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

    private static async Task<JsonDocument> ReadMessageAsync(Stream stream)
    {
        var header = new byte[sizeof(int)];
        await stream.ReadExactlyAsync(header);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        Assert.InRange(length, 1, BridgeProtocol.MaxMessageBytes);
        var payload = new byte[length];
        await stream.ReadExactlyAsync(payload);
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

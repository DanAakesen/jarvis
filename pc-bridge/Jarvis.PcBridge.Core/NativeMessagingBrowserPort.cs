using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

public sealed class NativeMessagingBrowserPort : IExtensionBrowserPort, IAsyncDisposable
{
    public const string PipeName = "Jarvis.PcBridge.ChromeExtension";
    private const int MaxMessageBytes = BridgeProtocol.MaxMessageBytes;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> CdpMethods = new(StringComparer.Ordinal)
    {
        "Runtime.evaluate",
        "Runtime.getProperties",
        "Runtime.callFunctionOn",
        "Runtime.releaseObjectGroup",
    };

    private readonly CancellationTokenSource _stopping = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonDocument>> _pending = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly Task _acceptLoop;
    private volatile NamedPipeServerStream? _connection;

    public NativeMessagingBrowserPort() => _acceptLoop = AcceptLoopAsync();

    public bool IsConnected => _connection?.IsConnected == true;
    public event Action<string>? TabRemoved;

    public async Task OpenUrlAsync(string url, CancellationToken cancellationToken)
    {
        if (!CommandPolicy.TryNormalizeUrl(url, out var normalized))
            throw new BrowserActionRefusedException("not_allowed");

        using var response = await RequestAsync(new { type = "open_url", url = normalized }, cancellationToken)
            .ConfigureAwait(false);
        ThrowIfError(response.RootElement);
        if (response.RootElement.GetProperty("type").GetString() != "result" ||
            !response.RootElement.TryGetProperty("result", out var result) ||
            result.ValueKind != JsonValueKind.Object ||
            result.EnumerateObject().Count() != 2 ||
            !result.TryGetProperty("opened", out var opened) || opened.ValueKind != JsonValueKind.True ||
            !result.TryGetProperty("focused", out var focused) || focused.ValueKind != JsonValueKind.True)
        {
            throw new BrowserActionRefusedException("failed");
        }
    }

    public async Task<BrowserTabPage> ListTabsAsync(
        int offset,
        int limit,
        CancellationToken cancellationToken)
    {
        if (offset is < 0 or > 5000 || limit is < 1 or > 20)
            throw new BrowserActionRefusedException("not_allowed");
        using var response = await RequestAsync(new { type = "list_tabs", offset, limit }, cancellationToken)
            .ConfigureAwait(false);
        ThrowIfError(response.RootElement);
        var result = response.RootElement.GetProperty("result");
        var tabElements = result.GetProperty("tabs").EnumerateArray().ToArray();
        if (tabElements.Length > limit) throw new BrowserActionRefusedException("failed");
        var tabs = tabElements
            .Select(tab => new BrowserTab(
                ReadBoundedString(tab, "id", 128),
                ReadBoundedString(tab, "title", 300),
                ReadBoundedString(tab, "url", 2048),
                tab.GetProperty("focused").ValueKind == JsonValueKind.True))
            .ToArray();
        if (tabs.Any(tab => !IsExtensionTabId(tab.Id)) ||
            tabElements.Any(tab => tab.GetProperty("focused").ValueKind is not (JsonValueKind.True or JsonValueKind.False)))
            throw new BrowserActionRefusedException("failed");
        var nextOffset = result.GetProperty("nextOffset");
        if (nextOffset.ValueKind is not (JsonValueKind.Number or JsonValueKind.Null))
            throw new BrowserActionRefusedException("failed");
        int? next = nextOffset.ValueKind == JsonValueKind.Number ? nextOffset.GetInt32() : null;
        if (next is < 0 or > 5000 || next is not null && next != offset + tabs.Length)
            throw new BrowserActionRefusedException("failed");
        return new BrowserTabPage(tabs, next);
    }

    public async Task<JsonDocument> SendCommandAsync(
        string tabId,
        string method,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        if (!IsExtensionTabId(tabId) || !CdpMethods.Contains(method) || parameters.ValueKind != JsonValueKind.Object)
            throw new BrowserActionRefusedException("not_allowed");

        using var response = await RequestAsync(new
        {
            type = "cdp",
            tabId,
            method,
            parameters,
        }, cancellationToken).ConfigureAwait(false);
        if (response.RootElement.GetProperty("type").GetString() == "error")
            throw new BrowserActionRefusedException(ReadError(response.RootElement));

        var result = response.RootElement.GetProperty("result");
        using var output = new MemoryStream();
        using (var writer = new Utf8JsonWriter(output))
        {
            writer.WriteStartObject();
            writer.WriteNumber("id", 1);
            writer.WritePropertyName("result");
            result.WriteTo(writer);
            writer.WriteEndObject();
        }
        return JsonDocument.Parse(output.ToArray());
    }

    public async Task DetachAsync(string tabId, CancellationToken cancellationToken)
    {
        if (!IsExtensionTabId(tabId)) return;
        using var response = await RequestAsync(new { type = "detach", tabId }, cancellationToken).ConfigureAwait(false);
        ThrowIfError(response.RootElement);
    }

    private async Task<JsonDocument> RequestAsync(object request, CancellationToken cancellationToken)
    {
        var connection = _connection;
        if (connection?.IsConnected != true) throw new BrowserActionRefusedException("not_found");

        var id = Guid.NewGuid().ToString("D");
        var message = JsonSerializer.SerializeToNode(request, JsonOptions)!.AsObject();
        message["id"] = id;
        var payload = JsonSerializer.SerializeToUtf8Bytes(message, JsonOptions);
        if (payload.Length > MaxMessageBytes) throw new BrowserActionRefusedException("failed");
        var completion = new TaskCompletionSource<JsonDocument>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(id, completion)) throw new BrowserActionRefusedException("failed");
        try
        {
            await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (!ReferenceEquals(connection, _connection) || !connection.IsConnected)
                    throw new BrowserActionRefusedException("not_found");
                await WriteFrameAsync(connection, payload, cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                _writeGate.Release();
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _stopping.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            try
            {
                return await completion.Task.WaitAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && !_stopping.IsCancellationRequested)
            {
                throw new BrowserActionRefusedException("failed");
            }
        }
        catch (BrowserActionRefusedException) { throw; }
        catch (OperationCanceledException) { throw; }
        catch { throw new BrowserActionRefusedException("not_found"); }
        finally
        {
            _pending.TryRemove(id, out _);
        }
    }

    private async Task AcceptLoopAsync()
    {
        while (!_stopping.IsCancellationRequested)
        {
            await using var pipe = new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                OperatingSystem.IsWindows()
                    ? PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly
                    : PipeOptions.Asynchronous);
            try
            {
                await pipe.WaitForConnectionAsync(_stopping.Token).ConfigureAwait(false);
                _connection = pipe;
                await ReadResponsesAsync(pipe, _stopping.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
            {
                return;
            }
            catch (IOException) when (_stopping.IsCancellationRequested)
            {
                return;
            }
            catch
            {
            }
            finally
            {
                if (ReferenceEquals(_connection, pipe)) _connection = null;
                FailPending();
            }
        }
    }

    private async Task ReadResponsesAsync(Stream stream, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var payload = await ReadFrameAsync(stream, cancellationToken).ConfigureAwait(false);
            if (payload is null) return;
            using var message = JsonDocument.Parse(payload);
            var root = message.RootElement;
            var type = root.TryGetProperty("type", out var typeValue) ? typeValue.GetString() : null;
            if (type == "event")
            {
                if (root.TryGetProperty("event", out var eventValue) &&
                    eventValue.GetString() == "tab_removed" &&
                    root.TryGetProperty("tabId", out var tabValue) &&
                    tabValue.ValueKind == JsonValueKind.String &&
                    IsExtensionTabId(tabValue.GetString()!))
                {
                    TabRemoved?.Invoke(tabValue.GetString()!);
                }
                continue;
            }
            if (!root.TryGetProperty("id", out var idValue) ||
                idValue.ValueKind != JsonValueKind.String ||
                !Guid.TryParseExact(idValue.GetString(), "D", out _) ||
                !_pending.TryGetValue(idValue.GetString()!, out var completion))
            {
                continue;
            }

            if (type is not ("result" or "error")) continue;
            completion.TrySetResult(JsonDocument.Parse(root.GetRawText()));
        }
    }

    private void FailPending()
    {
        foreach (var completion in _pending.Values)
            completion.TrySetException(new BrowserActionRefusedException("not_found"));
    }

    private static async Task WriteFrameAsync(Stream stream, byte[] payload, CancellationToken cancellationToken)
    {
        var header = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(header, payload.Length);
        await stream.WriteAsync(header, cancellationToken).ConfigureAwait(false);
        await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    internal static async Task<byte[]?> ReadFrameAsync(Stream stream, CancellationToken cancellationToken)
    {
        var header = new byte[sizeof(int)];
        var firstByte = await stream.ReadAsync(header.AsMemory(0, 1), cancellationToken).ConfigureAwait(false);
        if (firstByte == 0) return null;
        await stream.ReadExactlyAsync(header.AsMemory(1), cancellationToken).ConfigureAwait(false);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length is <= 0 or > MaxMessageBytes) throw new InvalidDataException("Invalid native messaging frame.");
        var payload = new byte[length];
        await stream.ReadExactlyAsync(payload, cancellationToken).ConfigureAwait(false);
        return payload;
    }

    private static string ReadBoundedString(JsonElement element, string property, int maximum)
    {
        var value = element.GetProperty(property).GetString() ?? string.Empty;
        if (value.Length > maximum || value.Any(char.IsControl)) throw new InvalidDataException("Invalid extension response.");
        return value;
    }

    private static string ReadError(JsonElement root)
    {
        var error = root.TryGetProperty("error", out var value) ? value.GetString() : null;
        return error is "not_found" or "failed" or "not_allowed" or "browser_off" or "blocked" or "stale" or "covered"
            ? error
            : "failed";
    }

    private static void ThrowIfError(JsonElement root)
    {
        if (root.TryGetProperty("type", out var type) && type.GetString() == "error")
            throw new BrowserActionRefusedException(ReadError(root));
    }

    private static bool IsExtensionTabId(string value) =>
        value.StartsWith("tab_", StringComparison.Ordinal) &&
        value.Length is > 4 and <= 14 &&
        value.AsSpan(4).ToString().All(char.IsAsciiDigit);

    public async ValueTask DisposeAsync()
    {
        _stopping.Cancel();
        _connection?.Dispose();
        try { await _acceptLoop.ConfigureAwait(false); }
        catch (OperationCanceledException) { }
        FailPending();
        _writeGate.Dispose();
        _stopping.Dispose();
    }
}

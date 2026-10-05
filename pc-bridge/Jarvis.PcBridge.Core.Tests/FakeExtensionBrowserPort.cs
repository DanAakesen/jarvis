using System.Net.WebSockets;
using System.Text.Json;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

internal sealed class FakeExtensionBrowserPort(FakeCdpTarget target) : IExtensionBrowserPort, IAsyncDisposable
{
    private readonly Dictionary<string, ClientWebSocket> _sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SemaphoreSlim> _gates = new(StringComparer.Ordinal);
    private int _nextId;
    private bool _tabAvailable = true;

    public bool IsConnected { get; set; } = true;
    public int DetachCount { get; private set; }
    public int SessionCount => _sessions.Count;
    public List<string> Methods { get; } = [];
    public event Action<string>? TabRemoved;

    public Task<BrowserTabPage> ListTabsAsync(int offset, int limit, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        IReadOnlyList<BrowserTab> tabs = offset == 0 && IsConnected && _tabAvailable
            ? [new BrowserTab("tab_1", "Search", "https://example.test/search", true)]
            : [];
        return Task.FromResult(new BrowserTabPage(tabs, null));
    }

    public void RemoveTab(string tabId)
    {
        _tabAvailable = false;
        if (_sessions.Remove(tabId, out var socket)) socket.Dispose();
        if (_gates.Remove(tabId, out var gate)) gate.Dispose();
        TabRemoved?.Invoke(tabId);
    }

    public async Task<JsonDocument> SendCommandAsync(
        string tabId,
        string method,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        if (!IsConnected) throw new BrowserActionRefusedException("not_found");
        if (!string.Equals(tabId, "tab_1", StringComparison.Ordinal))
            throw new BrowserActionRefusedException("not_found");

        if (!_sessions.TryGetValue(tabId, out var socket) || socket.State != WebSocketState.Open)
        {
            using var httpClient = new HttpClient();
            var targets = await httpClient.GetStringAsync(target.TargetsUri, cancellationToken);
            using var document = JsonDocument.Parse(targets);
            var endpoint = new Uri(document.RootElement[0].GetProperty("webSocketDebuggerUrl").GetString()!);
            socket = new ClientWebSocket();
            await socket.ConnectAsync(endpoint, cancellationToken);
            _sessions[tabId] = socket;
            _gates[tabId] = new SemaphoreSlim(1, 1);
        }

        var gate = _gates[tabId];
        await gate.WaitAsync(cancellationToken);
        try
        {
            var id = Interlocked.Increment(ref _nextId);
            Methods.Add(method);
            var payload = JsonSerializer.SerializeToUtf8Bytes(new { id, method, @params = parameters });
            await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
            var buffer = new byte[8192];
            using var message = new MemoryStream();
            while (true)
            {
                message.SetLength(0);
                WebSocketReceiveResult received;
                do
                {
                    received = await socket.ReceiveAsync(buffer, cancellationToken);
                    if (received.MessageType == WebSocketMessageType.Close)
                        throw new BrowserActionRefusedException("not_found");
                    message.Write(buffer, 0, received.Count);
                } while (!received.EndOfMessage);

                using var response = JsonDocument.Parse(message.GetBuffer().AsMemory(0, checked((int)message.Length)));
                if (!response.RootElement.TryGetProperty("id", out var responseId) ||
                    responseId.GetInt32() != id)
                    continue;
                return JsonDocument.Parse(response.RootElement.GetRawText());
            }
        }
        finally
        {
            gate.Release();
        }
    }

    public Task DetachAsync(string tabId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (_sessions.Remove(tabId, out var socket)) socket.Dispose();
        if (_gates.Remove(tabId, out var gate)) gate.Dispose();
        DetachCount++;
        return Task.CompletedTask;
    }

    public ValueTask DisposeAsync()
    {
        foreach (var socket in _sessions.Values) socket.Dispose();
        foreach (var gate in _gates.Values) gate.Dispose();
        _sessions.Clear();
        _gates.Clear();
        return ValueTask.CompletedTask;
    }
}

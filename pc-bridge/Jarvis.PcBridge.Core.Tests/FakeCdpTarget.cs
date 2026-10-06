using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Jarvis.PcBridge.Core.Tests;

internal sealed class FakeCdpTarget : IAsyncDisposable
{
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _stopping = new();
    private readonly Task _accepting;
    private readonly int _port;

    private FakeCdpTarget(string role, string name, string type, bool sensitive)
    {
        Role = role;
        Name = name;
        Type = type;
        Sensitive = sensitive;
        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        _port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        _listener.Prefixes.Add($"http://127.0.0.1:{_port}/");
        _listener.Start();
        _accepting = AcceptAsync();
    }

    public string Role { get; }
    public string Name { get; }
    public string Type { get; }
    public bool Sensitive { get; }
    public string? ActionStatus { get; set; }
    public List<string> Methods { get; } = [];
    public List<JsonElement> Calls { get; } = [];
    public Uri TargetsUri => new($"http://127.0.0.1:{_port}/json/list");

    public static Task<FakeCdpTarget> StartAsync(
        string role = "button",
        string name = "Continue",
        string type = "",
        bool sensitive = false) =>
        Task.FromResult(new FakeCdpTarget(role, name, type, sensitive));

    private async Task AcceptAsync()
    {
        while (!_stopping.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await _listener.GetContextAsync().WaitAsync(_stopping.Token); }
            catch (OperationCanceledException) { return; }
            catch (HttpListenerException) when (_stopping.IsCancellationRequested) { return; }

            if (context.Request.IsWebSocketRequest)
            {
                _ = HandleWebSocketAsync(context);
            }
            else
            {
                await WriteTargetsAsync(context);
            }
        }
    }

    private async Task WriteTargetsAsync(HttpListenerContext context)
    {
        context.Response.ContentType = "application/json";
        var json = JsonSerializer.SerializeToUtf8Bytes(new[]
        {
            new
            {
                id = "tab_1",
                type = "page",
                title = "Search",
                url = "https://example.test/search",
                webSocketDebuggerUrl = $"ws://127.0.0.1:{_port}/devtools/page/tab_1",
            },
        });
        context.Response.ContentLength64 = json.Length;
        await context.Response.OutputStream.WriteAsync(json, _stopping.Token);
        context.Response.Close();
    }

    private async Task HandleWebSocketAsync(HttpListenerContext context)
    {
        using var socket = (await context.AcceptWebSocketAsync(null)).WebSocket;
        var buffer = new byte[8192];
        using var message = new MemoryStream();
        while (!_stopping.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            message.SetLength(0);
            WebSocketReceiveResult received;
            do
            {
                received = await socket.ReceiveAsync(buffer, _stopping.Token);
                if (received.MessageType == WebSocketMessageType.Close) return;
                message.Write(buffer, 0, received.Count);
            } while (!received.EndOfMessage);

            using var request = JsonDocument.Parse(message.ToArray());
            var root = request.RootElement;
            var id = root.GetProperty("id").GetInt32();
            var method = root.GetProperty("method").GetString()!;
            Methods.Add(method);
            Calls.Add(root.Clone());
            var result = method switch
            {
                "Runtime.evaluate" => new { result = new { type = "object", objectId = "array_1" } },
                "Runtime.getProperties" => GetProperties(root.GetProperty("params").GetProperty("objectId").GetString()!),
                "Runtime.callFunctionOn" => CallFunction(root.GetProperty("params")),
                _ => (object)new { },
            };
            if (method == "Runtime.evaluate")
            {
                await socket.SendAsync(
                    """{"method":"Page.loadEventFired","params":{}}"""u8.ToArray(),
                    WebSocketMessageType.Text,
                    true,
                    _stopping.Token);
            }
            var response = JsonSerializer.SerializeToUtf8Bytes(new { id, result });
            await socket.SendAsync(response, WebSocketMessageType.Text, true, _stopping.Token);
        }
    }

    private object GetProperties(string objectId)
    {
        if (objectId == "array_1")
        {
            return new
            {
                result = new[]
                {
                    new { name = "0", value = new { type = "object", objectId = "entry_1" } },
                },
            };
        }

        var fingerprint = JsonSerializer.Serialize(new object?[]
        {
            Role,
            Name,
            Type == "password" || Role == "textbox" ? "INPUT" : "BUTTON",
            Type,
            "",
            "",
            "",
        });
        return new
        {
            result = new object[]
            {
                new { name = "node", value = new { type = "object", objectId = "node_1" } },
                new { name = "role", value = new { type = "string", value = Role } },
                new { name = "name", value = new { type = "string", value = Name } },
                new { name = "value", value = new { type = "string", value = "" } },
                new { name = "fingerprint", value = new { type = "string", value = fingerprint } },
                new { name = "sensitive", value = new { type = "boolean", value = Sensitive } },
            },
        };
    }

    private object CallFunction(JsonElement parameters)
    {
        var arguments = parameters.GetProperty("arguments").EnumerateArray().ToArray();
        var action = arguments[3].GetProperty("value").GetString();
        var confirmed = arguments[5].GetProperty("value").GetBoolean();
        var status = ActionStatus ??
        (BrowserActionPolicy.RequiresConfirmation(action ?? string.Empty, Name) && !confirmed
                ? "confirmation_required"
                : "acted");
        return new
        {
            result = new
            {
                type = "object",
                value = new
                {
                    status,
                    summary = $"Click \"{Name}\" in Chrome.",
                },
            },
        };
    }

    public async ValueTask DisposeAsync()
    {
        _stopping.Cancel();
        _listener.Stop();
        try { await _accepting; } catch (HttpListenerException) { }
        _listener.Close();
        _stopping.Dispose();
    }
}

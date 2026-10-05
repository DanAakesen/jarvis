using System.Text.Json;

namespace Jarvis.PcBridge.Core;

public interface IExtensionBrowserPort
{
    bool IsConnected { get; }
    event Action<string>? TabRemoved;

    Task<BrowserTabPage> ListTabsAsync(int offset, int limit, CancellationToken cancellationToken);

    Task<JsonDocument> SendCommandAsync(
        string tabId,
        string method,
        JsonElement parameters,
        CancellationToken cancellationToken);

    Task DetachAsync(string tabId, CancellationToken cancellationToken);
}

public sealed record BrowserTabPage(IReadOnlyList<BrowserTab> Tabs, int? NextOffset);

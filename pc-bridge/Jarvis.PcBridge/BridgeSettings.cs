using System.Text.Json;

namespace Jarvis.PcBridge;

public sealed record BridgeSettings(
    string BackendUrl,
    string TenantId,
    string ApiClientId,
    string BridgeClientId)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static string SettingsPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Jarvis",
        "PcBridge",
        "settings.json");

    public static BridgeSettings Load()
    {
        var settings = JsonSerializer.Deserialize<BridgeSettings>(File.ReadAllText(SettingsPath), JsonOptions);
        if (settings is null ||
            !Guid.TryParse(settings.TenantId, out _) ||
            !Guid.TryParse(settings.ApiClientId, out _) ||
            !Guid.TryParse(settings.BridgeClientId, out _) ||
            !TryBackendUri(settings.BackendUrl, out var backendUri))
        {
            throw new InvalidOperationException("The PC bridge configuration is missing or invalid.");
        }

        return settings with { BackendUrl = backendUri!.GetLeftPart(UriPartial.Authority) };
    }

    public static bool TryBackendUri(string? value, out Uri? uri)
    {
        uri = null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var candidate) ||
            candidate.UserInfo.Length > 0 || candidate.Query.Length > 0 || candidate.Fragment.Length > 0 ||
            candidate.AbsolutePath != "/")
        {
            return false;
        }

        var isLoopbackHttp = candidate.Scheme == Uri.UriSchemeHttp && candidate.IsLoopback;
        if (candidate.Scheme != Uri.UriSchemeHttps && !isLoopbackHttp) return false;

        uri = candidate;
        return true;
    }
}

using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jarvis.PcBridge;

public sealed record BridgeSettings(
    string BackendUrl,
    string TenantId,
    string ApiClientId,
    string BridgeClientId,
    bool BrowserEnabled = false,
    bool ControlPaused = false,
    string? WakeWordModelPath = null,
    bool? WakeWordEnabled = null,
    string? WebUrl = null)
{
    public const string ProductionWebUrl = "https://ambitious-mushroom-0161f9503.2.azurestaticapps.net/";

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
            !TryBackendUri(settings.BackendUrl, out var backendUri) ||
            settings.WebUrl is not null && !TryBackendUri(settings.WebUrl, out _))
        {
            throw new InvalidOperationException("The PC bridge configuration is missing or invalid.");
        }

        return settings with { BackendUrl = backendUri!.GetLeftPart(UriPartial.Authority) };
    }

    // Speech Studio keyword model (.table) for "Wake up Jarvis"; null when it is not configured or missing.
    [JsonIgnore]
    public string? ResolvedWakeWordModelPath =>
        !string.IsNullOrWhiteSpace(WakeWordModelPath) &&
        Path.IsPathFullyQualified(WakeWordModelPath) &&
        string.Equals(Path.GetExtension(WakeWordModelPath), ".table", StringComparison.OrdinalIgnoreCase) &&
        File.Exists(WakeWordModelPath)
            ? WakeWordModelPath
            : null;

    // The wake word defaults to on once a keyword model is configured.
    [JsonIgnore]
    public bool IsWakeWordOn => ResolvedWakeWordModelPath is not null && WakeWordEnabled != false;

    [JsonIgnore]
    public string JarvisWebUrl => WebUrl ?? ProductionWebUrl;

    public void Save()
    {
        var directory = Path.GetDirectoryName(SettingsPath)!;
        Directory.CreateDirectory(directory);
        var temporaryPath = $"{SettingsPath}.tmp";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(this, JsonOptions));
        File.Move(temporaryPath, SettingsPath, overwrite: true);
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

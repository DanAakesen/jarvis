using System.Text.Json;

namespace Jarvis.PcBridge.Core;

public static class CommandPolicy
{
    private static readonly HashSet<string> Apps = new(StringComparer.Ordinal)
    {
        "vscode",
        "edge",
        "explorer",
        "terminal",
    };

    public static bool IsValid(string command, JsonElement arguments)
    {
        if (arguments.ValueKind != JsonValueKind.Object) return false;

        return command switch
        {
            "open_url" => HasOnly(arguments, "url") &&
                arguments.TryGetProperty("url", out var url) &&
                url.ValueKind == JsonValueKind.String &&
                TryNormalizeUrl(url.GetString(), out _),
            "open_app" => HasOnly(arguments, "app") &&
                arguments.TryGetProperty("app", out var app) &&
                app.ValueKind == JsonValueKind.String &&
                Apps.Contains(app.GetString() ?? string.Empty),
            "open_folder" => HasOnly(arguments, "relativePath") &&
                arguments.TryGetProperty("relativePath", out var folder) &&
                folder.ValueKind == JsonValueKind.String &&
                TryNormalizeRepoPath(folder.GetString(), out _),
            "active_window" => !arguments.EnumerateObject().Any(),
            "focus_window" => HasOnly(arguments, "title") &&
                arguments.TryGetProperty("title", out var title) &&
                title.ValueKind == JsonValueKind.String &&
                IsWindowTitle(title.GetString()),
            _ => false,
        };
    }

    public static bool TryNormalizeUrl(string? value, out string normalized)
    {
        normalized = string.Empty;
        if (string.IsNullOrWhiteSpace(value) || value.Length > 2048 ||
            value.Any(char.IsControl) || !Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
            string.IsNullOrWhiteSpace(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo))
        {
            return false;
        }

        normalized = uri.AbsoluteUri;
        return true;
    }

    public static bool TryNormalizeRepoPath(string? value, out string normalized)
    {
        normalized = string.Empty;
        if (string.IsNullOrWhiteSpace(value) || value.Length > 512 ||
            value.Any(char.IsControl) || value.StartsWith('/') || value.StartsWith('\\') ||
            value.Contains(':') || value.Contains('*') || value.Contains('?') ||
            value.Contains('"') || value.Contains('<') || value.Contains('>') || value.Contains('|'))
        {
            return false;
        }

        var segments = value.Replace('/', '\\').Split('\\');
        if (segments.Length is 0 or > 16 ||
            segments.Any(segment => segment.Length == 0 ||
                segment is "." or ".." ||
                segment.EndsWith('.') ||
                segment.EndsWith(' ') ||
                IsReservedWindowsName(segment)))
        {
            return false;
        }

        normalized = string.Join('\\', segments);
        return true;
    }

    public static bool IsWindowTitle(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        value.Length <= 200 &&
        !value.Any(char.IsControl) &&
        value == value.Trim();

    private static bool HasOnly(JsonElement value, string property) =>
        value.EnumerateObject().Count() == 1 &&
        value.EnumerateObject().All(item => item.NameEquals(property));

    private static bool IsReservedWindowsName(string segment)
    {
        var baseName = segment.Split('.')[0];
        return baseName.Equals("CON", StringComparison.OrdinalIgnoreCase) ||
            baseName.Equals("PRN", StringComparison.OrdinalIgnoreCase) ||
            baseName.Equals("AUX", StringComparison.OrdinalIgnoreCase) ||
            baseName.Equals("NUL", StringComparison.OrdinalIgnoreCase) ||
            (baseName.Length == 4 &&
                (baseName.StartsWith("COM", StringComparison.OrdinalIgnoreCase) ||
                 baseName.StartsWith("LPT", StringComparison.OrdinalIgnoreCase)) &&
                baseName[3] is >= '1' and <= '9');
    }
}

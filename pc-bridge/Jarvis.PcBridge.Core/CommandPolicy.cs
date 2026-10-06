using System.Text.Json;

namespace Jarvis.PcBridge.Core;

public static class CommandPolicy
{
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
                HasBoundedString(arguments, "app", 128),
            "media" => HasOnly(arguments, "action") &&
                arguments.TryGetProperty("action", out var mediaAction) &&
                mediaAction.ValueKind == JsonValueKind.String &&
                IsMediaAction(mediaAction.GetString()),
            "open_folder" => HasOnly(arguments, "relativePath") &&
                arguments.TryGetProperty("relativePath", out var folder) &&
                folder.ValueKind == JsonValueKind.String &&
                TryNormalizeRepoPath(folder.GetString(), out _),
            "open_file" => HasOnly(arguments, "relativePath") &&
                arguments.TryGetProperty("relativePath", out var file) &&
                file.ValueKind == JsonValueKind.String &&
                TryNormalizeRepoPath(file.GetString(), out _),
            "active_window" => !arguments.EnumerateObject().Any(),
            "focus_window" => HasOnly(arguments, "title") &&
                arguments.TryGetProperty("title", out var title) &&
                title.ValueKind == JsonValueKind.String &&
                IsWindowTitle(title.GetString()),
            "browser_tabs" => !arguments.EnumerateObject().Any() ||
                (HasOnly(arguments, "offset") &&
                 arguments.TryGetProperty("offset", out var offset) &&
                 offset.TryGetInt32(out var offsetValue) && offsetValue is >= 0 and <= 5000),
            "browser_snapshot" => HasOnly(arguments, "tabId") &&
                arguments.TryGetProperty("tabId", out var tabId) &&
                IsTabId(tabId),
            "browser_act" => IsBrowserAction(arguments),
            "uia_snapshot" => !arguments.EnumerateObject().Any(),
            "uia_act" => IsUiAutomationAction(arguments),
            _ => false,
        };
    }

    public static bool IsControlAction(string command) => command is
        "open_url" or "open_app" or "open_folder" or "open_file" or "focus_window" or "uia_act" or "browser_act";

    public static bool IsMediaAction(string? action) => TryGetMediaVirtualKey(action, out _);

    public static bool TryGetMediaVirtualKey(string? action, out ushort virtualKey)
    {
        virtualKey = action switch
        {
            "play_pause" => 0xB3,
            "next" => 0xB0,
            "previous" => 0xB1,
            "volume_up" => 0xAF,
            "volume_down" => 0xAE,
            "mute" => 0xAD,
            _ => 0,
        };
        return virtualKey != 0;
    }

    private static bool IsUiAutomationAction(JsonElement arguments)
    {
        if (!arguments.TryGetProperty("snapshotId", out var snapshotId) ||
            snapshotId.ValueKind != JsonValueKind.String ||
            !Guid.TryParseExact(snapshotId.GetString(), "D", out _) ||
            !arguments.TryGetProperty("elementIndex", out var elementIndex) ||
            !elementIndex.TryGetInt32(out var index) || index is < 0 or >= 100 ||
            !arguments.TryGetProperty("action", out var action) ||
            action.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var common = new[] { "snapshotId", "elementIndex", "action" };
        return action.GetString() switch
        {
            "click" => HasOnly(arguments, common.Append("confirmed").ToArray()) &&
                arguments.TryGetProperty("confirmed", out var confirmed) &&
                (confirmed.ValueKind is JsonValueKind.True or JsonValueKind.False),
            "type" => HasOnly(arguments, common.Append("text").Append("confirmed").ToArray()) &&
                arguments.TryGetProperty("confirmed", out var confirmed) &&
                (confirmed.ValueKind is JsonValueKind.True or JsonValueKind.False) &&
                HasBoundedString(arguments, "text", 4_096) &&
                UiAutomationPolicy.IsSafeText(arguments.GetProperty("text").GetString()!),
            "scroll_up" or "scroll_down" => HasOnly(arguments, common),
            _ => false,
        };
    }

    private static bool IsBrowserAction(JsonElement arguments)
    {
        if (!arguments.TryGetProperty("tabId", out var tabId) || !IsTabId(tabId) ||
            !arguments.TryGetProperty("snapshotId", out var snapshotId) ||
            snapshotId.ValueKind != JsonValueKind.String ||
            !Guid.TryParseExact(snapshotId.GetString(), "D", out _) ||
            !arguments.TryGetProperty("elementIndex", out var elementIndex) ||
            !elementIndex.TryGetInt32(out var index) || index is < 0 or > 500 ||
            !arguments.TryGetProperty("action", out var action) ||
            action.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var common = new[] { "tabId", "snapshotId", "elementIndex", "action" };
        return action.GetString() switch
        {
            "click" => HasOnly(arguments, common.Append("confirmed").ToArray()) &&
                arguments.TryGetProperty("confirmed", out var confirmed) &&
                (confirmed.ValueKind is JsonValueKind.True or JsonValueKind.False),
            "type" => HasOnly(arguments, common.Append("text").ToArray()) &&
                HasBoundedString(arguments, "text", 4096, allowEmpty: true),
            "select" => HasOnly(arguments, common.Append("value").ToArray()) &&
                HasBoundedString(arguments, "value", 512),
            "scroll" => HasOnly(arguments, common.Append("direction").ToArray()) &&
                arguments.TryGetProperty("direction", out var direction) &&
                direction.ValueKind == JsonValueKind.String &&
                direction.GetString() is "up" or "down",
            "wait" => HasOnly(arguments, common.Append("waitMs").ToArray()) &&
                arguments.TryGetProperty("waitMs", out var waitMs) &&
                waitMs.TryGetInt32(out var milliseconds) && milliseconds is >= 0 and <= 5000,
            _ => false,
        };
    }

    private static bool IsTabId(JsonElement value) =>
        value.ValueKind == JsonValueKind.String &&
        value.GetString() is { Length: > 0 and <= 128 } id &&
        id.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');

    private static bool HasBoundedString(JsonElement value, string property, int maximum, bool allowEmpty = false) =>
        value.TryGetProperty(property, out var item) &&
        item.ValueKind == JsonValueKind.String &&
        item.GetString() is { } text &&
        text.Length <= maximum &&
        (allowEmpty || !string.IsNullOrWhiteSpace(text)) &&
        !text.Any(char.IsControl);

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

    private static bool HasOnly(JsonElement value, IReadOnlyCollection<string> properties) =>
        value.EnumerateObject().Count() == properties.Count &&
        value.EnumerateObject().All(item => properties.Contains(item.Name));

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

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jarvis.PcBridge.Core;

public sealed record BridgeCommand(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("command")] string Command,
    [property: JsonPropertyName("arguments")] JsonElement Arguments);

public sealed record BridgeResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("result")] object? Result = null,
    [property: JsonPropertyName("error")] string? Error = null);

public static class BridgeProtocol
{
    public const string Subprotocol = "jarvis.pc.v1";
    public const int MaxMessageBytes = 128 * 1024;
    public const int MaxResponseBytes = 1_050_000;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static bool TryReadCommand(ReadOnlySpan<byte> payload, out BridgeCommand? command)
    {
        command = null;
        if (payload.Length is 0 or > MaxMessageBytes) return false;

        try
        {
            var candidate = JsonSerializer.Deserialize<BridgeCommand>(payload, JsonOptions);
            if (candidate is null ||
                !Guid.TryParseExact(candidate.Id, "D", out _) ||
                candidate.Type != "command" ||
                !CommandPolicy.IsValid(candidate.Command, candidate.Arguments))
            {
                return false;
            }

            command = candidate;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static byte[] Success(string id, object result)
    {
        var response = JsonSerializer.SerializeToUtf8Bytes(new BridgeResponse(id, "result", result), JsonOptions);
        if (response.Length > MaxResponseBytes) throw new InvalidDataException("Bridge response is too large.");
        return response;
    }

    public static byte[] ControlState(bool paused) =>
        JsonSerializer.SerializeToUtf8Bytes(new { type = "status", controlPaused = paused }, JsonOptions);

    // `wakeWord` tells the backend to send `voice_state` so the listener pauses during voice sessions.
    public static byte[] ControlState(bool paused, bool wakeWord) =>
        JsonSerializer.SerializeToUtf8Bytes(new { type = "status", controlPaused = paused, wakeWord }, JsonOptions);

    public static byte[] WakeWord(DateTimeOffset at) =>
        JsonSerializer.SerializeToUtf8Bytes(new
        {
            type = "wake_word",
            at = at.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
        }, JsonOptions);

    public static bool TryReadVoiceState(ReadOnlySpan<byte> payload, out bool active)
    {
        active = false;
        if (payload.Length is 0 or > MaxMessageBytes) return false;
        try
        {
            using var document = JsonDocument.Parse(payload.ToArray());
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                root.EnumerateObject().Count() != 2 ||
                !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String ||
                type.GetString() != "voice_state" ||
                !root.TryGetProperty("active", out var value) ||
                value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                return false;
            }

            active = value.GetBoolean();
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static byte[] Failure(string id, string error) =>
        JsonSerializer.SerializeToUtf8Bytes(new BridgeResponse(id, "error", Error: error), JsonOptions);
}

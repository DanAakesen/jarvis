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
    public const int MaxMessageBytes = 64 * 1024;

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
        if (response.Length > MaxMessageBytes) throw new InvalidDataException("Bridge response is too large.");
        return response;
    }

    public static byte[] ControlState(bool paused) =>
        JsonSerializer.SerializeToUtf8Bytes(new { type = "status", controlPaused = paused }, JsonOptions);

    public static byte[] Failure(string id, string error) =>
        JsonSerializer.SerializeToUtf8Bytes(new BridgeResponse(id, "error", Error: error), JsonOptions);
}

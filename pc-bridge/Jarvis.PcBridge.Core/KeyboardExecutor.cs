using System.Text.Json;

namespace Jarvis.PcBridge.Core;

public interface IKeyboardProvider
{
    bool IsSensitiveFieldFocused(CancellationToken cancellationToken);
    void SendKeys(IReadOnlyList<string> sequence, CancellationToken cancellationToken);
    void TypeFocused(string text, CancellationToken cancellationToken);
}

public sealed class KeyboardExecutor(IKeyboardProvider provider)
{
    public object Execute(string action, JsonElement arguments, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (action == "keys")
        {
            if (!arguments.TryGetProperty("keys", out var keySequence) ||
                !arguments.TryGetProperty("closeIntent", out var closeIntent) ||
                closeIntent.ValueKind is not (JsonValueKind.True or JsonValueKind.False) ||
                !arguments.TryGetProperty("confirmed", out var confirmed) ||
                confirmed.ValueKind is not (JsonValueKind.True or JsonValueKind.False) ||
                !CommandPolicy.IsValidKeyboardSequence(keySequence) ||
                !CommandPolicy.IsSafeKeyboardSequence(keySequence, closeIntent.GetBoolean()))
                throw new UiAutomationRefusedException("not_allowed");
        }
        else if (action != "type_focused" ||
            !arguments.TryGetProperty("text", out var safeText) ||
            safeText.ValueKind != JsonValueKind.String ||
            !UiAutomationPolicy.IsSafeText(safeText.GetString()!))
        {
            throw new UiAutomationRefusedException("not_allowed");
        }

        if (provider.IsSensitiveFieldFocused(cancellationToken))
            throw new UiAutomationRefusedException("blocked");

        if (action == "type_focused")
        {
            var text = arguments.GetProperty("text").GetString()!;
            provider.TypeFocused(text, cancellationToken);
            return new { acted = true, action };
        }

        var keys = arguments.GetProperty("keys").EnumerateArray()
            .Select(chord => chord.GetString()!)
            .ToArray();
        if (CommandPolicy.HasIrreversibleKeyboardChord(arguments.GetProperty("keys")) &&
            !arguments.GetProperty("confirmed").GetBoolean())
        {
            return new
            {
                confirmationRequired = true,
                actionKind = "computer_use",
                summary = "Send an irreversible keyboard action to the foreground app.",
            };
        }

        provider.SendKeys(keys, cancellationToken);
        return new { acted = true, action };
    }
}

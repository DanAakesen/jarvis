using System.Text.RegularExpressions;

namespace Jarvis.PcBridge.Core;

public enum UiAutomationAction
{
    Click,
    Type,
    ScrollUp,
    ScrollDown,
}

public sealed class UiAutomationRefusedException(string code) : Exception
{
    public string Code { get; } = code;
}

public sealed record UiAutomationNode(int Index, string Role, string Name);

public sealed record UiAutomationSnapshot(
    string SnapshotId,
    string Application,
    IReadOnlyList<UiAutomationNode> Elements);

public sealed record UiAutomationControl(
    string RuntimeId,
    string Role,
    string Name,
    bool IsEnabled,
    bool IsOffscreen,
    bool IsSensitive,
    bool CanClick,
    bool CanType,
    bool CanScroll,
    object? NativeElement = null);

public sealed record UiAutomationView(
    string Application,
    string WindowId,
    IReadOnlyList<UiAutomationControl> Controls);

public interface IUiAutomationProvider
{
    UiAutomationView? Observe(CancellationToken cancellationToken);

    void Act(
        UiAutomationControl control,
        UiAutomationAction action,
        string? value,
        CancellationToken cancellationToken);
}

public sealed class UiAutomationExecutor(IUiAutomationProvider provider)
{
    private static readonly TimeSpan SnapshotLifetime = TimeSpan.FromSeconds(30);
    private const int MaxElements = 100;
    private SnapshotState? _snapshot;

    public UiAutomationSnapshot Observe(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var view = provider.Observe(cancellationToken);
        if (view is null) throw new UiAutomationRefusedException("not_found");
        if (!UiAutomationPolicy.IsAllowedApplication(view.Application))
            throw new UiAutomationRefusedException("not_allowed");

        var controls = view.Controls
            .Where(control => control.IsEnabled && !control.IsOffscreen && !control.IsSensitive &&
                !UiAutomationPolicy.IsSensitiveControl(control.Name) &&
                !string.IsNullOrWhiteSpace(control.RuntimeId) &&
                control.Name.Length <= 256 && !control.Name.Any(char.IsControl) &&
                (control.CanClick || control.CanType || control.CanScroll))
            .Take(MaxElements)
            .ToArray();
        var id = Guid.NewGuid().ToString("D");
        _snapshot = new SnapshotState(id, view, controls, DateTimeOffset.UtcNow);
        return new UiAutomationSnapshot(id, view.Application, controls
            .Select((control, index) => new UiAutomationNode(index, control.Role, control.Name))
            .ToArray());
    }

    public bool Act(
        string snapshotId,
        int index,
        UiAutomationAction action,
        string? value,
        bool confirmed,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var snapshot = _snapshot;
        if (snapshot is null || snapshot.Id != snapshotId ||
            DateTimeOffset.UtcNow - snapshot.CreatedAt > SnapshotLifetime ||
            index < 0 || index >= snapshot.Controls.Length)
        {
            throw new UiAutomationRefusedException("stale");
        }

        if (action == UiAutomationAction.Type &&
            (value is null || !UiAutomationPolicy.IsSafeText(value)))
        {
            throw new UiAutomationRefusedException("blocked");
        }

        var view = provider.Observe(cancellationToken);
        if (view is null || view.Application != snapshot.View.Application ||
            view.WindowId != snapshot.View.WindowId)
        {
            throw new UiAutomationRefusedException("stale");
        }

        var selected = snapshot.Controls[index];
        var current = view.Controls.FirstOrDefault(control => control.RuntimeId == selected.RuntimeId);
        if (current is null || current.Role != selected.Role || current.Name != selected.Name ||
            !current.IsEnabled || current.IsOffscreen || current.IsSensitive ||
            UiAutomationPolicy.IsSensitiveControl(current.Name) ||
            !Supports(current, action))
        {
            throw new UiAutomationRefusedException("stale");
        }

        if ((action is UiAutomationAction.Click or UiAutomationAction.Type) &&
            UiAutomationPolicy.IsDestructiveControl(current.Name) && !confirmed)
            return false;

        cancellationToken.ThrowIfCancellationRequested();
        provider.Act(current, action, value, cancellationToken);
        _snapshot = null;
        return true;
    }

    private static bool Supports(UiAutomationControl control, UiAutomationAction action) =>
        action switch
        {
            UiAutomationAction.Click => control.CanClick,
            UiAutomationAction.Type => control.CanType && !control.IsSensitive,
            UiAutomationAction.ScrollUp or UiAutomationAction.ScrollDown => control.CanScroll,
            _ => false,
        };

    private sealed record SnapshotState(
        string Id,
        UiAutomationView View,
        UiAutomationControl[] Controls,
        DateTimeOffset CreatedAt);
}

public static partial class UiAutomationPolicy
{
    [GeneratedRegex(
        @"\b(?:pass(?:word|phrase|code)s?|one[- ]time (?:code|password)|verification code|security code|otp|(?:credit|debit)[ -]card(?: number)?|card number|cvv|cvc|ssn|social security(?: number)?|passport(?: number)?|national id(?:entification)?(?: number)?|driver'?s? license(?: number)?|tax(?:payer)? id(?:entification)?(?: number)?)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SensitiveControlPattern();

    [GeneratedRegex(@"(?<!\d)\d{3}[- ]?\d{2}[- ]?\d{4}(?!\d)", RegexOptions.CultureInvariant)]
    private static partial Regex SensitiveIdentifierPattern();

    [GeneratedRegex(@"(?<!\d)\d{4,8}(?!\d)", RegexOptions.CultureInvariant)]
    private static partial Regex SensitiveNumericPattern();

    [GeneratedRegex(
<<<<<<< HEAD
        @"\b(?:send|submit|delete|remove|erase|overwrite|replace|discard|reset|clear|format|reformat|drop|revert|pay|payment|purchase|post|push|transfer)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DestructiveControlPattern();

    public static bool IsAllowedApplication(string application) =>
        application.Length is > 0 and <= 128 &&
        application.All(character => char.IsLetterOrDigit(character) || character is '.' or '_' or '-');
=======
        @"\b(?:send|sending|delete|deletion|pay|paid|payment|purchase|post|posting|push|pushing|overwrite|overwriting)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DestructiveControlPattern();

    [GeneratedRegex(@"^[\p{L}\p{N}_.-]{1,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex ApplicationNamePattern();

    public static bool IsAllowedApplication(string application) =>
        !string.IsNullOrWhiteSpace(application) && ApplicationNamePattern().IsMatch(application);
>>>>>>> origin/main

    public static bool IsSensitiveControl(string name) =>
        SensitiveControlPattern().IsMatch(name) ||
        SensitiveIdentifierPattern().IsMatch(name) ||
        SensitiveNumericPattern().IsMatch(name);

    public static bool IsDestructiveControl(string name) => DestructiveControlPattern().IsMatch(name);

    public static bool IsSafeText(string value) =>
        value.Length is > 0 and <= 4_096 &&
        !value.Any(char.IsControl) &&
        !SensitiveIdentifierPattern().IsMatch(value) &&
        !Regex.IsMatch(value, @"(?<!\d)\d{4,8}(?!\d)", RegexOptions.CultureInvariant) &&
        !HasLuhnCardNumber(value);

    private static bool HasLuhnCardNumber(string value)
    {
        foreach (Match match in Regex.Matches(value, @"(?:\d[ -]?){13,19}", RegexOptions.CultureInvariant))
        {
            var digits = new string(match.Value.Where(char.IsDigit).ToArray());
            if (digits.Length is < 13 or > 19) continue;

            var sum = 0;
            var doubleDigit = false;
            for (var index = digits.Length - 1; index >= 0; index--)
            {
                var digit = digits[index] - '0';
                if (doubleDigit)
                {
                    digit *= 2;
                    if (digit > 9) digit -= 9;
                }
                sum += digit;
                doubleDigit = !doubleDigit;
            }
            if (sum % 10 == 0) return true;
        }
        return false;
    }
}

using System.Text.Json;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class KeyboardExecutorTests
{
    [Fact]
    public void Sends_allowed_chords_and_explicit_text_to_a_fake_provider()
    {
        var provider = new FakeKeyboardProvider();
        var executor = new KeyboardExecutor(provider);

        var keys = Execute(executor, "keys",
            """{"keys":["Ctrl+P","Enter"],"confirmed":false,"closeIntent":false}""");
        var typed = Execute(executor, "type_focused", """{"text":"Jarvis search"}""");

        Assert.Equal(true, keys.GetType().GetProperty("acted")!.GetValue(keys));
        Assert.Equal(true, typed.GetType().GetProperty("acted")!.GetValue(typed));
        Assert.Equal(["Ctrl+P", "Enter"], provider.Keys);
        Assert.Equal("Jarvis search", provider.Text);
    }

    [Fact]
    public void Blocks_keyboard_input_while_a_sensitive_control_is_focused()
    {
        var provider = new FakeKeyboardProvider { SensitiveFocused = true };
        var executor = new KeyboardExecutor(provider);

        var error = Assert.Throws<UiAutomationRefusedException>(() =>
            Execute(executor, "keys", """{"keys":["Ctrl+L"],"confirmed":false,"closeIntent":false}"""));

        Assert.Equal("blocked", error.Code);
        Assert.Empty(provider.Keys);
    }

    [Theory]
    [InlineData("""{"keys":["Win+L"],"confirmed":false,"closeIntent":true}""")]
    [InlineData("""{"keys":["Ctrl+Alt+Delete"],"confirmed":false,"closeIntent":true}""")]
    [InlineData("""{"keys":["Alt+F4"],"confirmed":false,"closeIntent":false}""")]
    [InlineData("""{"keys":["Ctrl+P","Enter","Tab","Escape","Delete"],"confirmed":false,"closeIntent":false}""")]
    public void Refuses_unsafe_keyboard_sequences_before_calling_provider(string arguments)
    {
        var provider = new FakeKeyboardProvider();
        var executor = new KeyboardExecutor(provider);

        var error = Assert.Throws<UiAutomationRefusedException>(() =>
            Execute(executor, "keys", arguments));

        Assert.Equal("not_allowed", error.Code);
        Assert.Empty(provider.Keys);
    }

    [Theory]
    [InlineData("""{"keys":["Delete"],"confirmed":false,"closeIntent":false}""")]
    [InlineData("""{"keys":["Ctrl+Enter"],"confirmed":false,"closeIntent":false}""")]
    public void Requires_confirmation_for_irreversible_chords(string arguments)
    {
        var provider = new FakeKeyboardProvider();
        var executor = new KeyboardExecutor(provider);

        var confirmation = Execute(executor, "keys", arguments);

        Assert.Equal(true, confirmation.GetType().GetProperty("confirmationRequired")!.GetValue(confirmation));
        Assert.Empty(provider.Keys);
        var approved = Execute(executor, "keys", arguments.Replace(
            "\"confirmed\":false", "\"confirmed\":true", StringComparison.Ordinal));
        Assert.Equal(true, approved.GetType().GetProperty("acted")!.GetValue(approved));
    }

    private static object Execute(KeyboardExecutor executor, string action, string arguments)
    {
        using var document = JsonDocument.Parse(arguments);
        return executor.Execute(action, document.RootElement, CancellationToken.None);
    }

    private sealed class FakeKeyboardProvider : IKeyboardProvider
    {
        public bool SensitiveFocused { get; init; }
        public List<string> Keys { get; } = [];
        public string? Text { get; private set; }

        public bool IsSensitiveFieldFocused(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return SensitiveFocused;
        }

        public void SendKeys(IReadOnlyList<string> sequence, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Keys.AddRange(sequence);
        }

        public void TypeFocused(string text, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Text = text;
        }
    }
}

using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class UiAutomationExecutorTests
{
    [Fact]
    public void Snapshot_exposes_only_allowed_visible_non_sensitive_controls_without_values()
    {
        var provider = new FakeUiAutomationProvider(new UiAutomationView("vscode", "window-1",
        [
            Control("save", "button", "Save"),
            Control("password", "edit", "Password", sensitive: true, canClick: false, canType: true),
            Control("ssn", "edit", "SSN", canClick: false, canType: true),
            Control("ssn", "edit", "Social Security Number", canClick: false, canType: true),
            Control("otp", "edit", "123456", canClick: false, canType: true),
            Control("hidden", "button", "Hidden", offscreen: true),
            Control("disabled", "button", "Disabled", enabled: false),
        ]));
        var snapshot = new UiAutomationExecutor(provider).Observe(CancellationToken.None);

        Assert.Equal("vscode", snapshot.Application);
        Assert.Equal([new UiAutomationNode(0, "button", "Save")], snapshot.Elements);
        Assert.DoesNotContain("password", System.Text.Json.JsonSerializer.Serialize(snapshot));
    }

    [Fact]
    public void Click_requires_confirmation_for_destructive_controls_and_rechecks_the_snapshot()
    {
        var provider = new FakeUiAutomationProvider(new UiAutomationView("explorer", "window-1",
        [
            Control("delete", "button", "Delete file"),
        ]));
        var executor = new UiAutomationExecutor(provider);
        var snapshot = executor.Observe(CancellationToken.None);

        Assert.False(executor.Act(snapshot.SnapshotId, 0, UiAutomationAction.Click, null, false, CancellationToken.None));
        Assert.Empty(provider.Actions);
        Assert.True(executor.Act(snapshot.SnapshotId, 0, UiAutomationAction.Click, null, true, CancellationToken.None));
        Assert.Single(provider.Actions);
        Assert.Throws<UiAutomationRefusedException>(() =>
            executor.Act(snapshot.SnapshotId, 0, UiAutomationAction.Click, null, true, CancellationToken.None));
    }

    [Theory]
    [InlineData("Send message")]
    [InlineData("Delete file")]
    [InlineData("Make payment")]
    [InlineData("Purchase item")]
    [InlineData("Post update")]
    [InlineData("Push changes")]
    [InlineData("Overwrite file")]
    public void Destructive_controls_require_confirmation(string name)
    {
        var provider = new FakeUiAutomationProvider(new UiAutomationView("vscode", "window-1",
        [
            Control("destructive", "button", name),
        ]));
        var executor = new UiAutomationExecutor(provider);
        var snapshot = executor.Observe(CancellationToken.None);

        Assert.False(executor.Act(snapshot.SnapshotId, 0, UiAutomationAction.Click, null, false, CancellationToken.None));
        Assert.Empty(provider.Actions);
    }

    [Theory]
    [InlineData("Submit")]
    [InlineData("Remove file")]
    [InlineData("Replace text")]
    [InlineData("Reset settings")]
    public void Reversible_controls_do_not_require_confirmation(string name)
    {
        var provider = new FakeUiAutomationProvider(new UiAutomationView("spotify", "window-1",
        [
            Control("control", "button", name),
        ]));
        var executor = new UiAutomationExecutor(provider);
        var snapshot = executor.Observe(CancellationToken.None);

        Assert.True(executor.Act(snapshot.SnapshotId, 0, UiAutomationAction.Click, null, false, CancellationToken.None));
        Assert.Single(provider.Actions);
    }

    [Fact]
    public void Typing_into_a_destructive_control_requires_confirmation()
    {
        var provider = new FakeUiAutomationProvider(new UiAutomationView("vscode", "window-1",
        [
            Control("overwrite", "edit", "Overwrite existing content", canClick: false, canType: true),
        ]));
        var executor = new UiAutomationExecutor(provider);
        var snapshot = executor.Observe(CancellationToken.None);

        Assert.False(executor.Act(snapshot.SnapshotId, 0, UiAutomationAction.Type, "replacement", false, CancellationToken.None));
        Assert.Empty(provider.Actions);
        Assert.True(executor.Act(snapshot.SnapshotId, 0, UiAutomationAction.Type, "replacement", true, CancellationToken.None));
        Assert.Single(provider.Actions);
    }

    [Fact]
    public void Refuses_stale_controls_and_accepts_any_foreground_app()
    {
        var provider = new FakeUiAutomationProvider(new UiAutomationView("vscode", "window-1",
        [
            Control("button", "button", "Open"),
        ]));
        var executor = new UiAutomationExecutor(provider);
        var snapshot = executor.Observe(CancellationToken.None);
        provider.View = provider.View with { WindowId = "window-2" };

        var stale = Assert.Throws<UiAutomationRefusedException>(() =>
            executor.Act(snapshot.SnapshotId, 0, UiAutomationAction.Click, null, false, CancellationToken.None));
        Assert.Equal("stale", stale.Code);

        provider.View = new UiAutomationView("spotify", "window-3",
        [
            Control("search", "edit", "Search Spotify", canClick: false, canType: true),
        ]);
        var spotify = executor.Observe(CancellationToken.None);
        Assert.Equal("spotify", spotify.Application);
        Assert.True(executor.Act(spotify.SnapshotId, 0, UiAutomationAction.Type, "Daft Punk", false, CancellationToken.None));
    }

    [Theory]
    [InlineData("123456")]
    [InlineData("123-45-6789")]
    [InlineData("123456789")]
    [InlineData("4111 1111 1111 1111")]
    [InlineData("Line one\nLine two")]
    public void Refuses_one_time_codes_payment_cards_and_control_characters(string value)
    {
        Assert.False(UiAutomationPolicy.IsSafeText(value));
    }

    [Fact]
    public void Allows_explicit_non_sensitive_text_in_an_observed_edit_control()
    {
        var provider = new FakeUiAutomationProvider(new UiAutomationView("vscode", "window-1",
        [
            Control("search", "edit", "Search", canClick: false, canType: true),
        ]));
        var executor = new UiAutomationExecutor(provider);
        var snapshot = executor.Observe(CancellationToken.None);

        Assert.True(executor.Act(snapshot.SnapshotId, 0, UiAutomationAction.Type, "issue 205", false, CancellationToken.None));
        Assert.Equal(("search", UiAutomationAction.Type, "issue 205"), Assert.Single(provider.Actions));
    }

    private static UiAutomationControl Control(
        string id,
        string role,
        string name,
        bool enabled = true,
        bool offscreen = false,
        bool sensitive = false,
        bool canClick = true,
        bool canType = false,
        bool canScroll = false) =>
        new(id, role, name, enabled, offscreen, sensitive, canClick, canType, canScroll);

    private sealed class FakeUiAutomationProvider(UiAutomationView view) : IUiAutomationProvider
    {
        public UiAutomationView View { get; set; } = view;
        public List<(string Id, UiAutomationAction Action, string? Value)> Actions { get; } = [];

        public UiAutomationView Observe(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return View;
        }

        public void Act(
            UiAutomationControl control,
            UiAutomationAction action,
            string? value,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Actions.Add((control.RuntimeId, action, value));
        }
    }
}

using System.Text.Json;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class BrowserExecutorTests
{
    [Fact]
    public async Task Lists_tabs_takes_a_node_bound_snapshot_and_acts_on_the_observed_index()
    {
        await using var target = await FakeCdpTarget.StartAsync();
        using var executor = new BrowserExecutor(
            () => true,
            () => "Search - Google Chrome",
            targetsUri: target.TargetsUri);

        var tabs = await Execute(executor, "browser_tabs", "{}");
        var tab = Assert.Single((BrowserTab[])tabs.GetType().GetProperty("tabs")!.GetValue(tabs)!);
        Assert.Equal("tab_1", tab.Id);
        Assert.True(tab.Focused);

        var snapshot = await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
        var snapshotId = (string)snapshot.GetType().GetProperty("SnapshotId")!.GetValue(snapshot)!;
        var elements = (IReadOnlyList<BrowserElement>)snapshot.GetType().GetProperty("Elements")!.GetValue(snapshot)!;
        var element = Assert.Single(elements);
        Assert.Equal(0, element.Index);
        Assert.Equal("button", element.Role);
        Assert.Equal("Continue", element.Name);

        var action = await Execute(executor, "browser_act",
            $$"""{"tabId":"tab_1","snapshotId":"{{snapshotId}}","elementIndex":0,"action":"click","confirmed":false}""");
        Assert.Equal(true, action.GetType().GetProperty("acted")!.GetValue(action));
        Assert.Contains("Runtime.callFunctionOn", target.Methods);
        Assert.Contains(target.Calls, call =>
            call.GetProperty("method").GetString() == "Runtime.callFunctionOn" &&
            call.GetProperty("params").GetProperty("functionDeclaration").GetString()!.Contains("elementFromPoint", StringComparison.Ordinal) &&
            call.GetProperty("params").GetProperty("functionDeclaration").GetString()!.Contains("isConnected", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Refuses_replaced_stale_covered_and_sensitive_targets()
    {
        await using (var target = await FakeCdpTarget.StartAsync())
        using (var executor = new BrowserExecutor(() => true, () => null, targetsUri: target.TargetsUri))
        {
            var old = await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
            var oldId = (string)old.GetType().GetProperty("SnapshotId")!.GetValue(old)!;
            await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
            await AssertRefused(executor,
                $$"""{"tabId":"tab_1","snapshotId":"{{oldId}}","elementIndex":0,"action":"click","confirmed":false}""",
                "stale");

            var current = await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
            var currentId = (string)current.GetType().GetProperty("SnapshotId")!.GetValue(current)!;
            target.ActionStatus = "covered";
            await AssertRefused(executor,
                $$"""{"tabId":"tab_1","snapshotId":"{{currentId}}","elementIndex":0,"action":"click","confirmed":false}""",
                "covered");
            target.ActionStatus = "stale";
            await AssertRefused(executor,
                $$"""{"tabId":"tab_1","snapshotId":"{{currentId}}","elementIndex":0,"action":"click","confirmed":false}""",
                "stale");
        }

        await using (var target = await FakeCdpTarget.StartAsync("textbox", "Password", "password", sensitive: true))
        using (var executor = new BrowserExecutor(() => true, () => null, targetsUri: target.TargetsUri))
        {
            var snapshot = await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
            var id = (string)snapshot.GetType().GetProperty("SnapshotId")!.GetValue(snapshot)!;
            var elements = (IReadOnlyList<BrowserElement>)snapshot.GetType().GetProperty("Elements")!.GetValue(snapshot)!;
            Assert.Equal(string.Empty, Assert.Single(elements).Value);
            await AssertRefused(executor,
                $$"""{"tabId":"tab_1","snapshotId":"{{id}}","elementIndex":0,"action":"type","text":"not a secret"}""",
                "blocked");
            Assert.DoesNotContain("Runtime.callFunctionOn", target.Methods);
        }
    }

    [Fact]
    public async Task Requires_confirmation_for_risky_clicks_and_blocks_code_or_card_like_text()
    {
        await using (var target = await FakeCdpTarget.StartAsync(name: "Send message"))
        using (var executor = new BrowserExecutor(() => true, () => null, targetsUri: target.TargetsUri))
        {
            var snapshot = await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
            var id = (string)snapshot.GetType().GetProperty("SnapshotId")!.GetValue(snapshot)!;
            var action = $$"""{"tabId":"tab_1","snapshotId":"{{id}}","elementIndex":0,"action":"click","confirmed":false}""";
            var confirmation = await Execute(executor, "browser_act", action);
            Assert.Equal(true, confirmation.GetType().GetProperty("confirmationRequired")!.GetValue(confirmation));
            var approved = await Execute(executor, "browser_act", action.Replace(
                "\"confirmed\":false", "\"confirmed\":true", StringComparison.Ordinal));
            Assert.Equal(true, approved.GetType().GetProperty("acted")!.GetValue(approved));
        }

        await using (var target = await FakeCdpTarget.StartAsync("textbox", "Search"))
        using (var executor = new BrowserExecutor(() => true, () => null, targetsUri: target.TargetsUri))
        {
            var snapshot = await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
            var id = (string)snapshot.GetType().GetProperty("SnapshotId")!.GetValue(snapshot)!;
            await AssertRefused(executor,
                $$"""{"tabId":"tab_1","snapshotId":"{{id}}","elementIndex":0,"action":"type","text":"123456"}""",
                "blocked");
            await AssertRefused(executor,
                $$"""{"tabId":"tab_1","snapshotId":"{{id}}","elementIndex":0,"action":"type","text":"4111111111111111"}""",
                "blocked");
            Assert.DoesNotContain("Runtime.callFunctionOn", target.Methods);
        }
    }

    [Fact]
    public async Task Browser_executor_is_off_until_enabled()
    {
        await using var target = await FakeCdpTarget.StartAsync();
        using var executor = new BrowserExecutor(() => false, () => null, targetsUri: target.TargetsUri);

        await AssertRefused(executor, "{}", "browser_off", "browser_tabs");
        Assert.Empty(target.Methods);
    }

    [Fact]
    public async Task Browser_contract_is_shared_by_cdp_and_extension_transports()
    {
        await using (var cdpTarget = await FakeCdpTarget.StartAsync())
        using (var cdpExecutor = new BrowserExecutor(
            () => true,
            () => "Search - Google Chrome",
            targetsUri: cdpTarget.TargetsUri))
        {
            await AssertBrowserContract(cdpExecutor);
        }

        await using var extensionTarget = await FakeCdpTarget.StartAsync();
        await using var extensionPort = new FakeExtensionBrowserPort(extensionTarget);
        using var extensionExecutor = new BrowserExecutor(
            () => true,
            () => "Search - Google Chrome",
            targetsUri: new Uri("http://127.0.0.1:9222/json/list"),
            extensionPort: extensionPort);

        await AssertBrowserContract(extensionExecutor);

        Assert.Contains("Runtime.evaluate", extensionPort.Methods);
        Assert.Contains("Runtime.callFunctionOn", extensionPort.Methods);
        Assert.Equal(1, extensionPort.DetachCount);
    }

    [Fact]
    public async Task Browser_executor_falls_back_to_cdp_when_extension_is_disconnected()
    {
        await using var target = await FakeCdpTarget.StartAsync();
        await using var extensionPort = new FakeExtensionBrowserPort(target) { IsConnected = false };
        using var executor = new BrowserExecutor(
            () => true,
            () => null,
            targetsUri: target.TargetsUri,
            extensionPort: extensionPort);

        var tabs = await Execute(executor, "browser_tabs", "{}");

        Assert.Equal("tab_1", Assert.Single((BrowserTab[])tabs.GetType().GetProperty("tabs")!.GetValue(tabs)!).Id);
        Assert.Empty(extensionPort.Methods);
    }

    [Fact]
    public async Task Extension_transport_keeps_confirmation_snapshot_until_approval_then_detaches()
    {
        await using var target = await FakeCdpTarget.StartAsync(name: "Send message");
        await using var extensionPort = new FakeExtensionBrowserPort(target);
        using var executor = new BrowserExecutor(
            () => true,
            () => null,
            targetsUri: new Uri("http://127.0.0.1:9222/json/list"),
            extensionPort: extensionPort);

        var snapshot = await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
        var snapshotId = (string)snapshot.GetType().GetProperty("SnapshotId")!.GetValue(snapshot)!;
        var action = $$"""{"tabId":"tab_1","snapshotId":"{{snapshotId}}","elementIndex":0,"action":"click","confirmed":false}""";
        var confirmation = await Execute(executor, "browser_act", action);

        Assert.Equal(true, confirmation.GetType().GetProperty("confirmationRequired")!.GetValue(confirmation));
        Assert.Equal(0, extensionPort.DetachCount);

        var approved = await Execute(executor, "browser_act",
            action.Replace("\"confirmed\":false", "\"confirmed\":true", StringComparison.Ordinal));

        Assert.Equal(true, approved.GetType().GetProperty("acted")!.GetValue(approved));
        Assert.Equal(1, extensionPort.DetachCount);
    }

    [Fact]
    public async Task Extension_tab_removal_releases_its_snapshot_session()
    {
        await using var target = await FakeCdpTarget.StartAsync();
        await using var extensionPort = new FakeExtensionBrowserPort(target);
        using var executor = new BrowserExecutor(
            () => true,
            () => null,
            targetsUri: new Uri("http://127.0.0.1:9222/json/list"),
            extensionPort: extensionPort);

        var snapshot = await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
        var snapshotId = (string)snapshot.GetType().GetProperty("SnapshotId")!.GetValue(snapshot)!;
        Assert.Equal(1, extensionPort.SessionCount);

        extensionPort.RemoveTab("tab_1");

        Assert.Equal(0, extensionPort.SessionCount);
        await AssertRefused(
            executor,
            $$"""{"tabId":"tab_1","snapshotId":"{{snapshotId}}","elementIndex":0,"action":"click","confirmed":false}""",
            "not_found");
    }

    private static async Task<object> Execute(BrowserExecutor executor, string name, string arguments)
    {
        using var document = JsonDocument.Parse(arguments);
        return await executor.ExecuteAsync(
            new BridgeCommand("1730aa51-f380-4df9-a345-1feb862cb1c4", "command", name, document.RootElement),
            CancellationToken.None);
    }

    private static async Task AssertBrowserContract(BrowserExecutor executor)
    {
        var tabs = await Execute(executor, "browser_tabs", "{}");
        var tab = Assert.Single((BrowserTab[])tabs.GetType().GetProperty("tabs")!.GetValue(tabs)!);
        Assert.Equal("tab_1", tab.Id);
        Assert.True(tab.Focused);

        var snapshot = await Execute(executor, "browser_snapshot", """{"tabId":"tab_1"}""");
        var snapshotId = (string)snapshot.GetType().GetProperty("SnapshotId")!.GetValue(snapshot)!;
        var element = Assert.Single((IReadOnlyList<BrowserElement>)snapshot.GetType()
            .GetProperty("Elements")!.GetValue(snapshot)!);
        Assert.Equal("Continue", element.Name);

        var action = await Execute(executor, "browser_act",
            $$"""{"tabId":"tab_1","snapshotId":"{{snapshotId}}","elementIndex":0,"action":"click","confirmed":false}""");
        Assert.Equal(true, action.GetType().GetProperty("acted")!.GetValue(action));
    }

    private static async Task AssertRefused(
        BrowserExecutor executor,
        string arguments,
        string code,
        string command = "browser_act")
    {
        using var document = JsonDocument.Parse(arguments);
        var exception = await Assert.ThrowsAsync<BrowserActionRefusedException>(() => executor.ExecuteAsync(
            new BridgeCommand("1730aa51-f380-4df9-a345-1feb862cb1c4", "command", command, document.RootElement),
            CancellationToken.None));
        Assert.Equal(code, exception.Code);
    }
}

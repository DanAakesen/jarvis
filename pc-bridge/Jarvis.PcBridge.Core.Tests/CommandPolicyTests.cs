using System.Text;
using System.Text.Json;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class CommandPolicyTests
{
    [Theory]
    [InlineData("open_url", true)]
    [InlineData("open_app", true)]
    [InlineData("open_folder", true)]
    [InlineData("focus_window", true)]
    [InlineData("uia_act", true)]
    [InlineData("browser_act", true)]
    [InlineData("media", true)]
    [InlineData("close_app", true)]
    [InlineData("active_window", false)]
    [InlineData("uia_snapshot", false)]
    [InlineData("browser_snapshot", false)]
    [InlineData("browser_tabs", false)]
    public void Identifies_actions_blocked_when_control_is_paused(string command, bool expected)
    {
        Assert.Equal(expected, CommandPolicy.IsControlAction(command));
    }

    [Theory]
    [InlineData("play_pause", 0xB3)]
    [InlineData("next", 0xB0)]
    [InlineData("previous", 0xB1)]
    [InlineData("volume_up", 0xAF)]
    [InlineData("volume_down", 0xAE)]
    [InlineData("mute", 0xAD)]
    public void Maps_media_actions_to_the_windows_media_virtual_key(string action, ushort expectedKey)
    {
        Assert.True(CommandPolicy.TryGetMediaVirtualKey(action, out var actualKey));
        Assert.Equal(expectedKey, actualKey);
    }

    [Theory]
    [InlineData("open_url", """{"url":"https://example.com/repo"}""")]
    [InlineData("open_app", """{"app":"vscode"}""")]
    [InlineData("open_app", """{"app":"Spotify"}""")]
    [InlineData("open_app", """{"app":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}""")]
    [InlineData("media", """{"action":"play_pause"}""")]
    [InlineData("media", """{"action":"next"}""")]
    [InlineData("media", """{"action":"previous"}""")]
    [InlineData("media", """{"action":"volume_up"}""")]
    [InlineData("media", """{"action":"volume_down"}""")]
    [InlineData("media", """{"action":"mute"}""")]
    [InlineData("open_folder", """{"relativePath":"jarvis\\apps\\backend"}""")]
    [InlineData("active_window", "{}")]
    [InlineData("focus_window", """{"title":"Jarvis - Visual Studio Code"}""")]
    [InlineData("browser_tabs", "{}")]
    [InlineData("browser_tabs", """{"offset":20}""")]
    [InlineData("browser_snapshot", """{"tabId":"tab_1"}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"click","confirmed":false}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"type","text":"hello"}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"select","value":"option"}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"scroll","direction":"down"}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"wait","waitMs":10}""")]
    [InlineData("uia_snapshot", "{}")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"click","confirmed":false}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"type","text":"Hello, Dan","confirmed":false}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"scroll_down"}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"keys","keys":["Ctrl+P","Enter"],"confirmed":false,"closeIntent":false}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"keys","keys":["Alt+F4"],"confirmed":false,"closeIntent":true}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"type_focused","text":"search for Jarvis"}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"keys","keys":["Ctrl+L"],"confirmed":false,"closeIntent":false}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"type_focused","text":"Jarvis"}""")]
    public void Accepts_allow_list_commands(string name, string arguments)
    {
        using var document = JsonDocument.Parse(arguments);

        Assert.True(CommandPolicy.IsValid(name, document.RootElement));
    }

    [Theory]
    [InlineData("open_url", """{"url":"javascript:alert(1)"}""")]
    [InlineData("open_url", """{"url":"https://user@example.com"}""")]
    [InlineData("open_url", """{"url":"file:///C:/secret.txt"}""")]
    [InlineData("open_app", """{"app":""}""")]
    [InlineData("open_app", """{"app":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}""")]
    [InlineData("open_app", """{"app":"spotify\n"}""")]
    [InlineData("media", """{"action":"launch"}""")]
    [InlineData("media", """{"action":"mute","confirmed":true}""")]
    [InlineData("open_folder", """{"relativePath":"..\\secrets"}""")]
    [InlineData("open_folder", """{"relativePath":"C:\\Repo\\jarvis"}""")]
    [InlineData("open_folder", """{"relativePath":"jarvis\\..\\secrets"}""")]
    [InlineData("open_folder", """{"relativePath":"jarvis\\CON"}""")]
    [InlineData("active_window", """{"title":"ignored"}""")]
    [InlineData("focus_window", """{"title":"window\ninjection"}""")]
    [InlineData("open_app", """{"app":"vscode","path":"C:\\secret"}""")]
    [InlineData("run_command", """{"command":"whoami"}""")]
    [InlineData("browser_snapshot", """{"tabId":"tab_1","url":"https://example.com"}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"click","selector":"#submit","confirmed":false}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"click","x":10,"y":12,"confirmed":false}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":501,"action":"click","confirmed":false}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"execute_script","text":"alert(1)"}""")]
    [InlineData("browser_tabs", """{"offset":5001}""")]
    [InlineData("uia_snapshot", """{"process":"powershell"}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":100,"action":"click","confirmed":false}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"click"}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"type","text":"Hello, Dan"}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"type","text":"123456","confirmed":false}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","elementIndex":0,"action":"execute_script","text":"alert(1)"}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"keys","keys":["Win+L"],"confirmed":false,"closeIntent":true}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"keys","keys":["Ctrl+Alt+Delete"],"confirmed":false,"closeIntent":true}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"keys","keys":["Alt+F4"],"confirmed":false,"closeIntent":false}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"keys","keys":["Ctrl+P","Enter","Tab","Escape","Delete"],"confirmed":false,"closeIntent":false}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"keys","keys":["Ctrl+P","unknown"],"confirmed":false,"closeIntent":false}""")]
    [InlineData("uia_act", """{"snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"type_focused","text":"123456"}""")]
    [InlineData("browser_act", """{"tabId":"tab_1","snapshotId":"1730aa51-f380-4df9-a345-1feb862cb1c4","action":"keys","keys":["Alt+F4"],"confirmed":false,"closeIntent":false}""")]
    public void Rejects_commands_outside_the_policy(string name, string arguments)
    {
        using var document = JsonDocument.Parse(arguments);

        Assert.False(CommandPolicy.IsValid(name, document.RootElement));
    }

    [Fact]
    public void Reads_only_bounded_well_formed_commands()
    {
        var valid = Encoding.UTF8.GetBytes(
            """{"id":"1730aa51-f380-4df9-a345-1feb862cb1c4","type":"command","command":"active_window","arguments":{}}""");

        Assert.True(BridgeProtocol.TryReadCommand(valid, out var command));
        Assert.Equal("active_window", command!.Command);
        Assert.False(BridgeProtocol.TryReadCommand(Encoding.UTF8.GetBytes(
            """{"id":"not-an-id","type":"command","command":"active_window","arguments":{}}"""), out _));
        Assert.False(BridgeProtocol.TryReadCommand(Encoding.UTF8.GetBytes(
            """{"id":"1730aa51-f380-4df9-a345-1feb862cb1c4","type":"result","command":"active_window","arguments":{}}"""), out _));
        Assert.False(BridgeProtocol.TryReadCommand(new byte[BridgeProtocol.MaxMessageBytes + 1], out _));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Serializes_control_pause_status_for_the_backend(bool paused)
    {
        using var document = JsonDocument.Parse(BridgeProtocol.ControlState(paused));
        var root = document.RootElement;

        Assert.Equal("status", root.GetProperty("type").GetString());
        Assert.Equal(paused, root.GetProperty("controlPaused").GetBoolean());
        Assert.Equal(2, root.EnumerateObject().Count());
    }

    [Fact]
    public void Refuses_oversized_bridge_responses()
    {
        Assert.Throws<InvalidDataException>(() =>
            BridgeProtocol.Success("1730aa51-f380-4df9-a345-1feb862cb1c4",
                new { text = new string('x', BridgeProtocol.MaxMessageBytes) }));
    }
}

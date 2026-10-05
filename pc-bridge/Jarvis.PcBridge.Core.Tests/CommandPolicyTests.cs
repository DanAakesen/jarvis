using System.Text;
using System.Text.Json;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class CommandPolicyTests
{
    [Theory]
    [InlineData("open_url", """{"url":"https://example.com/repo"}""")]
    [InlineData("open_app", """{"app":"vscode"}""")]
    [InlineData("open_app", """{"app":"terminal"}""")]
    [InlineData("open_folder", """{"relativePath":"jarvis\\apps\\backend"}""")]
    [InlineData("active_window", "{}")]
    [InlineData("focus_window", """{"title":"Jarvis - Visual Studio Code"}""")]
    public void Accepts_allow_list_commands(string name, string arguments)
    {
        using var document = JsonDocument.Parse(arguments);

        Assert.True(CommandPolicy.IsValid(name, document.RootElement));
    }

    [Theory]
    [InlineData("open_url", """{"url":"javascript:alert(1)"}""")]
    [InlineData("open_url", """{"url":"https://user@example.com"}""")]
    [InlineData("open_url", """{"url":"file:///C:/secret.txt"}""")]
    [InlineData("open_app", """{"app":"powershell"}""")]
    [InlineData("open_folder", """{"relativePath":"..\\secrets"}""")]
    [InlineData("open_folder", """{"relativePath":"C:\\Repo\\jarvis"}""")]
    [InlineData("open_folder", """{"relativePath":"jarvis\\..\\secrets"}""")]
    [InlineData("open_folder", """{"relativePath":"jarvis\\CON"}""")]
    [InlineData("active_window", """{"title":"ignored"}""")]
    [InlineData("focus_window", """{"title":"window\ninjection"}""")]
    [InlineData("open_app", """{"app":"vscode","path":"C:\\secret"}""")]
    [InlineData("run_command", """{"command":"whoami"}""")]
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
}

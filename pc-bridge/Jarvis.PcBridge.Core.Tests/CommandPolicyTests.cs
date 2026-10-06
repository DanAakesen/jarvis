using System.Text;
using System.Text.Json;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class CommandPolicyTests
{
    [Theory]
    [InlineData("open_url", """{"url":"https://example.com/repo"}""")]
    [InlineData("open_app", """{"app":"vscode"}""")]
    [InlineData("open_app", """{"app":"codex"}""")]
    [InlineData("open_app", """{"app":"terminal"}""")]
    [InlineData("open_folder", """{"relativePath":"jarvis\\apps\\backend"}""")]
    [InlineData("open_file", """{"relativePath":"jarvis\\apps\\backend\\src\\index.ts"}""")]
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
    [InlineData("open_file", """{"relativePath":"..\\secrets.txt"}""")]
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
    public void Rejects_commands_outside_the_policy(string name, string arguments)
    {
        using var document = JsonDocument.Parse(arguments);

        Assert.False(CommandPolicy.IsValid(name, document.RootElement));
    }

    [Fact]
    public void Resolves_existing_repo_files_and_folders_and_refuses_paths_outside_the_root()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var folder = Path.Combine(root, "jarvis", "src");
        Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, "index.ts");
        File.WriteAllText(file, "export {};");

        try
        {
            Assert.True(RepoPathResolver.TryResolve(root, @"jarvis\src", expectFile: false, out var resolvedFolder));
            Assert.Equal(Path.GetFullPath(folder), resolvedFolder);
            Assert.True(RepoPathResolver.TryResolve(root, @"jarvis\src\index.ts", expectFile: true, out var resolvedFile));
            Assert.Equal(Path.GetFullPath(file), resolvedFile);
            Assert.False(RepoPathResolver.TryResolve(root, @"..\outside", expectFile: false, out _));
            Assert.False(RepoPathResolver.TryResolve(root, @"jarvis\src", expectFile: true, out _));
            Assert.False(RepoPathResolver.TryResolve(root, @"jarvis\missing.ts", expectFile: true, out _));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
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

    [Fact]
    public void Refuses_oversized_bridge_responses()
    {
        Assert.Throws<InvalidDataException>(() =>
            BridgeProtocol.Success("1730aa51-f380-4df9-a345-1feb862cb1c4",
                new { text = new string('x', BridgeProtocol.MaxMessageBytes) }));
    }
}

using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class InstalledAppMatcherTests
{
    [Fact]
    public void Matches_names_fuzzily_and_supports_the_vs_code_alias()
    {
        var apps = new[]
        {
            new InstalledApp("Spotify", @"C:\Start Menu\Spotify.lnk"),
            new InstalledApp("Visual Studio Code", @"C:\Start Menu\VS Code.lnk"),
        };

        Assert.Equal("Spotify", Assert.Single(InstalledAppMatcher.FindBestMatches("spotfy", apps)).Name);
        Assert.Equal("Visual Studio Code", Assert.Single(InstalledAppMatcher.FindBestMatches("vscode", apps)).Name);
    }

    [Fact]
    public void Returns_nearby_matches_and_never_returns_edge()
    {
        var apps = new[]
        {
            new InstalledApp("Visual Studio Code", @"C:\Start Menu\Code.lnk"),
            new InstalledApp("Visual Studio Code Insiders", @"C:\Start Menu\Code Insiders.lnk"),
            new InstalledApp("Microsoft Edge", @"C:\Start Menu\Edge.lnk"),
            new InstalledApp("Renamed Browser", @"C:\Start Menu\Other.lnk", ExecutablePath: @"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        };

        var matches = InstalledAppMatcher.FindBestMatches("visual studio", apps);

        Assert.Equal(new[] { "Visual Studio Code", "Visual Studio Code Insiders" }, matches.Select(app => app.Name));
        Assert.Empty(InstalledAppMatcher.FindBestMatches("edge", apps));
    }
}

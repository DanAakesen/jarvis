namespace Jarvis.PcBridge.Core;

public sealed record InstalledApp(
    string Name,
    string Target,
    bool IsPackaged = false,
    string? ExecutablePath = null);

public static class InstalledAppMatcher
{
    public static IReadOnlyList<InstalledApp> FindBestMatches(string requestedName, IEnumerable<InstalledApp> apps)
    {
        var query = Normalize(requestedName);
        if (query.Length == 0) return [];

        var scored = apps
            .Where(app => !string.IsNullOrWhiteSpace(app.Name) && !IsEdge(app))
            .GroupBy(app => Normalize(app.Name), StringComparer.Ordinal)
            .Select(group => (App: group.First(), Score: Score(query, Normalize(group.First().Name))))
            .Where(match => match.Score >= 60)
            .OrderByDescending(match => match.Score)
            .ThenBy(match => match.App.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (scored.Length == 0) return [];
        var best = scored[0].Score;
        return scored
            .TakeWhile(match => best - match.Score <= 4)
            .Take(8)
            .Select(match => match.App)
            .ToArray();
    }

    private static int Score(string query, string name)
    {
        if (query == name || Alias(query) == Alias(name)) return 100;
        if (query.Length >= 3 && name.Contains(query, StringComparison.Ordinal))
            return 80 + Math.Min(query.Length, 20) / 2;
        if (name.Length >= 3 && query.Contains(name, StringComparison.Ordinal))
            return 75 + Math.Min(name.Length, 20) / 2;

        var distance = EditDistance(query, name);
        var similarity = 1d - (double)distance / Math.Max(query.Length, name.Length);
        return similarity >= 0.6 ? (int)(similarity * 75) : 0;
    }

    private static string Alias(string value) => value switch
    {
        "vscode" or "visualstudiocode" => "vscode",
        _ => value,
    };

    private static bool IsEdge(InstalledApp app)
    {
        var name = Normalize(app.Name);
        var executable = app.ExecutablePath?.Replace('\\', '/').Split('/').Last();
        return name is "edge" or "microsoftedge" ||
            app.Target.Contains("Microsoft.MicrosoftEdge", StringComparison.OrdinalIgnoreCase) ||
            executable is not null && (executable.Equals("msedge.exe", StringComparison.OrdinalIgnoreCase) ||
                executable.Equals("msedge_proxy.exe", StringComparison.OrdinalIgnoreCase));
    }

    private static string Normalize(string value) =>
        new(value.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

    private static int EditDistance(string left, string right)
    {
        var previous = Enumerable.Range(0, right.Length + 1).ToArray();
        var current = new int[right.Length + 1];
        for (var i = 1; i <= left.Length; i++)
        {
            current[0] = i;
            for (var j = 1; j <= right.Length; j++)
            {
                current[j] = Math.Min(
                    Math.Min(current[j - 1] + 1, previous[j] + 1),
                    previous[j - 1] + (left[i - 1] == right[j - 1] ? 0 : 1));
            }
            (previous, current) = (current, previous);
        }
        return previous[right.Length];
    }
}

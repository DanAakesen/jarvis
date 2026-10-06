namespace Jarvis.PcBridge.Core;

public static class RepoPathResolver
{
    private static string Resolve(string root, string relativePath)
    {
        var normalized = relativePath
            .Replace('\\', Path.DirectorySeparatorChar)
            .Replace('/', Path.DirectorySeparatorChar);
        return Path.GetFullPath(Path.Combine(Path.GetFullPath(root), normalized));
    }

    public static bool TryResolve(
        string root,
        string relativePath,
        bool expectFile,
        out string resolvedPath)
    {
        resolvedPath = string.Empty;
        if (!CommandPolicy.TryNormalizeRepoPath(relativePath, out var normalized)) return false;

        var canonicalRoot = Path.GetFullPath(root);
        var candidate = Resolve(canonicalRoot, normalized);
        var relativeToRoot = Path.GetRelativePath(canonicalRoot, candidate);
        if (relativeToRoot is "." or ".." ||
            relativeToRoot.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
            Path.IsPathRooted(relativeToRoot) ||
            (expectFile ? !File.Exists(candidate) : !Directory.Exists(candidate)) ||
            ContainsReparsePoint(canonicalRoot, candidate))
        {
            return false;
        }

        resolvedPath = candidate;
        return true;
    }

    private static bool ContainsReparsePoint(string root, string path)
    {
        var current = root;
        if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
        foreach (var segment in Path.GetRelativePath(root, path).Split(Path.DirectorySeparatorChar))
        {
            current = Path.Combine(current, segment);
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
        }
        return false;
    }
}

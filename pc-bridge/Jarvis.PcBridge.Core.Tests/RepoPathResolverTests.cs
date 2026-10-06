namespace Jarvis.PcBridge.Core.Tests;

public sealed class RepoPathResolverTests
{
    [Fact]
    public void Resolves_existing_repo_files_and_folders_only_for_the_requested_kind()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var folder = Path.Combine(root, "jarvis", "apps", "backend");
        Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, "index.ts");
        File.WriteAllText(file, "test");

        try
        {
            Assert.True(RepoPathResolver.TryResolve(root, @"jarvis\apps\backend", false, out var resolvedFolder));
            Assert.Equal(folder, resolvedFolder);
            Assert.True(RepoPathResolver.TryResolve(root, @"jarvis\apps\backend\index.ts", true, out var resolvedFile));
            Assert.Equal(file, resolvedFile);
            Assert.False(RepoPathResolver.TryResolve(root, @"jarvis\apps\backend", true, out _));
            Assert.False(RepoPathResolver.TryResolve(root, @"jarvis\apps\backend\index.ts", false, out _));
            Assert.False(RepoPathResolver.TryResolve(root, @"jarvis\missing.txt", true, out _));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Refuses_paths_that_escape_the_repo_through_a_reparse_point()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var outside = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(outside);
        File.WriteAllText(Path.Combine(outside, "secret.txt"), "test");

        try
        {
            Directory.CreateSymbolicLink(Path.Combine(root, "linked"), outside);
            Assert.False(RepoPathResolver.TryResolve(root, @"linked\secret.txt", true, out _));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
            Directory.Delete(outside, recursive: true);
        }
    }
}

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

public sealed class WindowsCommandExecutor
{
    private const string RepoRoot = @"C:\Repo";

    public Task<object> ExecuteAsync(BridgeCommand command, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!CommandPolicy.IsValid(command.Command, command.Arguments))
            throw new CommandRefusedException("not_allowed");

        object result = command.Command switch
        {
            "open_url" => OpenUrl(command.Arguments.GetProperty("url").GetString()!),
            "open_app" => OpenApp(command.Arguments.GetProperty("app").GetString()!),
            "open_folder" => OpenFolder(command.Arguments.GetProperty("relativePath").GetString()!),
            "active_window" => ReadActiveWindow(),
            "focus_window" => FocusWindow(command.Arguments.GetProperty("title").GetString()!),
            _ => throw new CommandRefusedException("not_allowed"),
        };
        return Task.FromResult(result);
    }

    private static object OpenUrl(string value)
    {
        if (!CommandPolicy.TryNormalizeUrl(value, out var url)) throw new CommandRefusedException("not_allowed");
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        return new { opened = true };
    }

    private static object OpenApp(string app)
    {
        var executable = FindExecutable(app);
        if (executable is null) throw new CommandRefusedException("not_found");
        Process.Start(new ProcessStartInfo(executable) { UseShellExecute = false });
        return new { opened = true };
    }

    private static object OpenFolder(string relativePath)
    {
        if (!CommandPolicy.TryNormalizeRepoPath(relativePath, out var normalized))
            throw new CommandRefusedException("not_allowed");
        var root = Path.GetFullPath(RepoRoot);
        var fullPath = Path.GetFullPath(Path.Combine(root, normalized));
        var relativeToRoot = Path.GetRelativePath(root, fullPath);
        if (relativeToRoot == "." || relativeToRoot == ".." ||
            relativeToRoot.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
            Path.IsPathRooted(relativeToRoot) ||
            !Directory.Exists(fullPath) ||
            ContainsReparsePoint(root, fullPath))
        {
            throw new CommandRefusedException("not_found");
        }

        var code = FindExecutable("vscode");
        if (code is null) throw new CommandRefusedException("not_found");
        var start = new ProcessStartInfo(code) { UseShellExecute = false };
        start.ArgumentList.Add(fullPath);
        Process.Start(start);
        return new { opened = true };
    }

    private static bool ContainsReparsePoint(string root, string fullPath)
    {
        var current = root;
        if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
        foreach (var segment in Path.GetRelativePath(root, fullPath).Split(Path.DirectorySeparatorChar))
        {
            current = Path.Combine(current, segment);
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
        }
        return false;
    }

    private static object ReadActiveWindow()
    {
        var title = ReadActiveWindowTitle();
        return new { title };
    }

    public static string ReadActiveWindowTitle() => ReadTitle(GetForegroundWindow());

    private static object FocusWindow(string title)
    {
        var found = IntPtr.Zero;
        EnumWindows((handle, _) =>
        {
            if (IsWindowVisible(handle) && string.Equals(ReadTitle(handle), title, StringComparison.Ordinal))
            {
                found = handle;
                return false;
            }
            return true;
        }, IntPtr.Zero);

        if (found == IntPtr.Zero) throw new CommandRefusedException("not_found");
        ShowWindow(found, 9);
        if (!SetForegroundWindow(found)) throw new CommandRefusedException("failed");
        return new { activated = true };
    }

    private static string ReadTitle(IntPtr handle)
    {
        var length = Math.Clamp(GetWindowTextLength(handle), 0, 200);
        if (length == 0) return string.Empty;
        var title = new StringBuilder(length + 1);
        _ = GetWindowText(handle, title, title.Capacity);
        return new string(title.ToString().Where(character => !char.IsControl(character)).Take(200).ToArray());
    }

    private static string? FindExecutable(string app)
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string[] candidates = app switch
        {
            "vscode" =>
            [
                Path.Combine(local, "Programs", "Microsoft VS Code", "Code.exe"),
                Path.Combine(programFiles, "Microsoft VS Code", "Code.exe"),
                Path.Combine(programFilesX86, "Microsoft VS Code", "Code.exe"),
            ],
            "edge" =>
            [
                Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
            ],
            "explorer" => [Path.Combine(Environment.SystemDirectory, "explorer.exe")],
            "terminal" => [Path.Combine(local, "Microsoft", "WindowsApps", "wt.exe")],
            _ => [],
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private delegate bool EnumWindowsCallback(IntPtr handle, IntPtr state);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr handle, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr handle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr handle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr handle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr handle, int command);
}

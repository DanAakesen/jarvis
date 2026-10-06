using System.Collections;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

public sealed class WindowsCommandExecutor
{
    private const string RepoRoot = @"C:\Repo";
    private const string BrowserFallbackNote =
        "Opened in Chrome directly because the Jarvis Chrome extension isn't connected.";
    private readonly UiAutomationExecutor _uiAutomation = new(new WindowsUiAutomationProvider());

    public Task<object> ExecuteAsync(BridgeCommand command, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!CommandPolicy.IsValid(command.Command, command.Arguments))
            throw new CommandRefusedException("not_allowed");

        object result = command.Command switch
        {
            "open_url" => OpenUrlInDefaultBrowser(command.Arguments.GetProperty("url").GetString()!),
            "open_app" => OpenApp(command.Arguments.GetProperty("app").GetString()!),
            "media" => ControlMedia(command.Arguments.GetProperty("action").GetString()!),
            "open_folder" => OpenFolder(command.Arguments.GetProperty("relativePath").GetString()!),
            "active_window" => ReadActiveWindow(),
            "focus_window" => FocusWindow(command.Arguments.GetProperty("title").GetString()!),
            "uia_snapshot" => _uiAutomation.Observe(cancellationToken),
            "uia_act" => ActOnUiAutomation(command.Arguments, cancellationToken),
            _ => throw new CommandRefusedException("not_allowed"),
        };
        return Task.FromResult(result);
    }

    // Dan uses Chrome only: never hand a website to the Windows default browser (Edge).
    private object ActOnUiAutomation(JsonElement arguments, CancellationToken cancellationToken)
    {
        var actionName = arguments.GetProperty("action").GetString()!;
        var action = actionName switch
        {
            "click" => UiAutomationAction.Click,
            "type" => UiAutomationAction.Type,
            "scroll_up" => UiAutomationAction.ScrollUp,
            "scroll_down" => UiAutomationAction.ScrollDown,
            _ => throw new CommandRefusedException("not_allowed"),
        };
        var acted = _uiAutomation.Act(
            arguments.GetProperty("snapshotId").GetString()!,
            arguments.GetProperty("elementIndex").GetInt32(),
            action,
            action == UiAutomationAction.Type ? arguments.GetProperty("text").GetString() : null,
            (action is UiAutomationAction.Click or UiAutomationAction.Type) &&
                arguments.GetProperty("confirmed").GetBoolean(),
            cancellationToken);
        return acted
            ? new { acted = true, action = actionName }
            : new
            {
                confirmationRequired = true,
                actionKind = "computer_use",
                summary = "Activate a potentially destructive Windows control.",
            };
    }

    public object OpenUrlInDefaultBrowser(string value)
    {
        if (!CommandPolicy.TryNormalizeUrl(value, out var url)) throw new CommandRefusedException("not_allowed");
        var chrome = FindExecutable("chrome");
        if (chrome is null) throw new CommandRefusedException("not_found");
        var start = new ProcessStartInfo(chrome) { UseShellExecute = false };
        start.ArgumentList.Add(url);
        using var process = Process.Start(start);
        AllowForeground(process);
        return new { opened = true, note = BrowserFallbackNote };
    }

    private static object OpenApp(string app)
    {
        var matches = InstalledAppMatcher.FindBestMatches(app, FindInstalledApps());
        if (matches.Count == 0) throw new CommandRefusedException("not_found");
        if (matches.Count > 1)
            return new { opened = false, candidates = matches.Select(match => match.Name).ToArray() };

        var match = matches[0];
        var start = match.IsPackaged
            ? new ProcessStartInfo("explorer.exe") { UseShellExecute = false }
            : new ProcessStartInfo(match.Target) { UseShellExecute = true };
        if (match.IsPackaged) start.ArgumentList.Add($@"shell:AppsFolder\{match.Target}");
        using var process = Process.Start(start);
        // The app has launched at this point; foreground permission is best-effort because the
        // background bridge may not be allowed to grant it (L109).
        if (process is not null) _ = AllowSetForegroundWindow((uint)process.Id);
        return new { opened = true, app = match.Name };
    }

    private static object ControlMedia(string action)
    {
        if (!CommandPolicy.TryGetMediaVirtualKey(action, out var key))
            throw new CommandRefusedException("not_allowed");
        var inputs = new[]
        {
            KeyboardInputEvent(key, 0),
            KeyboardInputEvent(key, KeyEventKeyUp),
        };
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<NativeInput>());
        if (sent == 1)
        {
            _ = SendInput(1, [KeyboardInputEvent(key, KeyEventKeyUp)], Marshal.SizeOf<NativeInput>());
        }
        if (sent != inputs.Length) throw new CommandRefusedException("failed");
        return new { controlled = true, action };
    }

    private static IReadOnlyList<InstalledApp> FindInstalledApps() =>
        RunOnStaThread(FindInstalledAppsOnSta);

    private static IReadOnlyList<InstalledApp> FindInstalledAppsOnSta()
    {
        var apps = new List<InstalledApp>();
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
        };
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in roots.Where(Directory.Exists))
        {
            var pending = new Queue<(string Path, int Depth)>();
            pending.Enqueue((root, 0));
            while (pending.Count > 0 && visited.Count < 2_000 && apps.Count < 2_000)
            {
                var (directory, depth) = pending.Dequeue();
                string fullDirectory;
                try
                {
                    fullDirectory = Path.GetFullPath(directory);
                    if (!visited.Add(fullDirectory) ||
                        (File.GetAttributes(fullDirectory) & FileAttributes.ReparsePoint) != 0) continue;
                    foreach (var shortcut in Directory.EnumerateFiles(fullDirectory, "*.lnk"))
                    {
                        if (apps.Count >= 2_000) break;
                        var target = ReadShortcutTarget(shortcut);
                        if (string.IsNullOrWhiteSpace(target)) continue;
                        var name = Path.GetFileNameWithoutExtension(shortcut);
                        if (name.Length > 128) name = name[..128];
                        apps.Add(new InstalledApp(name, shortcut, ExecutablePath: target));
                    }
                    if (depth < 6)
                    {
                        foreach (var child in Directory.EnumerateDirectories(fullDirectory))
                        {
                            if (pending.Count >= 2_000) break;
                            pending.Enqueue((child, depth + 1));
                        }
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }

        apps.AddRange(FindAppsFolderApps());
        return apps;
    }

    private static string? ReadShortcutTarget(string path)
    {
        object? shell = null;
        object? shortcut = null;
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null) return null;
            shell = Activator.CreateInstance(shellType);
            if (shell is null) return null;
            dynamic automation = shell;
            shortcut = automation.CreateShortcut(path);
            dynamic link = shortcut;
            return (string?)link.TargetPath;
        }
        catch
        {
            return null;
        }
        finally
        {
            if (shortcut is not null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    private static IReadOnlyList<InstalledApp> FindAppsFolderApps()
    {
        object? shell = null;
        object? folder = null;
        object? items = null;
        var apps = new List<InstalledApp>();
        try
        {
            var shellType = Type.GetTypeFromProgID("Shell.Application");
            if (shellType is null) return apps;
            shell = Activator.CreateInstance(shellType);
            if (shell is null) return apps;
            dynamic automation = shell;
            folder = automation.Namespace("shell:AppsFolder");
            if (folder is null) return apps;
            dynamic appFolder = folder;
            items = appFolder.Items();
            if (items is null) return apps;
            foreach (var item in (IEnumerable)items)
            {
                if (item is null) continue;
                object? entry = item;
                try
                {
                    dynamic app = entry;
                    var name = (string?)app.Name;
                    var target = (string?)app.Path;
                    if (!string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(target))
                        apps.Add(new InstalledApp(name.Length > 128 ? name[..128] : name, target, IsPackaged: true));
                }
                catch { }
                finally
                {
                    if (entry is not null && Marshal.IsComObject(entry)) Marshal.FinalReleaseComObject(entry);
                }
            }
        }
        catch { }
        finally
        {
            if (items is not null && Marshal.IsComObject(items)) Marshal.FinalReleaseComObject(items);
            if (folder is not null && Marshal.IsComObject(folder)) Marshal.FinalReleaseComObject(folder);
            if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
        return apps;
    }

    private static T RunOnStaThread<T>(Func<T> action)
    {
        T? result = default;
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try { result = action(); }
            catch (Exception exception) { failure = exception; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (failure is not null) throw failure;
        return result!;
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
        using var process = Process.Start(start);
        AllowForeground(process);
        return new { opened = true };
    }

    private static void AllowForeground(Process? process)
    {
        if (process is null || !AllowSetForegroundWindow((uint)process.Id))
            throw new CommandRefusedException("failed");
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
            "chrome" =>
            [
                Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(local, "Google", "Chrome", "Application", "chrome.exe"),
            ],
            "explorer" => [Path.Combine(Environment.SystemDirectory, "explorer.exe")],
            "terminal" => [Path.Combine(local, "Microsoft", "WindowsApps", "wt.exe")],
            _ => [],
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private const uint KeyEventKeyUp = 0x0002;
    private const uint InputKeyboard = 1;

    private static NativeInput KeyboardInputEvent(ushort key, uint flags) => new()
    {
        Type = InputKeyboard,
        Data = new InputUnion
        {
            Keyboard = new KeyboardInput { VirtualKey = key, Flags = flags },
        },
    };

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeInput
    {
        public uint Type;
        public InputUnion Data;
    }

    // INPUT must be 40 bytes on 64-bit Windows: the union is sized by MOUSEINPUT. With only the
    // keyboard member it was 32 bytes and SendInput rejected every media key (error 87; L109).
    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public KeyboardInput Keyboard;
        [FieldOffset(0)]
        public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X;
        public int Y;
        public uint Data;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
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
    private static extern bool AllowSetForegroundWindow(uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr handle, int command);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, NativeInput[] inputs, int size);
}

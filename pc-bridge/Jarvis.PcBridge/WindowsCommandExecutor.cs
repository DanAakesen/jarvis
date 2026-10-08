using System.Collections;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

public sealed class WindowsCommandExecutor : IWindowCaptureProvider
{
    private const string RepoRoot = @"C:\Repo";
    private const int MaxCapturePngBytes = 750_000;
    private const string BrowserFallbackNote =
        "Opened in Chrome directly because the Jarvis Chrome extension isn't connected.";
    private readonly UiAutomationExecutor _uiAutomation = new(new WindowsUiAutomationProvider());
    private readonly WindowCaptureExecutor _windowCapture;
    private readonly KeyboardExecutor _keyboard;
    private readonly Control? _clipboardDispatcher;

    public WindowsCommandExecutor(KeyboardExecutor? keyboard = null, Control? clipboardDispatcher = null)
    {
        _windowCapture = new WindowCaptureExecutor(this);
        _keyboard = keyboard ?? new KeyboardExecutor(new WindowsKeyboardProvider());
        _clipboardDispatcher = clipboardDispatcher;
    }

    public Task<object> ExecuteAsync(BridgeCommand command, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!CommandPolicy.IsValid(command.Command, command.Arguments))
            throw new CommandRefusedException("not_allowed");

        object result = command.Command switch
        {
            "open_url" => OpenUrlInDefaultBrowser(command.Arguments.GetProperty("url").GetString()!),
            "open_app" => OpenApp(command.Arguments.GetProperty("app").GetString()!),
            "close_app" => CloseApp(command.Arguments.GetProperty("app").GetString()!),
            "media" => ControlMedia(command.Arguments.GetProperty("action").GetString()!),
            "open_folder" => OpenFolder(command.Arguments.GetProperty("relativePath").GetString()!),
            "open_file" => OpenFile(command.Arguments.GetProperty("relativePath").GetString()!),
            "active_window" => ReadActiveWindow(),
            "focus_window" => FocusWindow(command.Arguments.GetProperty("title").GetString()!),
            "uia_snapshot" => _uiAutomation.Observe(cancellationToken),
            "uia_act" => ActOnUiAutomation(command.Arguments, cancellationToken),
            "window_capture" => _windowCapture.Capture(cancellationToken),
            "click_point" => ActOnPoint(command.Command, command.Arguments, cancellationToken),
            "scroll_point" => ActOnPoint(command.Command, command.Arguments, cancellationToken),
            "clipboard_read" => ReadClipboard(cancellationToken),
            "clipboard_write" => WriteClipboard(command.Arguments.GetProperty("text").GetString()!, cancellationToken),
            _ => throw new CommandRefusedException("not_allowed"),
        };
        return Task.FromResult(result);
    }

    private object ReadClipboard(CancellationToken cancellationToken)
    {
        var text = InvokeClipboard(() =>
            Clipboard.ContainsText(TextDataFormat.UnicodeText)
                ? Clipboard.GetText(TextDataFormat.UnicodeText)
                : string.Empty,
            cancellationToken);
        if (!CommandPolicy.IsValidClipboardText(text)) throw new CommandRefusedException("too_large");
        return new { text };
    }

    private object WriteClipboard(string text, CancellationToken cancellationToken)
    {
        InvokeClipboard(() =>
        {
            if (text.Length == 0) Clipboard.Clear();
            else Clipboard.SetText(text, TextDataFormat.UnicodeText);
            return true;
        }, cancellationToken);
        return new { written = true };
    }

    private T InvokeClipboard<T>(Func<T> action, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var dispatcher = _clipboardDispatcher;
        if (dispatcher is null || dispatcher.IsDisposed || !dispatcher.IsHandleCreated)
            throw new InvalidOperationException("Clipboard dispatcher is unavailable.");
        T InvokeAction()
        {
            cancellationToken.ThrowIfCancellationRequested();
            return action();
        }
        return dispatcher.InvokeRequired ? (T)dispatcher.Invoke((Func<T>)InvokeAction)! : InvokeAction();
    }

    public WindowCaptureFrame? Capture(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (WindowsUiAutomationProvider.IsSensitiveControlFocused())
            throw new WindowCaptureRefusedException("blocked");

        var handle = GetForegroundWindow();
        if (handle == IntPtr.Zero || IsIconic(handle) || !GetWindowRect(handle, out var rect))
            throw new WindowCaptureRefusedException("not_found");
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width is <= 0 or > 16_384 || height is <= 0 or > 16_384 ||
            (long)width * height > 50_000_000)
            throw new WindowCaptureRefusedException("failed");

        var targetWidth = Math.Min(width, 1280);
        var targetHeight = Math.Min(height, 720);
        var scale = Math.Min((double)targetWidth / width, (double)targetHeight / height);
        targetWidth = Math.Max(1, (int)Math.Round(width * scale));
        targetHeight = Math.Max(1, (int)Math.Round(height * scale));
        using var source = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(source))
            graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);

        byte[] png;
        for (;;)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var target = new Bitmap(targetWidth, targetHeight, PixelFormat.Format32bppArgb);
            using (var graphics = Graphics.FromImage(target))
            {
                graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                graphics.DrawImage(source, 0, 0, targetWidth, targetHeight);
            }
            using var stream = new MemoryStream();
            target.Save(stream, ImageFormat.Png);
            png = stream.ToArray();
            if (png.Length <= MaxCapturePngBytes) break;
            Array.Clear(png);
            targetWidth = (int)(targetWidth * 0.8);
            targetHeight = (int)(targetHeight * 0.8);
            if (targetWidth < 320 || targetHeight < 180)
                throw new WindowCaptureRefusedException("failed");
        }

        cancellationToken.ThrowIfCancellationRequested();
        var app = ProcessName(handle) switch
        {
            "code" => "vscode",
            "explorer" => "explorer",
            var name => name,
        };
        return new WindowCaptureFrame(
            app, handle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),
            rect.Left, rect.Top, width, height, targetWidth, targetHeight, png);
    }

    public void ActAt(
        WindowCaptureFrame frame,
        int x,
        int y,
        WindowPointAction action,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!long.TryParse(frame.WindowId, System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture, out var windowId))
            throw new WindowCaptureRefusedException("stale");
        var handle = new IntPtr(windowId);
        if (GetForegroundWindow() != handle || IsIconic(handle) ||
            !GetWindowRect(handle, out var rect) ||
            rect.Left != frame.Left || rect.Top != frame.Top ||
            rect.Right - rect.Left != frame.WindowWidth || rect.Bottom - rect.Top != frame.WindowHeight)
            throw new WindowCaptureRefusedException("stale");
        if (WindowsUiAutomationProvider.IsSensitiveControlFocused())
            throw new WindowCaptureRefusedException("blocked");

        var screenX = rect.Left + Math.Min(frame.WindowWidth - 1,
            (int)((x + 0.5) * frame.WindowWidth / frame.Width));
        var screenY = rect.Top + Math.Min(frame.WindowHeight - 1,
            (int)((y + 0.5) * frame.WindowHeight / frame.Height));
        if (!SetCursorPos(screenX, screenY)) throw new WindowCaptureRefusedException("failed");
        cancellationToken.ThrowIfCancellationRequested();

        var inputs = action switch
        {
            WindowPointAction.Click =>
                new[] { MouseInputEvent(0, 0x0002), MouseInputEvent(0, 0x0004) },
            WindowPointAction.ScrollUp => [MouseInputEvent(120, 0x0800)],
            WindowPointAction.ScrollDown => [MouseInputEvent(unchecked((uint)-120), 0x0800)],
            _ => throw new WindowCaptureRefusedException("not_allowed"),
        };
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<NativeInput>());
        if (action == WindowPointAction.Click && sent == 1)
            _ = SendInput(1, [MouseInputEvent(0, 0x0004)], Marshal.SizeOf<NativeInput>());
        if (sent != inputs.Length) throw new WindowCaptureRefusedException("failed");
        cancellationToken.ThrowIfCancellationRequested();
    }

    private object ActOnPoint(string command, JsonElement arguments, CancellationToken cancellationToken)
    {
        var action = command switch
        {
            "click_point" => WindowPointAction.Click,
            "scroll_point" => arguments.GetProperty("direction").GetString() switch
            {
                "up" => WindowPointAction.ScrollUp,
                "down" => WindowPointAction.ScrollDown,
                _ => throw new WindowCaptureRefusedException("not_allowed"),
            },
            _ => throw new WindowCaptureRefusedException("not_allowed"),
        };
        _windowCapture.ActAt(
            arguments.GetProperty("snapshotId").GetString()!,
            arguments.GetProperty("x").GetInt32(),
            arguments.GetProperty("y").GetInt32(),
            action,
            cancellationToken);
        var actionName = action switch
        {
            WindowPointAction.Click => "click",
            WindowPointAction.ScrollUp => "scroll_up",
            WindowPointAction.ScrollDown => "scroll_down",
            _ => throw new WindowCaptureRefusedException("not_allowed"),
        };
        return new { acted = true, action = actionName };
    }

    // Dan uses Chrome only: never hand a website to the Windows default browser (Edge).
    private object ActOnUiAutomation(JsonElement arguments, CancellationToken cancellationToken)
    {
        var actionName = arguments.GetProperty("action").GetString()!;
        if (actionName is "keys" or "type_focused")
        {
            _uiAutomation.EnsureCurrentWindow(arguments.GetProperty("snapshotId").GetString()!, cancellationToken);
            return _keyboard.Execute(actionName, arguments, cancellationToken);
        }
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
        var executable = Path.GetFileNameWithoutExtension(match.ExecutablePath ?? match.Target);
        _ = Task.Run(() => BringNewWindowToFront(executable, match.Name));
        return new { opened = true, app = match.Name };
    }

    // Windows only lets the process that received the last input take the foreground, so the
    // background bridge sends a synthetic Alt key first (L110). Best effort; failures are ignored.
    public static void BringToFront(IntPtr window)
    {
        if (window == IntPtr.Zero) return;
        if (IsIconic(window)) ShowWindow(window, 9);
        var alt = new[] { KeyboardInputEvent(0x12, 0), KeyboardInputEvent(0x12, KeyEventKeyUp) };
        _ = SendInput((uint)alt.Length, alt, Marshal.SizeOf<NativeInput>());
        _ = SetForegroundWindow(window);
    }

    public static void BringChromeToFront() => BringToFront(FindTopWindow(processName => processName == "chrome", _ => false));

    // Without the extension, a Chrome window whose active tab is the Jarvis page is titled "Jarvis - …".
    public static bool BringJarvisChromeWindowToFront()
    {
        var found = IntPtr.Zero;
        EnumWindows((handle, _) =>
        {
            if (!IsWindowVisible(handle)) return true;
            var title = ReadTitle(handle);
            if (title.StartsWith("Jarvis - ", StringComparison.Ordinal) && ProcessName(handle) == "chrome")
            {
                found = handle;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        BringToFront(found);
        return true;
    }

    private static void BringNewWindowToFront(string executable, string appName)
    {
        var wanted = InstalledAppMatcher.Expand(InstalledAppMatcher.Normalize(appName));
        var process = InstalledAppMatcher.Normalize(executable);
        for (var attempt = 0; attempt < 25; attempt++)
        {
            Thread.Sleep(200);
            var window = FindTopWindow(
                name => process.Length > 0 && InstalledAppMatcher.Normalize(name) == process,
                title => wanted.Length > 0 &&
                    InstalledAppMatcher.Expand(InstalledAppMatcher.Normalize(title)).Contains(wanted, StringComparison.Ordinal));
            if (window != IntPtr.Zero)
            {
                BringToFront(window);
                return;
            }
        }
    }

    // Top-most visible titled window whose process name or title matches (EnumWindows is z-ordered).
    private static IntPtr FindTopWindow(Func<string, bool> processMatches, Func<string, bool> titleMatches)
    {
        var found = IntPtr.Zero;
        EnumWindows((handle, _) =>
        {
            if (!IsWindowVisible(handle)) return true;
            var title = ReadTitle(handle);
            if (string.IsNullOrWhiteSpace(title)) return true;
            if (processMatches(ProcessName(handle)) || titleMatches(title))
            {
                found = handle;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static string ProcessName(IntPtr window)
    {
        _ = GetWindowThreadProcessId(window, out var processId);
        try
        {
            using var process = Process.GetProcessById((int)processId);
            return process.ProcessName.ToLowerInvariant();
        }
        catch (ArgumentException)
        {
            return string.Empty;
        }
        catch (InvalidOperationException)
        {
            return string.Empty;
        }
    }

    // Graceful close: the app receives WM_CLOSE and can still ask to save unsaved work.
    private static object CloseApp(string app)
    {
        var wanted = InstalledAppMatcher.Expand(InstalledAppMatcher.Normalize(app));
        if (wanted.Length < 2) throw new CommandRefusedException("not_allowed");
        var self = (uint)Environment.ProcessId;
        var windows = new List<IntPtr>();
        EnumWindows((handle, _) =>
        {
            if (windows.Count >= 10) return false;
            if (!IsWindowVisible(handle)) return true;
            var title = ReadTitle(handle);
            if (string.IsNullOrWhiteSpace(title) || title == "Program Manager") return true;
            GetWindowThreadProcessId(handle, out uint processId);
            if (processId == self) return true;
            var processName = InstalledAppMatcher.Expand(InstalledAppMatcher.Normalize(ProcessName(handle)));
            var normalizedTitle = InstalledAppMatcher.Expand(InstalledAppMatcher.Normalize(title));
            if (processName == wanted || normalizedTitle == wanted ||
                normalizedTitle.EndsWith(wanted, StringComparison.Ordinal))
            {
                windows.Add(handle);
            }
            return true;
        }, IntPtr.Zero);
        if (windows.Count == 0) throw new CommandRefusedException("not_found");
        foreach (var window in windows) _ = PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
        return new { closing = true, windows = windows.Count };
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

    private static object OpenFolder(string relativePath) => OpenRepoPath(relativePath, expectFile: false);

    private static object OpenFile(string relativePath) => OpenRepoPath(relativePath, expectFile: true);

    private static object OpenRepoPath(string relativePath, bool expectFile)
    {
        if (!RepoPathResolver.TryResolve(RepoRoot, relativePath, expectFile, out var fullPath))
            throw new CommandRefusedException("not_found");

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

    private static NativeInput MouseInputEvent(uint data, uint flags) => new()
    {
        Type = 0,
        Data = new InputUnion
        {
            Mouse = new MouseInput { Data = data, Flags = flags },
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

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr handle, out NativeRect rect);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetCursorPos(int x, int y);

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

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr handle);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}

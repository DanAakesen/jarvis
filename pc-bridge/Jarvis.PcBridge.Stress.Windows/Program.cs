using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Jarvis.PcBridge;
using Jarvis.PcBridge.Core;
using Jarvis.PcBridge.Stress;

namespace Jarvis.PcBridge.Stress.Windows;

internal static class Program
{
    private const string FixturePrefix = "Jarvis owned stress ";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 3 && args[0] == "--fixture") return RunFixture(args[1], args[2]);
        if (args.Length == 0 || args[0] != "--real-windows" || args.Skip(1).Any(arg => arg != "--interactive-media"))
        {
            Console.Error.WriteLine("Usage: dotnet run --project pc-bridge/Jarvis.PcBridge.Stress.Windows -c Release -- --real-windows [--interactive-media]");
            return 2;
        }
        if (!Environment.UserInteractive)
        {
            Console.WriteLine("SKIP: real Windows harness requires an interactive desktop; no application or input launched.");
            return 0;
        }
        try { return RunAsync(args.Contains("--interactive-media")).GetAwaiter().GetResult(); }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"FAIL: {exception.GetType().Name}: {exception.Message}");
            return 1;
        }
    }

    private static int RunFixture(string title, string parent)
    {
        if (!title.StartsWith(FixturePrefix, StringComparison.Ordinal) ||
            !Guid.TryParseExact(title[FixturePrefix.Length..], "N", out _) ||
            !int.TryParse(parent, out var parentId))
        {
            Console.Error.WriteLine("No opt-in: fixture launches only from its owning --real-windows harness.");
            return 2;
        }
        try
        {
            using var owner = Process.GetProcessById(parentId);
            if (!string.Equals(owner.MainModule?.FileName, Environment.ProcessPath,
                StringComparison.OrdinalIgnoreCase)) return 2;
        }
        catch (Exception) { return 2; }
        ApplicationConfiguration.Initialize();
        using var window = new Form { Text = title, Width = 600, Height = 360 };
        window.Controls.Add(new TextBox
        {
            Multiline = true, Dock = DockStyle.Fill, AccessibleName = "Fixture document",
            ReadOnly = false,
        });
        window.Shown += (_, _) => window.Activate();
        Application.Run(window);
        return 0;
    }

    private static async Task<int> RunAsync(bool interactiveMedia)
    {
        Check(!HasExistingNotepad(), "REFUSED: existing Notepad process/window; no application was launched or closed.");
        var executable = Environment.ProcessPath!;
        if (!Path.GetFileNameWithoutExtension(executable).Equals(
            "Jarvis.PcBridge.Stress.Windows", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Run the compiled apphost or dotnet run, not dotnet <dll>.");
        Console.WriteLine("OPT-IN: real Windows executor snapshot/close commands against a directly launched harness-owned child WinForms target only. Native open_app discovery is not exercised; the portable fake loop covers open_app. No user application is opened or closed.");
        Console.WriteLine(interactiveMedia
            ? "INTERACTIVE MEDIA OPT-IN: global play/pause media input will be sent, subject to production idle-input policy."
            : "Media SKIPPED: use --interactive-media explicitly to permit global synthetic media input.");
        Console.WriteLine("Measurements cover the harness process, not child CPU/handles. Scheduler probe is NOT WinForms responsiveness; WM_NULL messages separately check only the owned target's message-loop responsiveness.");
        Console.WriteLine("Safety: refuse existing Notepad processes/windows; exactly three repeats, 45-second run deadline, Ctrl+C cancellation; cleanup touches only the retained owned child PID.");

        var title = FixturePrefix + Guid.NewGuid().ToString("N");
        using var executor = new WindowsCommandExecutor();
        var logDirectory = Path.Combine(Path.GetTempPath(), "Jarvis.PcBridge.Stress.Windows", Guid.NewGuid().ToString("N"));
        var cleanup = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var worker = new BoundedCommandWorker(new BridgeDiagnostics(logDirectory),
            new CommandWorkerOptions { MaxCpuCores = 4, MaxHandles = 8192, MaxHandleGrowth = 1024 },
            cleanup: () => { cleanup.TrySetResult(); return Task.CompletedTask; });
        using var probe = new ResourceProbe();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        ConsoleCancelEventHandler cancelHandler = (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellation.Cancel();
        };
        Console.CancelKeyPress += cancelHandler;
        var opened = 0;
        var snapshots = 0;
        var closed = 0;
        var maxOwnedWindowMessageLatencyMs = 0d;
        Process? child = null;
        try
        {
            for (var iteration = 0; iteration < 3; iteration++)
            {
                cancellation.Token.ThrowIfCancellationRequested();
                Check(!HasExistingNotepad(), "REFUSED: Notepad appeared during stress; no user application will be closed.");
                var start = new ProcessStartInfo(executable) { UseShellExecute = false };
                start.ArgumentList.Add("--fixture");
                start.ArgumentList.Add(title);
                start.ArgumentList.Add(Environment.ProcessId.ToString());
                child = Process.Start(start) ?? throw new InvalidOperationException("Owned fixture launch failed.");
                _ = child.SafeHandle;
                opened++;
                await AwaitOwnedWindow(child, title, cancellation.Token);
                var window = child.MainWindowHandle;
                await AwaitForeground(window, cancellation.Token);
                var snapshot = (UiAutomationSnapshot)await RunCommand("uia_snapshot", new { });
                Check(snapshot.Application.Equals(Path.GetFileNameWithoutExtension(executable),
                    StringComparison.OrdinalIgnoreCase), "UIA must observe only the owned fixture");
                snapshots++;
                var messageStarted = Stopwatch.GetTimestamp();
                var alive = SendMessageTimeout(window, 0, IntPtr.Zero, IntPtr.Zero, 2, 1000, out _);
                maxOwnedWindowMessageLatencyMs = Math.Max(maxOwnedWindowMessageLatencyMs,
                    Stopwatch.GetElapsedTime(messageStarted).TotalMilliseconds);
                Check(alive != IntPtr.Zero, "owned target must answer a bounded WM_NULL message");
                if (interactiveMedia) await RunCommand("media", new { action = "play_pause" });
                var command = MakeCommand("close_app", new { app = title });
                Check(!HasExistingNotepad(), "REFUSED: Notepad appeared before close; only owned fixture cleanup is permitted.");
                _ = GetWindowThreadProcessId(window, out var windowProcessId);
                Check(!child.HasExited && windowProcessId == (uint)child.Id,
                    "REFUSED: close_app target must still match the retained owned process");
                Check(OnlyOwnedWindowMatches(title, window, child.Id),
                    "REFUSED: every native close_app title match must belong to the owned fixture");
                await RunCommand(command.Command, new { app = title });
                await child.WaitForExitAsync(cancellation.Token).WaitAsync(TimeSpan.FromSeconds(5), cancellation.Token);
                Check(child.ExitCode == 0, "owned fixture must exit cleanly");
                child.Dispose();
                child = null;
                closed++;
            }
            probe.Print("real_windows_production_owned_fixture", new
            {
                opened, snapshots, closed, mediaCommands = interactiveMedia ? 3 : 0,
                maxOwnedWindowMessageLatencyMs = Math.Round(maxOwnedWindowMessageLatencyMs, 2),
                passed = true,
            }, evidence: "real_windows_owned_fixture_no_before_fix_machine_comparison");
            Console.WriteLine("PASS: real Windows UIA/nonce-title close loop against a directly launched owned PID; media requires separate interactive opt-in. Native open_app not tested.");
            return 0;
        }
        finally
        {
            Console.CancelKeyPress -= cancelHandler;
            try
            {
                executor.Dispose();
                worker.Dispose();
                if (child is not null)
                {
                    try
                    {
                        if (!child.HasExited)
                        {
                            child.CloseMainWindow();
                            try { await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(2)); }
                            catch (TimeoutException) { child.Kill(entireProcessTree: false); }
                        }
                    }
                    finally { child.Dispose(); }
                }
            }
            finally
            {
                await cleanup.Task.WaitAsync(TimeSpan.FromSeconds(3));
                if (Directory.Exists(logDirectory)) Directory.Delete(logDirectory, recursive: true);
            }
        }

        Task<object> RunCommand(string name, object arguments)
        {
            var command = MakeCommand(name, arguments);
            return probe.CommandAsync(() => worker.ExecuteAsync(name,
                token => executor.ExecuteAsync(command, token), cancellation.Token))
                .WaitAsync(TimeSpan.FromSeconds(15), cancellation.Token);
        }
    }

    private static async Task AwaitOwnedWindow(Process child, string title, CancellationToken cancellationToken)
    {
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < TimeSpan.FromSeconds(5))
        {
            child.Refresh();
            if (child.HasExited) throw new InvalidOperationException("Owned fixture exited before presenting its window.");
            if (child.MainWindowHandle != IntPtr.Zero && child.MainWindowTitle == title) return;
            await Task.Delay(50, cancellationToken);
        }
        throw new TimeoutException("Owned fixture did not present its unique window.");
    }

    private static async Task AwaitForeground(IntPtr ownedWindow, CancellationToken cancellationToken)
    {
        var deadline = Stopwatch.StartNew();
        while (GetForegroundWindow() != ownedWindow && deadline.Elapsed < TimeSpan.FromSeconds(5))
            await Task.Delay(50, cancellationToken);
        Check(GetForegroundWindow() == ownedWindow, "foreground permission unavailable; refusing to snapshot another application");
    }

    private static BridgeCommand MakeCommand(string name, object arguments) =>
        new(Guid.NewGuid().ToString("D"), "command", name, JsonSerializer.SerializeToElement(arguments));

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static bool HasExistingNotepad()
    {
        var processes = Process.GetProcessesByName("notepad");
        try { if (processes.Length > 0) return true; }
        finally { foreach (var process in processes) process.Dispose(); }
        var found = false;
        EnumWindows((window, parameter) =>
        {
            var title = new StringBuilder(4096);
            _ = GetWindowText(window, title, title.Capacity);
            if (!title.ToString().EndsWith("notepad", StringComparison.OrdinalIgnoreCase)) return true;
            found = true;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    private static bool OnlyOwnedWindowMatches(string title, IntPtr ownedWindow, int ownedProcessId)
    {
        var wanted = InstalledAppMatcher.Expand(InstalledAppMatcher.Normalize(title));
        var matches = 0;
        var valid = true;
        EnumWindows((window, parameter) =>
        {
            var text = new StringBuilder(4096);
            _ = GetWindowText(window, text, text.Capacity);
            var normalized = InstalledAppMatcher.Expand(InstalledAppMatcher.Normalize(text.ToString()));
            if (normalized != wanted && !normalized.EndsWith(wanted, StringComparison.Ordinal)) return true;
            _ = GetWindowThreadProcessId(window, out var processId);
            matches++;
            valid &= window == ownedWindow && processId == (uint)ownedProcessId;
            return true;
        }, IntPtr.Zero);
        return valid && matches == 1;
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder title, int count);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam,
        IntPtr lParam, uint flags, uint timeout, out IntPtr result);
}

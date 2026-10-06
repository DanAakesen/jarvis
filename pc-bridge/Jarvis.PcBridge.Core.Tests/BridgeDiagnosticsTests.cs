using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class BridgeDiagnosticsTests
{
    [Fact]
    public async Task Logs_only_allowlisted_fields_and_rotates_to_one_bounded_backup()
    {
        var directory = Path.GetFullPath(Path.Combine(".test-diagnostics", Guid.NewGuid().ToString("N")));
        try
        {
            var diagnostics = new BridgeDiagnostics(directory, 1024);
            diagnostics.Write("secret-url\n", "token-secret\n", "exception-secret", TimeSpan.FromMilliseconds(12),
                new(TimeSpan.FromMilliseconds(10), 7, 8), 0.5);
            var path = Path.Combine(directory, "diagnostics.log");
            var log = File.ReadAllText(path);
            Assert.DoesNotContain("secret", log);
            Assert.Contains("command=unknown outcome=failed", log);
            Assert.Contains("duration_ms=12 cpu_ms=10 cpu_cores=0.50 threads=7 handles=8", log);
            for (var i = 0; i < 30; i++)
                diagnostics.Write("watchdog", "uia_act", "budget", TimeSpan.Zero, default, 2);
            await diagnostics.WriteSampleAsync();
            Assert.True(new FileInfo(path).Length <= 1024);
            Assert.True(new FileInfo(path + ".1").Length <= 1024);
            Assert.Equal(2, Directory.GetFiles(directory).Length);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task Safe_io_failures_do_not_escape_tray_sample_or_command_log()
    {
        var directory = Path.GetFullPath(Path.Combine(".test-diagnostics", Guid.NewGuid().ToString("N")));
        Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, "not-a-directory");
        File.WriteAllText(file, "");
        try
        {
            var diagnostics = new BridgeDiagnostics(file);
            Assert.False(diagnostics.Write("command", "open_url", "completed", TimeSpan.Zero, default, 0));
            Assert.False(await diagnostics.WriteSampleAsync());
        }
        finally { Directory.Delete(directory, true); }
    }
}

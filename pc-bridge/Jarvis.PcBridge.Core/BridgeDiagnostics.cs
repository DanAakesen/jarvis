using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace Jarvis.PcBridge.Core;

public readonly record struct BridgeResourceSample(TimeSpan CpuTime, int Threads, int Handles)
{
    public static BridgeResourceSample Read()
    {
        using var process = Process.GetCurrentProcess();
        return new(process.TotalProcessorTime, process.Threads.Count, process.HandleCount);
    }
}

public sealed class BridgeDiagnostics
{
    private readonly object _gate = new();
    private readonly string _path;
    private readonly long _maxBytes;
    private int _sampling;

    public BridgeDiagnostics(string? directory = null, long maxBytes = 256 * 1024)
    {
        _path = Path.Combine(directory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Jarvis", "PcBridge"), "diagnostics.log");
        _maxBytes = Math.Max(1024, maxBytes);
    }

    public Task<bool> WriteSampleAsync()
    {
        if (Interlocked.CompareExchange(ref _sampling, 1, 0) != 0) return Task.FromResult(false);
        return Task.Run(() =>
        {
            try { return Write("sample", "", "sample", TimeSpan.Zero, BridgeResourceSample.Read(), 0); }
            catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException)
            { return false; }
            finally { Volatile.Write(ref _sampling, 0); }
        });
    }

    public bool Write(string kind, string command, string outcome, TimeSpan elapsed,
        BridgeResourceSample sample, double cpuCores)
    {
        var safeCommand = command is "open_url" or "open_app" or "close_app" or "media" or
            "open_folder" or "active_window" or "focus_window" or "browser_tabs" or
            "browser_snapshot" or "browser_act" or "uia_snapshot" or "uia_act" ? command : "unknown";
        var safeOutcome = outcome is "completed" or "failed" or "timeout" or "cancelled" or
            "busy" or "budget" or "sample" ? outcome : "failed";
        var safeKind = kind == "watchdog" ? "pc_bridge.watchdog" :
            kind == "sample" ? "pc_bridge.sample" : "pc_bridge.command";
        var line = string.Create(CultureInfo.InvariantCulture,
            $"{DateTimeOffset.UtcNow:O} {safeKind} command={safeCommand} outcome={safeOutcome} duration_ms={Math.Max(0, elapsed.TotalMilliseconds):F0} cpu_ms={Math.Max(0, sample.CpuTime.TotalMilliseconds):F0} cpu_cores={Math.Max(0, double.IsFinite(cpuCores) ? cpuCores : 0):F2} threads={Math.Max(0, sample.Threads)} handles={Math.Max(0, sample.Handles)}\n");
        try
        {
            lock (_gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
                if (File.Exists(_path) && new FileInfo(_path).Length + Encoding.UTF8.GetByteCount(line) > _maxBytes)
                    File.Move(_path, _path + ".1", overwrite: true);
                File.AppendAllText(_path, line, new UTF8Encoding(false));
            }
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        { return false; }
    }
}

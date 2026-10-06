using System.Diagnostics;
using System.Text.Json;

namespace Jarvis.PcBridge.Stress;

public sealed class ResourceProbe : IDisposable
{
    private readonly Process _process = Process.GetCurrentProcess();
    private readonly Stopwatch _wall = Stopwatch.StartNew();
    private readonly TimeSpan _cpuStart;
    private readonly Thread _sampler;
    private readonly ManualResetEventSlim _stop = new();
    private int _peakThreads;
    private int _peakHandles;
    private double _maxProbeDelay;
    private double _maxCommandLatency;
    private int _commands;

    public ResourceProbe()
    {
        _cpuStart = _process.TotalProcessorTime;
        Sample();
        _sampler = new Thread(() =>
        {
            var last = Stopwatch.GetTimestamp();
            while (!_stop.Wait(5))
            {
                var now = Stopwatch.GetTimestamp();
                _maxProbeDelay = Math.Max(_maxProbeDelay,
                    Stopwatch.GetElapsedTime(last, now).TotalMilliseconds - 5);
                last = now;
                Sample();
            }
        }) { IsBackground = true, Name = "stress-resource-probe" };
        _sampler.Start();
    }

    public int StartThreads { get; private set; }
    public int StartHandles { get; private set; }
    public int PeakThreads => Volatile.Read(ref _peakThreads);
    public int PeakHandles => Volatile.Read(ref _peakHandles);

    public async Task<T> CommandAsync<T>(Func<Task<T>> command)
    {
        var start = Stopwatch.GetTimestamp();
        try { return await command(); }
        finally
        {
            _commands++;
            _maxCommandLatency = Math.Max(_maxCommandLatency,
                Stopwatch.GetElapsedTime(start).TotalMilliseconds);
        }
    }

    public void Print(string scenario, object assertions,
        string evidence = "controlled_fake_provider_not_real_machine_reproduction")
    {
        _stop.Set();
        _sampler.Join();
        Sample();
        _wall.Stop();
        var cpuMs = (_process.TotalProcessorTime - _cpuStart).TotalMilliseconds;
        var corePercent = cpuMs / _wall.Elapsed.TotalMilliseconds * 100;
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            scenario,
            evidence,
            logicalCores = Environment.ProcessorCount,
            wallMs = Math.Round(_wall.Elapsed.TotalMilliseconds, 2),
            cpuMs = Math.Round(cpuMs, 2),
            cpuCorePercent = Math.Round(corePercent, 2),
            cpuMachinePercent = Math.Round(corePercent / Environment.ProcessorCount, 2),
            startThreads = StartThreads,
            peakThreads = _peakThreads,
            startHandles = StartHandles,
            peakHandles = _peakHandles,
            commands = _commands,
            maxCommandLatencyMs = Math.Round(_maxCommandLatency, 2),
            maxIndependentSchedulerProbeDelayMs = Math.Round(Math.Max(0, _maxProbeDelay), 2),
            assertions,
        }));
    }

    private void Sample()
    {
        _process.Refresh();
        var threads = _process.Threads.Count;
        var handles = _process.HandleCount;
        if (StartThreads == 0) { StartThreads = threads; StartHandles = handles; }
        _peakThreads = Math.Max(_peakThreads, threads);
        _peakHandles = Math.Max(_peakHandles, handles);
    }

    public void Dispose()
    {
        _stop.Set();
        _sampler.Join();
        _stop.Dispose();
        _process.Dispose();
    }
}

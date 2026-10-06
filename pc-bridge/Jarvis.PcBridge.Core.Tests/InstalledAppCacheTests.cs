using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class InstalledAppCacheTests
{
    [Fact]
    public async Task Startup_scans_in_background_and_requests_only_read_published_snapshot()
    {
        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        var calls = 0;
        var callerThread = Environment.CurrentManagedThreadId;
        var scanThread = callerThread;
        using var cache = new InstalledAppCache(token =>
        {
            scanThread = Environment.CurrentManagedThreadId;
            Interlocked.Increment(ref calls);
            entered.Set();
            release.Wait(token);
            return [new InstalledApp("Spotify", "spotify.exe")];
        });
        Assert.True(entered.Wait(TimeSpan.FromSeconds(5)));
        try
        {
            Assert.NotEqual(callerThread, scanThread);
            await Task.WhenAll(Enumerable.Range(0, 100).Select(_ => Task.Run(() =>
                Assert.Empty(cache.FindBestMatches("Spotify")))));
            Assert.Equal(1, calls);
        }
        finally { release.Set(); }
        await cache.RefreshIfDueAsync().WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal("Spotify", Assert.Single(cache.FindBestMatches("Spotify")).Name);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Refreshes_after_ten_minutes_and_throttles_misses_across_names()
    {
        var now = DateTimeOffset.Parse("2026-10-06T00:00:00Z");
        var calls = 0;
        using var cache = new InstalledAppCache(_ =>
            [new InstalledApp($"App {Interlocked.Increment(ref calls)}", "app.exe")], () => now);
        await cache.RefreshIfDueAsync().WaitAsync(TimeSpan.FromSeconds(5));
        now += TimeSpan.FromSeconds(29);
        await cache.RefreshIfDueAsync(cacheMiss: true);
        Assert.Equal(1, calls);
        now += TimeSpan.FromSeconds(1);
        await cache.RefreshIfDueAsync(cacheMiss: true).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(2, calls);
        Assert.Empty(cache.FindBestMatches("unknown one"));
        Assert.Empty(cache.FindBestMatches("unknown two"));
        Assert.Equal(2, calls);
        now += InstalledAppCache.RefreshInterval - TimeSpan.FromMilliseconds(1);
        await cache.RefreshIfDueAsync();
        Assert.Equal(2, calls);
        now += TimeSpan.FromMilliseconds(1);
        await cache.RefreshIfDueAsync().WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(3, calls);
        Assert.Equal("App 3", Assert.Single(cache.FindBestMatches("App 3")).Name);
    }

    [Fact]
    public async Task A_stalled_scan_never_gets_replaced_even_after_refresh_deadlines()
    {
        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        var now = DateTimeOffset.UtcNow;
        var calls = 0;
        using var cache = new InstalledAppCache(_ =>
        {
            Interlocked.Increment(ref calls);
            entered.Set();
            release.Wait();
            return [];
        }, () => now);
        Assert.True(entered.Wait(TimeSpan.FromSeconds(5)));
        var flight = cache.RefreshIfDueAsync();
        try
        {
            now += TimeSpan.FromDays(1);
            await Task.WhenAll(Enumerable.Range(0, 100).Select(_ => Task.Run(() =>
            {
                Assert.Same(flight, cache.RefreshIfDueAsync(cacheMiss: true));
                Assert.Empty(cache.FindBestMatches("missing"));
            })));
            cache.Dispose();
            Assert.False(flight.IsCompleted);
            Assert.Equal(1, calls);
        }
        finally { release.Set(); }
        await flight.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task Failed_refresh_keeps_previous_apps_and_disposal_cancels_scan()
    {
        var now = DateTimeOffset.UtcNow;
        var calls = 0;
        using var cache = new InstalledAppCache(_ =>
        {
            if (Interlocked.Increment(ref calls) > 1) throw new IOException("scan failed");
            return [new InstalledApp("Spotify", "spotify.exe")];
        }, () => now);
        await cache.RefreshIfDueAsync().WaitAsync(TimeSpan.FromSeconds(5));
        now += InstalledAppCache.RefreshInterval;
        await cache.RefreshIfDueAsync().WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Single(cache.FindBestMatches("Spotify"));
        Assert.Equal(2, calls);

        using var entered = new ManualResetEventSlim();
        using var cancelled = new ManualResetEventSlim();
        using var cancellable = new InstalledAppCache(token =>
        {
            using var registration = token.Register(cancelled.Set);
            entered.Set();
            token.WaitHandle.WaitOne();
            token.ThrowIfCancellationRequested();
            return [];
        });
        Assert.True(entered.Wait(TimeSpan.FromSeconds(5)));
        var flight = cancellable.RefreshIfDueAsync();
        cancellable.Dispose();
        Assert.True(cancelled.Wait(TimeSpan.FromSeconds(5)));
        await flight.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Same(flight, cancellable.RefreshIfDueAsync(cacheMiss: true));
    }
}

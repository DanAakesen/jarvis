using System.Buffers.Binary;
using System.IO.Pipes;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

internal static class NativeMessagingHost
{
    // Chrome relaunches this host on every reconnect; an unhandled failure here writes a crash dump each time.
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(3);
    private static readonly byte[] BusyMessage = """{"type":"host_unavailable","reason":"bridge_unavailable"}"""u8.ToArray();

    public static async Task<int> RunAsync()
    {
        var output = Console.OpenStandardOutput();
        try
        {
            await RelayThroughBridgeAsync(output).ConfigureAwait(false);
            return 0;
        }
        catch (Exception exception) when (exception is OperationCanceledException or TimeoutException or IOException
            or UnauthorizedAccessException or InvalidDataException or ObjectDisposedException)
        {
            // The bridge is not running or already serves another extension host. Tell the extension to back off.
            try
            {
                var header = new byte[sizeof(int)];
                BinaryPrimitives.WriteInt32LittleEndian(header, BusyMessage.Length);
                await output.WriteAsync(header).ConfigureAwait(false);
                await output.WriteAsync(BusyMessage).ConfigureAwait(false);
                await output.FlushAsync().ConfigureAwait(false);
            }
            catch (IOException) { }
            catch (ObjectDisposedException) { }
            return 0;
        }
    }

    private static async Task RelayThroughBridgeAsync(Stream output)
    {
        await using var pipe = new NamedPipeClientStream(
            ".",
            NativeMessagingBrowserPort.PipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous);
        using (var connecting = new CancellationTokenSource(ConnectTimeout))
        {
            await pipe.ConnectAsync(connecting.Token).ConfigureAwait(false);
        }

        var input = Console.OpenStandardInput();
        using var relayStopping = new CancellationTokenSource();
        var toBridge = RelayAsync(input, pipe, relayStopping.Token);
        var toChrome = RelayAsync(pipe, output, relayStopping.Token);
        await Task.WhenAny(toBridge, toChrome).ConfigureAwait(false);
        relayStopping.Cancel();
        pipe.Dispose();
        try { await Task.WhenAll(toBridge, toChrome).WaitAsync(TimeSpan.FromSeconds(1)).ConfigureAwait(false); }
        catch (TimeoutException) { }
        catch (OperationCanceledException) { }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
    }

    private static async Task RelayAsync(Stream source, Stream destination, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var payload = await ReadFrameAsync(source, cancellationToken).ConfigureAwait(false);
            if (payload is null) return;
            var header = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(header, payload.Length);
            await destination.WriteAsync(header, cancellationToken).ConfigureAwait(false);
            await destination.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
            await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private static async Task<byte[]?> ReadFrameAsync(Stream stream, CancellationToken cancellationToken)
    {
        var header = new byte[sizeof(int)];
        if (await stream.ReadAsync(header.AsMemory(0, 1), cancellationToken).ConfigureAwait(false) == 0)
            return null;
        await stream.ReadExactlyAsync(header.AsMemory(1), cancellationToken).ConfigureAwait(false);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length is <= 0 or > BridgeProtocol.MaxMessageBytes)
            throw new InvalidDataException("Invalid native messaging frame.");
        var payload = new byte[length];
        await stream.ReadExactlyAsync(payload, cancellationToken).ConfigureAwait(false);
        return payload;
    }
}

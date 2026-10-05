using System.Buffers.Binary;
using System.IO.Pipes;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

internal static class NativeMessagingHost
{
    public static async Task RunAsync()
    {
        await using var pipe = new NamedPipeClientStream(
            ".",
            NativeMessagingBrowserPort.PipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous);
        using var stopping = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await pipe.ConnectAsync(stopping.Token).ConfigureAwait(false);
        stopping.CancelAfter(Timeout.InfiniteTimeSpan);

        var input = Console.OpenStandardInput();
        var output = Console.OpenStandardOutput();
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

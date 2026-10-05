using System.Buffers;
using System.Net.WebSockets;
using System.Text.Json;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

public sealed class BridgeClient(
    BridgeSettings settings,
    BridgeTokenProvider tokens,
    WindowsCommandExecutor executor,
    BrowserExecutor browserExecutor)
{
    private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(5);

    public async Task RunAsync(Action<string> statusChanged, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            statusChanged("Connecting");
            try
            {
                await ConnectOnceAsync(statusChanged, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch
            {
                statusChanged("Offline — reconnecting");
            }

            await Task.Delay(ReconnectDelay, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task ConnectOnceAsync(Action<string> statusChanged, CancellationToken cancellationToken)
    {
        var token = await tokens.GetAccessTokenAsync(cancellationToken).ConfigureAwait(false);
        var endpoint = new UriBuilder(settings.BackendUrl)
        {
            Scheme = settings.BackendUrl.StartsWith("https:", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws",
            Path = "/pc-bridge/connect",
        }.Uri;
        using var socket = new ClientWebSocket();
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);
        socket.Options.AddSubProtocol(BridgeProtocol.Subprotocol);
        socket.Options.SetRequestHeader("Authorization", string.Join(" ", new[] { "Bearer", token }));
        using var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        connectTimeout.CancelAfter(TimeSpan.FromSeconds(15));
        await socket.ConnectAsync(endpoint, connectTimeout.Token).ConfigureAwait(false);
        statusChanged("Online");

        try
        {
            await ReceiveCommandsAsync(socket, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            statusChanged("Offline — reconnecting");
            if (socket.State == WebSocketState.Open)
            {
                using var closeTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Reconnecting", closeTimeout.Token)
                    .ConfigureAwait(false);
            }
        }
    }

    private async Task ReceiveCommandsAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var rented = ArrayPool<byte>.Shared.Rent(8192);
        try
        {
            while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                using var message = new MemoryStream();
                ValueWebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(rented.AsMemory(0, rented.Length), cancellationToken)
                        .ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    if (result.MessageType != WebSocketMessageType.Text ||
                        message.Length + result.Count > BridgeProtocol.MaxMessageBytes)
                    {
                        throw new InvalidDataException("Invalid bridge protocol message.");
                    }
                    message.Write(rented, 0, result.Count);
                } while (!result.EndOfMessage);

                var payload = message.GetBuffer().AsSpan(0, checked((int)message.Length));
                if (!BridgeProtocol.TryReadCommand(payload, out var command) || command is null)
                {
                    throw new InvalidDataException("Invalid bridge protocol message.");
                }

                byte[] response;
                try
                {
                    var value = command.Command == "open_url"
                        ? await browserExecutor.OpenUrlAsync(
                            command.Arguments.GetProperty("url").GetString()!,
                            executor.OpenUrlInDefaultBrowser,
                            cancellationToken).ConfigureAwait(false)
                        : command.Command.StartsWith("browser_", StringComparison.Ordinal)
                            ? await browserExecutor.ExecuteAsync(command, cancellationToken).ConfigureAwait(false)
                            : await executor.ExecuteAsync(command, cancellationToken).ConfigureAwait(false);
                    response = BridgeProtocol.Success(command.Id, value);
                }
                catch (CommandRefusedException exception)
                {
                    response = BridgeProtocol.Failure(command.Id, exception.Code);
                }
                catch (BrowserActionRefusedException exception)
                {
                    response = BridgeProtocol.Failure(command.Id, exception.Code);
                }
                catch (UiAutomationRefusedException exception)
                {
                    response = BridgeProtocol.Failure(command.Id, exception.Code);
                }
                catch
                {
                    response = BridgeProtocol.Failure(command.Id, "failed");
                }

                await socket.SendAsync(response, WebSocketMessageType.Text, true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }
}

public sealed class CommandRefusedException(string code) : Exception
{
    public string Code { get; } = code;
}

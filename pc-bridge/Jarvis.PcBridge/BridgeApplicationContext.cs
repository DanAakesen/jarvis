using System.Drawing;

namespace Jarvis.PcBridge;

public sealed class BridgeApplicationContext : ApplicationContext
{
    private readonly CancellationTokenSource _stopping = new();
    private readonly Control _dispatcher = new();
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _status;
    private BridgeTokenProvider? _tokenProvider;

    public BridgeApplicationContext()
    {
        _dispatcher.CreateControl();
        _ = _dispatcher.Handle;
        _status = new ToolStripMenuItem("Starting…") { Enabled = false };
        var menu = new ContextMenuStrip();
        menu.Items.Add(_status);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
        _icon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Jarvis PC bridge: starting",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _ = RunAsync();
    }

    protected override void ExitThreadCore()
    {
        _stopping.Cancel();
        _icon.Visible = false;
        _icon.Dispose();
        _dispatcher.Dispose();
        _stopping.Dispose();
        base.ExitThreadCore();
    }

    private async Task RunAsync()
    {
        try
        {
            var settings = BridgeSettings.Load();
            _tokenProvider = await BridgeTokenProvider.CreateAsync(settings, _stopping.Token);
            var client = new BridgeClient(settings, _tokenProvider, new WindowsCommandExecutor());
            await client.RunAsync(SetStatus, _stopping.Token);
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
        {
        }
        catch
        {
            SetStatus("Offline — configuration or sign-in required");
        }
    }

    private void SetStatus(string status)
    {
        if (_stopping.IsCancellationRequested || _dispatcher.IsDisposed) return;
        _dispatcher.BeginInvoke(() =>
        {
            _status.Text = status;
            _icon.Text = status.Length <= 63 ? $"Jarvis PC bridge: {status}" : "Jarvis PC bridge: offline";
        });
    }
}

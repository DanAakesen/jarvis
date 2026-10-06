using System.Drawing;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

public sealed class BridgeApplicationContext : ApplicationContext
{
    private readonly CancellationTokenSource _stopping = new();
    private readonly Control _dispatcher = new();
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _status;
    private readonly ToolStripMenuItem _browserToggle;
    private readonly ToolStripMenuItem _controlToggle;
    private readonly ToolStripMenuItem _diagnosticsItem;
    private BridgeSettings? _settings;
    private BrowserExecutor? _browserExecutor;
    private NativeMessagingBrowserPort? _extensionPort;
    private BridgeTokenProvider? _tokenProvider;
    private BridgeClient? _bridgeClient;
    private readonly BridgeDiagnostics _diagnostics = new();
    private BoundedCommandWorker? _commandWorker;
    private bool _exiting;
    private readonly Task _runTask;

    public BridgeApplicationContext()
    {
        _dispatcher.CreateControl();
        _ = _dispatcher.Handle;
        _status = new ToolStripMenuItem("Starting…") { Enabled = false };
        var menu = new ContextMenuStrip();
        menu.Items.Add(_status);
        _browserToggle = new ToolStripMenuItem("Chrome browser automation (off)", null, ToggleBrowser)
        {
            CheckOnClick = false,
            Enabled = false,
        };
        menu.Items.Add(_browserToggle);
        _controlToggle = new ToolStripMenuItem("Pause Jarvis control", null, ToggleControl)
        {
            CheckOnClick = false,
            Enabled = false,
        };
        menu.Items.Add(_controlToggle);
        _diagnosticsItem = new ToolStripMenuItem("Diagnostics", null, WriteDiagnostics);
        menu.Items.Add(_diagnosticsItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
        _icon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Jarvis PC bridge: starting",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _runTask = RunAsync();
    }

    protected override void ExitThreadCore()
    {
        if (_exiting) return;
        _exiting = true;
        _stopping.Cancel();
        _bridgeClient?.Dispose();
        _commandWorker?.Dispose();
        _icon.Visible = false;
        _icon.Dispose();
        _dispatcher.Dispose();
        _ = _runTask.ContinueWith(_ => _stopping.Dispose(), TaskScheduler.Default);
        base.ExitThreadCore();
    }

    private async Task RunAsync()
    {
        try
        {
            var settings = BridgeSettings.Load();
            _settings = settings;
            _browserToggle.Checked = settings.BrowserEnabled;
            _browserToggle.Text = BrowserToggleText(settings.BrowserEnabled);
            _controlToggle.Checked = settings.ControlPaused;
            _controlToggle.Text = ControlToggleText(settings.ControlPaused);
            _browserToggle.Enabled = true;
            _controlToggle.Enabled = true;
            _extensionPort = new NativeMessagingBrowserPort();
            var keyboardExecutor = new KeyboardExecutor(new WindowsKeyboardProvider());
            _browserExecutor = new BrowserExecutor(() => _settings?.BrowserEnabled == true,
                WindowsCommandExecutor.ReadActiveWindowTitle,
                extensionPort: _extensionPort,
                keyboardExecutor: keyboardExecutor);
            var browserExecutor = _browserExecutor;
            var extensionPort = _extensionPort;
            var executor = new WindowsCommandExecutor(keyboardExecutor);
            _commandWorker = new BoundedCommandWorker(_diagnostics, cleanup: async () =>
            {
                executor.Dispose();
                browserExecutor.Dispose();
                await extensionPort.DisposeAsync();
            });
            _tokenProvider = await BridgeTokenProvider.CreateAsync(settings, _stopping.Token).ConfigureAwait(false);
            var client = new BridgeClient(
                settings,
                _tokenProvider,
                executor,
                _browserExecutor,
                () => _settings?.ControlPaused == true,
                _commandWorker);
            _bridgeClient = client;
            await client.RunAsync(SetStatus, _stopping.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
        {
        }
        catch
        {
            SetStatus("Offline — configuration or sign-in required");
        }
        finally
        {
            _bridgeClient?.Dispose();
            _commandWorker?.Dispose();
        }
    }

    private async void WriteDiagnostics(object? sender, EventArgs e)
    {
        if (_exiting || !_diagnosticsItem.Enabled) return;
        _diagnosticsItem.Enabled = false;
        try
        {
            var written = await _diagnostics.WriteSampleAsync();
            if (!_exiting)
                _icon.ShowBalloonTip(3000, "Diagnostics",
                    written ? "Local resource diagnostics saved." : "Diagnostics could not be saved. Try again.",
                    written ? ToolTipIcon.Info : ToolTipIcon.Warning);
        }
        finally
        {
            if (!_exiting) _diagnosticsItem.Enabled = true;
        }
    }

    private void ToggleBrowser(object? sender, EventArgs e)
    {
        if (_settings is null) return;
        var enabled = !_settings.BrowserEnabled;
        try
        {
            var updated = _settings with { BrowserEnabled = enabled };
            updated.Save();
            _settings = updated;
            _browserToggle.Checked = enabled;
            _browserToggle.Text = BrowserToggleText(enabled);
        }
        catch
        {
            _browserToggle.Checked = _settings.BrowserEnabled;
            _browserToggle.Text = $"{BrowserToggleText(_settings.BrowserEnabled)} — save failed";
        }
    }

    private async void ToggleControl(object? sender, EventArgs e)
    {
        if (_settings is null) return;
        var paused = !_settings.ControlPaused;
        var updated = _settings with { ControlPaused = paused };
        try
        {
            updated.Save();
        }
        catch
        {
            _controlToggle.Checked = _settings.ControlPaused;
            SetStatus("Control pause setting could not be saved");
            return;
        }

        _settings = updated;
        _controlToggle.Checked = paused;
        _controlToggle.Text = ControlToggleText(paused);
        try
        {
            if (_bridgeClient is not null)
                await _bridgeClient.ReportControlStateAsync(_stopping.Token);
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested)
        {
        }
        catch
        {
            SetStatus("Offline — reconnecting to report Jarvis control state");
        }
    }

    private static string BrowserToggleText(bool enabled) =>
        $"Chrome browser automation ({(enabled ? "on" : "off")})";

    private static string ControlToggleText(bool paused) =>
        $"Pause Jarvis control ({(paused ? "on" : "off")})";

    private void SetStatus(string status)
    {
        if (_exiting || _dispatcher.IsDisposed) return;
        _dispatcher.BeginInvoke(() =>
        {
            _status.Text = status;
            _icon.Text = status.Length <= 63 ? $"Jarvis PC bridge: {status}" : "Jarvis PC bridge: offline";
        });
    }
}

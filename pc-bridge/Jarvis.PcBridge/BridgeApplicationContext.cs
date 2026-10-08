using System.Drawing;
using System.Media;
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
    private readonly ToolStripMenuItem _wakeWordToggle;
    private readonly SoundPlayer? _chime = LoadChime();
    private BridgeSettings? _settings;
    private BrowserExecutor? _browserExecutor;
    private NativeMessagingBrowserPort? _extensionPort;
    private BridgeTokenProvider? _tokenProvider;
    private BridgeClient? _bridgeClient;
    private WindowsCommandExecutor? _commandExecutor;
    private WakeWordListener? _wakeWord;

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
        _wakeWordToggle = new ToolStripMenuItem("Wake word (starting…)", null, ToggleWakeWord)
        {
            CheckOnClick = false,
            Enabled = false,
        };
        menu.Items.Add(_wakeWordToggle);
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
        _extensionPort?.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _chime?.Dispose();
        _stopping.Dispose();
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
            _commandExecutor = new WindowsCommandExecutor(keyboardExecutor, _dispatcher);
            StartWakeWord(settings);
            _tokenProvider = await BridgeTokenProvider.CreateAsync(settings, _stopping.Token);
            var client = new BridgeClient(
                settings,
                _tokenProvider,
                _commandExecutor,
                _browserExecutor,
                () => _settings?.ControlPaused == true,
                () => _wakeWord is not null && _settings?.IsWakeWordOn == true,
                active => _wakeWord?.SetVoiceActive(active));
            _bridgeClient = client;
            await client.RunAsync(SetStatus, _stopping.Token);
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
            _browserExecutor?.Dispose();
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

    private void StartWakeWord(BridgeSettings settings)
    {
        var modelPath = settings.ResolvedWakeWordModelPath;
        if (modelPath is null)
        {
            _wakeWordToggle.Text = "Wake word (unavailable: no keyword model)";
            _wakeWordToggle.ToolTipText =
                "Set WakeWordModelPath in settings.json to the \"Wake up Jarvis\" .table keyword model, then restart the bridge.";
            return;
        }

        IKeywordRecognizer recognizer;
        try
        {
            recognizer = new SpeechKeywordRecognizer(modelPath);
        }
        catch
        {
            _wakeWordToggle.Text = "Wake word (unavailable: keyword model could not be loaded)";
            _wakeWordToggle.ToolTipText = "Replace the .table file at WakeWordModelPath, then restart the bridge.";
            return;
        }

        var listener = new WakeWordListener(recognizer, OnWakeWordAsync, settings.IsWakeWordOn);
        listener.StateChanged += state =>
        {
            if (_stopping.IsCancellationRequested || _dispatcher.IsDisposed) return;
            try { _dispatcher.BeginInvoke(() => ShowWakeWordState(state)); }
            catch (InvalidOperationException) { }
        };
        _wakeWord = listener;
        ShowWakeWordState(listener.State);
        _wakeWordToggle.ToolTipText = "Say \"Wake up Jarvis\" to start voice. Audio stays on this PC until the phrase is heard.";
        _wakeWordToggle.Enabled = true;
        _ = RunWakeWordAsync(listener, recognizer);
    }

    private async Task RunWakeWordAsync(WakeWordListener listener, IKeywordRecognizer recognizer)
    {
        try
        {
            await listener.RunAsync(_stopping.Token);
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            await recognizer.DisposeAsync();
        }
    }

    private async Task OnWakeWordAsync(DateTimeOffset at, CancellationToken cancellationToken)
    {
        PlayChime();
        var sending = _bridgeClient?.SendWakeWordAsync(at, cancellationToken) ?? Task.FromResult(false);
        await FocusJarvisAsync(cancellationToken);
        bool sent;
        try
        {
            sent = await sending;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            sent = false;
        }
        if (!sent) SetStatus("Wake word heard — offline, voice not started");
    }

    // Reuse Dan's Jarvis tab through the extension; otherwise use a "Jarvis" Chrome window or open
    // the Jarvis URL with the Chrome executable. The Windows default browser (Edge) is never used.
    private async Task FocusJarvisAsync(CancellationToken cancellationToken)
    {
        var webUrl = _settings?.JarvisWebUrl ?? BridgeSettings.ProductionWebUrl;
        if (_extensionPort?.IsConnected == true)
        {
            try
            {
                await _extensionPort.FocusJarvisTabAsync(webUrl, cancellationToken);
                await Task.Delay(300, cancellationToken);
                WindowsCommandExecutor.BringChromeToFront();
                return;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
            }
        }

        if (WindowsCommandExecutor.BringJarvisChromeWindowToFront()) return;
        try
        {
            _commandExecutor?.OpenUrlInDefaultBrowser(webUrl);
            await Task.Delay(300, cancellationToken);
            WindowsCommandExecutor.BringChromeToFront();
        }
        catch (CommandRefusedException)
        {
            SetStatus("Wake word heard — Chrome was not found");
        }
    }

    private void ToggleWakeWord(object? sender, EventArgs e)
    {
        if (_settings is null || _wakeWord is null) return;
        var enabled = !_settings.IsWakeWordOn;
        var updated = _settings with { WakeWordEnabled = enabled };
        try
        {
            updated.Save();
        }
        catch
        {
            _wakeWordToggle.Text = $"{WakeWordToggleText(_wakeWord.State)} — save failed";
            return;
        }

        _settings = updated;
        _wakeWord.SetEnabled(enabled);
        ShowWakeWordState(_wakeWord.State);
        _ = ReportWakeWordStateAsync();
    }

    private async Task ReportWakeWordStateAsync()
    {
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
            SetStatus("Offline — reconnecting to report wake word state");
        }
    }

    private void ShowWakeWordState(WakeWordState state)
    {
        if (_stopping.IsCancellationRequested) return;
        _wakeWordToggle.Checked = state != WakeWordState.Off;
        _wakeWordToggle.Text = WakeWordToggleText(state);
    }

    private static string WakeWordToggleText(WakeWordState state) => state switch
    {
        WakeWordState.Listening => "Wake word (on: listening for \"Wake up Jarvis\")",
        WakeWordState.PausedForVoice => "Wake word (on: paused during voice)",
        WakeWordState.Unavailable => "Wake word (on: microphone unavailable, retrying)",
        _ => "Wake word (off)",
    };

    private void PlayChime()
    {
        try
        {
            if (_chime is not null)
            {
                _chime.Play();
                return;
            }
        }
        catch
        {
        }
        SystemSounds.Asterisk.Play();
    }

    private static SoundPlayer? LoadChime()
    {
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Media", "Speech On.wav");
        try
        {
            if (!File.Exists(path)) return null;
            var player = new SoundPlayer(path);
            player.Load();
            return player;
        }
        catch
        {
            return null;
        }
    }

    private static string BrowserToggleText(bool enabled) =>
        $"Chrome browser automation ({(enabled ? "on" : "off")})";

    private static string ControlToggleText(bool paused) =>
        $"Pause Jarvis control ({(paused ? "on" : "off")})";

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

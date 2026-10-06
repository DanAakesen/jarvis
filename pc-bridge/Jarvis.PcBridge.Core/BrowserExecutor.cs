using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Jarvis.PcBridge.Core;

public sealed record BrowserTab(string Id, string Title, string Url, bool Focused);

public sealed record BrowserElement(int Index, string Role, string Name, string Value);

public sealed record BrowserSnapshot(
    string TabId,
    string SnapshotId,
    string Title,
    string Url,
    IReadOnlyList<BrowserElement> Elements);

public sealed class BrowserActionRefusedException(string code) : Exception
{
    public string Code { get; } = code;
}

public sealed class BrowserExecutor : IDisposable
{
    private const int DevToolsPort = 9222;
    private const int MaxTargetsBytes = 1024 * 1024;
    private const int MaxSnapshotElements = 100;
    private const int TabsPerPage = 20;
    private static readonly TimeSpan SnapshotLifetime = TimeSpan.FromSeconds(30);
    private static readonly Uri TargetsUri = new("http://127.0.0.1:9222/json/list");
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly Func<bool> _isEnabled;
    private readonly Func<string?> _focusedWindowTitle;
    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;
    private readonly Uri _targetsUri;
    private readonly IExtensionBrowserPort? _extensionPort;
    private readonly ConcurrentDictionary<string, TargetSession> _sessions = new(StringComparer.Ordinal);

    public BrowserExecutor(
        Func<bool> isEnabled,
        Func<string?> focusedWindowTitle,
        HttpClient? httpClient = null,
        Uri? targetsUri = null,
        IExtensionBrowserPort? extensionPort = null)
    {
        _isEnabled = isEnabled;
        _focusedWindowTitle = focusedWindowTitle;
        _extensionPort = extensionPort;
        if (_extensionPort is not null) _extensionPort.TabRemoved += OnExtensionTabRemoved;
        _httpClient = httpClient ?? new HttpClient(new HttpClientHandler
        {
            UseProxy = false,
            AllowAutoRedirect = false,
        })
        {
            Timeout = TimeSpan.FromSeconds(5),
        };
        _ownsHttpClient = httpClient is null;
        _targetsUri = targetsUri ?? TargetsUri;
        if (_targetsUri.Scheme != Uri.UriSchemeHttp || !_targetsUri.IsLoopback ||
            _targetsUri.UserInfo.Length != 0 || _targetsUri.Query.Length != 0 || _targetsUri.Fragment.Length != 0)
        {
            throw new ArgumentException("The Chrome DevTools endpoint must be an HTTP loopback URL.", nameof(targetsUri));
        }
    }

    public async Task<object> ExecuteAsync(BridgeCommand command, CancellationToken cancellationToken)
    {
        if (!_isEnabled()) throw new BrowserActionRefusedException("browser_off");
        if (!CommandPolicy.IsValid(command.Command, command.Arguments))
            throw new BrowserActionRefusedException("not_allowed");

        return command.Command switch
        {
            "browser_tabs" => await ListTabsAsync(
                command.Arguments.TryGetProperty("offset", out var offset) ? offset.GetInt32() : 0,
                cancellationToken).ConfigureAwait(false),
            "browser_snapshot" => await TakeSnapshotAsync(
                command.Arguments.GetProperty("tabId").GetString()!, cancellationToken).ConfigureAwait(false),
            "browser_act" => await ActAsync(command.Arguments, cancellationToken).ConfigureAwait(false),
            _ => throw new BrowserActionRefusedException("not_allowed"),
        };
    }

    public async Task<object> OpenUrlAsync(
        string url,
        Func<string, object> openInDefaultBrowser,
        CancellationToken cancellationToken)
    {
        if (!CommandPolicy.TryNormalizeUrl(url, out var normalized))
            throw new BrowserActionRefusedException("not_allowed");
        cancellationToken.ThrowIfCancellationRequested();

        var extension = _extensionPort;
        if (extension?.IsConnected != true) return openInDefaultBrowser(normalized);
        if (!_isEnabled()) throw new BrowserActionRefusedException("browser_off");

        await extension.OpenUrlAsync(normalized, cancellationToken).ConfigureAwait(false);
        return new { opened = true };
    }

    private async Task<object> ListTabsAsync(int offset, CancellationToken cancellationToken)
    {
        if (_extensionPort?.IsConnected == true)
        {
            try
            {
                var extensionPage = await _extensionPort.ListTabsAsync(offset, TabsPerPage, cancellationToken).ConfigureAwait(false);
                var extensionForegroundTitle = _focusedWindowTitle();
                return new
                {
                    tabs = extensionPage.Tabs.Select(tab =>
                        tab with { Focused = IsFocused(tab.Title, extensionForegroundTitle) }).ToArray(),
                    nextOffset = extensionPage.NextOffset,
                };
            }
            catch (BrowserActionRefusedException) { throw; }
            catch (OperationCanceledException) { throw; }
            catch { throw new BrowserActionRefusedException("not_found"); }
        }

        var targets = await GetTargetsAsync(cancellationToken).ConfigureAwait(false);
        var pageTargets = targets.Where(target => target.Type == "page").Take(5000).ToArray();
        RemoveClosedSessions(pageTargets);
        var foregroundTitle = _focusedWindowTitle();
        var page = pageTargets.Skip(offset).Take(TabsPerPage).ToArray();
        var tabs = page.Select(target => new BrowserTab(
            target.Id,
            Limit(target.Title, 300),
            Limit(target.Url, 2048),
            IsFocused(target.Title, foregroundTitle))).ToArray();
        int? nextOffset = offset + tabs.Length < pageTargets.Length ? offset + tabs.Length : null;
        return new { tabs, nextOffset };
    }

    private async Task<BrowserSnapshot> TakeSnapshotAsync(string tabId, CancellationToken cancellationToken)
    {
        var target = await FindTargetAsync(tabId, cancellationToken).ConfigureAwait(false);
        var session = await GetSessionAsync(target, cancellationToken).ConfigureAwait(false);
        if (session.Snapshot is { } previous)
        {
            await session.ReleaseSnapshotAsync(previous, cancellationToken).ConfigureAwait(false);
            session.Snapshot = null;
        }

        var snapshotId = Guid.NewGuid().ToString("D");
        var objectGroup = $"jarvis-{snapshotId}";
        using var evaluated = await session.SendAsync("Runtime.evaluate", new
        {
            expression = SnapshotExpression,
            objectGroup,
            returnByValue = false,
            awaitPromise = false,
        }, cancellationToken).ConfigureAwait(false);

        var result = evaluated.RootElement.GetProperty("result").GetProperty("result");
        if (result.TryGetProperty("exceptionDetails", out _))
            throw new BrowserActionRefusedException("failed");
        var arrayObjectId = GetObjectId(result);
        if (arrayObjectId is null) throw new BrowserActionRefusedException("failed");

        using var properties = await session.SendAsync("Runtime.getProperties", new
        {
            objectId = arrayObjectId,
            ownProperties = true,
            accessorPropertiesOnly = false,
            generatePreview = false,
        }, cancellationToken).ConfigureAwait(false);

        var elements = new List<SnapshotReference>();
        foreach (var descriptor in properties.RootElement.GetProperty("result").GetProperty("result")
                     .EnumerateArray()
                     .Where(item => item.TryGetProperty("name", out var name) &&
                         int.TryParse(name.GetString(), out var index) &&
                         index is >= 0 and < MaxSnapshotElements)
                     .OrderBy(item => int.Parse(item.GetProperty("name").GetString()!)))
        {
            var entryObjectId = GetObjectId(descriptor.GetProperty("value"));
            if (entryObjectId is null) continue;
            using var entryProperties = await session.SendAsync("Runtime.getProperties", new
            {
                objectId = entryObjectId,
                ownProperties = true,
                accessorPropertiesOnly = false,
                generatePreview = false,
            }, cancellationToken).ConfigureAwait(false);
            var fields = entryProperties.RootElement.GetProperty("result").GetProperty("result")
                .EnumerateArray().ToDictionary(
                    item => item.GetProperty("name").GetString()!,
                    item => item.GetProperty("value"),
                    StringComparer.Ordinal);
            if (!fields.TryGetValue("node", out var node) ||
                !fields.TryGetValue("role", out var role) ||
                !fields.TryGetValue("name", out var name) ||
                !fields.TryGetValue("value", out var value) ||
                !fields.TryGetValue("fingerprint", out var fingerprint) ||
                !fields.TryGetValue("sensitive", out var sensitive) ||
                GetObjectId(node) is not { } nodeObjectId)
            {
                continue;
            }

            var index = elements.Count;
            elements.Add(new SnapshotReference(
                nodeObjectId,
                ReadString(role),
                ReadString(name),
                ReadString(value),
                ReadString(fingerprint),
                ReadBoolean(sensitive)));
        }

        var state = new SnapshotState(
            snapshotId, objectGroup, DateTimeOffset.UtcNow, elements);
        session.Snapshot = state;
        return new BrowserSnapshot(
            target.Id,
            snapshotId,
            Limit(target.Title, 300),
            Limit(target.Url, 2048),
            elements.Select((item, index) => new BrowserElement(
                index, item.Role, item.Name, item.Value)).ToArray());
    }

    private async Task<object> ActAsync(JsonElement arguments, CancellationToken cancellationToken)
    {
        var tabId = arguments.GetProperty("tabId").GetString()!;
        var snapshotId = arguments.GetProperty("snapshotId").GetString()!;
        var index = arguments.GetProperty("elementIndex").GetInt32();
        var action = arguments.GetProperty("action").GetString()!;
        var target = await FindTargetAsync(tabId, cancellationToken).ConfigureAwait(false);
        var session = await GetSessionAsync(target, cancellationToken).ConfigureAwait(false);
        var keepAttached = false;
        try
        {
            var snapshot = session.Snapshot;
            if (snapshot is null || snapshot.Id != snapshotId ||
                DateTimeOffset.UtcNow - snapshot.CreatedAt > SnapshotLifetime ||
                index >= snapshot.Elements.Count)
            {
                throw new BrowserActionRefusedException("stale");
            }

            var observed = snapshot.Elements[index];
            if (action == "type" &&
                (observed.Sensitive || LooksLikeSecret(arguments.GetProperty("text").GetString()!)))
            {
                throw new BrowserActionRefusedException("blocked");
            }
            if (action == "wait")
            {
                var waitMs = arguments.GetProperty("waitMs").GetInt32();
                await Task.Delay(waitMs, cancellationToken).ConfigureAwait(false);
            }
            if (!_isEnabled()) throw new BrowserActionRefusedException("browser_off");

            using var response = await session.SendAsync("Runtime.callFunctionOn", new
            {
                objectId = observed.ObjectId,
                functionDeclaration = ActionFunction,
                arguments = new object[]
                {
                    new { value = observed.Fingerprint },
                    new { value = observed.Role },
                    new { value = observed.Name },
                    new { value = action },
                    new { value = GetActionValue(arguments, action) },
                    new { value = action == "click" && arguments.GetProperty("confirmed").GetBoolean() },
                },
                returnByValue = true,
                awaitPromise = false,
                userGesture = true,
            }, cancellationToken).ConfigureAwait(false);

            var result = response.RootElement.GetProperty("result").GetProperty("result");
            if (response.RootElement.GetProperty("result").TryGetProperty("exceptionDetails", out _))
                throw new BrowserActionRefusedException("stale");
            if (!result.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Object)
                throw new BrowserActionRefusedException("failed");
            var status = value.GetProperty("status").GetString();
            if (status == "stale") throw new BrowserActionRefusedException("stale");
            if (status == "covered") throw new BrowserActionRefusedException("covered");
            if (status == "blocked") throw new BrowserActionRefusedException("blocked");
            if (status == "confirmation_required")
            {
                keepAttached = true;
                return new
                {
                    confirmationRequired = true,
                    actionKind = "computer_use",
                    summary = Limit(value.GetProperty("summary").GetString() ?? "Use a sensitive browser control.", 300),
                };
            }
            if (status != "acted") throw new BrowserActionRefusedException("failed");
            return new { acted = true, action };
        }
        finally
        {
            if (session.UsesExtension && !keepAttached)
            {
                try { await session.DetachAsync(CancellationToken.None).ConfigureAwait(false); }
                catch { }
                finally
                {
                    _sessions.TryRemove(tabId, out _);
                    session.Dispose();
                }
            }
        }
    }

    private static object? GetActionValue(JsonElement arguments, string action) => action switch
    {
        "type" => arguments.GetProperty("text").GetString(),
        "select" => arguments.GetProperty("value").GetString(),
        "scroll" => arguments.GetProperty("direction").GetString(),
        _ => null,
    };

    private async Task<CdpTarget> FindTargetAsync(string id, CancellationToken cancellationToken)
    {
        if (_extensionPort?.IsConnected == true)
        {
            for (var offset = 0; offset < 5000; offset += TabsPerPage)
            {
                var page = await _extensionPort.ListTabsAsync(offset, TabsPerPage, cancellationToken)
                    .ConfigureAwait(false);
                var tab = page.Tabs.FirstOrDefault(candidate => candidate.Id == id);
                if (tab is not null)
                    return new CdpTarget(tab.Id, "page", tab.Title, tab.Url, null, true);
                if (page.NextOffset is null) break;
            }
            throw new BrowserActionRefusedException("not_found");
        }

        var targets = await GetTargetsAsync(cancellationToken).ConfigureAwait(false);
        var target = targets.FirstOrDefault(candidate => candidate.Id == id && candidate.Type == "page");
        if (target is null) throw new BrowserActionRefusedException("not_found");
        return target;
    }

    private async Task<CdpTarget[]> GetTargetsAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _httpClient.GetAsync(_targetsUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            using var body = new MemoryStream();
            var buffer = new byte[8192];
            while (true)
            {
                var read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (read == 0) break;
                if (body.Length + read > MaxTargetsBytes) throw new BrowserActionRefusedException("failed");
                body.Write(buffer, 0, read);
            }
            return JsonSerializer.Deserialize<CdpTarget[]>(body.ToArray(), JsonOptions) ?? [];
        }
        catch (BrowserActionRefusedException) { throw; }
        catch (OperationCanceledException) { throw; }
        catch { throw new BrowserActionRefusedException("not_found"); }
    }

    private async Task<TargetSession> GetSessionAsync(CdpTarget target, CancellationToken cancellationToken)
    {
        if (_sessions.TryGetValue(target.Id, out var existing))
        {
            if (existing.IsOpen) return existing;
            if (_sessions.TryRemove(target.Id, out var removed)) removed.Dispose();
        }
        if (target.IsExtension && _extensionPort?.IsConnected == true)
        {
            var extensionSession = new TargetSession(_extensionPort, target.Id);
            _sessions[target.Id] = extensionSession;
            return extensionSession;
        }
        if (!TryValidateWebSocketUrl(target.WebSocketDebuggerUrl, out var endpoint))
            throw new BrowserActionRefusedException("not_found");

        var client = new ClientWebSocket();
        client.Options.Proxy = null;
        client.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            await client.ConnectAsync(endpoint, timeout.Token).ConfigureAwait(false);
            var session = new TargetSession(client);
            _sessions[target.Id] = session;
            return session;
        }
        catch (OperationCanceledException)
        {
            client.Dispose();
            throw;
        }
        catch
        {
            client.Dispose();
            throw new BrowserActionRefusedException("not_found");
        }
    }

    private void RemoveClosedSessions(IReadOnlyCollection<CdpTarget> targets)
    {
        var ids = targets.Select(target => target.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var (id, _) in _sessions.Where(item => !ids.Contains(item.Key)).ToArray())
        {
            if (_sessions.TryRemove(id, out var session)) session.Dispose();
        }
    }

    private void OnExtensionTabRemoved(string tabId)
    {
        if (_sessions.TryRemove(tabId, out var session)) session.Dispose();
    }

    private bool TryValidateWebSocketUrl(string? value, out Uri endpoint)
    {
        endpoint = new Uri("ws://127.0.0.1/");
        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) ||
            parsed.Scheme != "ws" ||
        !(parsed.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
          (IPAddress.TryParse(parsed.Host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address))) ||
            parsed.Port != _targetsUri.Port ||
            parsed.UserInfo.Length != 0 || parsed.Query.Length != 0 || parsed.Fragment.Length != 0)
        {
            return false;
        }
        endpoint = parsed;
        return true;
    }

    private static bool IsFocused(string tabTitle, string? windowTitle) =>
        !string.IsNullOrWhiteSpace(windowTitle) &&
        (string.Equals(windowTitle, tabTitle, StringComparison.OrdinalIgnoreCase) ||
         windowTitle.StartsWith($"{tabTitle} - Google Chrome", StringComparison.OrdinalIgnoreCase) ||
         windowTitle.StartsWith($"{tabTitle} - Chromium", StringComparison.OrdinalIgnoreCase));

    private static string Limit(string? value, int length) =>
        value is null ? string.Empty : new string(value.Where(character => !char.IsControl(character)).Take(length).ToArray());

    private static string? GetObjectId(JsonElement value) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty("objectId", out var id)
            ? id.GetString()
            : null;

    private static string ReadString(JsonElement value) =>
        value.ValueKind == JsonValueKind.Object &&
        value.TryGetProperty("value", out var primitive) &&
        primitive.ValueKind == JsonValueKind.String
            ? Limit(primitive.GetString(), 1024)
            : string.Empty;

    private static bool ReadBoolean(JsonElement value) =>
        value.ValueKind == JsonValueKind.Object &&
        value.TryGetProperty("value", out var primitive) &&
        primitive.ValueKind == JsonValueKind.True;

    private static bool LooksLikeSecret(string value)
    {
        if (value.Length is >= 4 and <= 8 && value.All(char.IsAsciiDigit)) return true;
        var digits = new string(value.Where(char.IsAsciiDigit).ToArray());
        if (digits.Length is < 13 or > 19) return false;
        var sum = 0;
        var alternate = false;
        for (var index = digits.Length - 1; index >= 0; index--)
        {
            var digit = digits[index] - '0';
            if (alternate && (digit *= 2) > 9) digit -= 9;
            sum += digit;
            alternate = !alternate;
        }
        return sum % 10 == 0;
    }

    public void Dispose()
    {
        if (_extensionPort is not null) _extensionPort.TabRemoved -= OnExtensionTabRemoved;
        foreach (var session in _sessions.Values) session.Dispose();
        _sessions.Clear();
        if (_ownsHttpClient) _httpClient.Dispose();
    }

    private const string SnapshotExpression = """
        (() => {
          const roleFor = e => e.getAttribute('role') || (e.isContentEditable ? 'textbox' : '') ||
            ({BUTTON:'button',A:'link',INPUT:['button','submit','reset'].includes(e.type) ? 'button' :
              ['checkbox','radio'].includes(e.type) ? e.type : 'textbox',
              SELECT:'combobox',TEXTAREA:'textbox'}[e.tagName] || '');
          const nameFor = e => {
            const ids = e.getAttribute('aria-labelledby');
            const labelled = ids && ids.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
            const label = e.labels && Array.from(e.labels).map(item => item.textContent || '').join(' ').trim();
            return (e.getAttribute('aria-label') || labelled || label || e.getAttribute('title') ||
              e.getAttribute('alt') || e.getAttribute('value') ||
              (e.matches('input,textarea,select') ? e.getAttribute('placeholder') : e.innerText) || '').trim().slice(0, 256);
          };
          const sensitive = e => /password|one-time-code|cc-|card|cvc|cvv|security.?code|verification.?code|otp/i
            .test([e.type, e.autocomplete, e.name, e.id, e.getAttribute('aria-label'), e.getAttribute('placeholder'),
              e.labels && Array.from(e.labels).map(label => label.textContent).join(' ')].join(' '));
          const fingerprintFor = (e, role, name, isSensitive) => JSON.stringify([
            role, name, e.tagName, String(e.type || '').slice(0, 32),
            String(e.name || '').slice(0, 128), String(e.getAttribute('aria-label') || '').slice(0, 128),
            !isSensitive && e.matches('input,textarea,select') ? String(e.value || '').slice(0, 128) : ''
          ]);
          const visible = e => {
            const style = getComputedStyle(e), rect = e.getBoundingClientRect();
            if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0 ||
                rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 ||
                rect.left >= innerWidth || rect.top >= innerHeight) return false;
            const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return !!top && (top === e || e.contains(top));
          };
          return Array.from(document.querySelectorAll('button,a[href],input:not([type="file"]):not([type="image"]),textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="textbox"],[role="combobox"]'))
            .filter(e => !e.disabled && e.getAttribute('aria-disabled') !== 'true' && visible(e))
            .slice(0, 100)
            .map(e => {
              const role = roleFor(e), name = nameFor(e);
              const isSensitive = sensitive(e);
              const value = !isSensitive && e.matches('input,textarea,select') ? String(e.value || '').slice(0, 128) : '';
              return Object.freeze({node:e, role, name, value, sensitive:isSensitive,
                fingerprint: fingerprintFor(e, role, name, isSensitive)});
            });
        })()
        """;

    private static readonly string ActionFunction = """
        function(expected, role, name, action, value, confirmed) {
          const roleFor = e => e.getAttribute('role') || (e.isContentEditable ? 'textbox' : '') ||
            ({BUTTON:'button',A:'link',INPUT:['button','submit','reset'].includes(e.type) ? 'button' :
              ['checkbox','radio'].includes(e.type) ? e.type : 'textbox',
              SELECT:'combobox',TEXTAREA:'textbox'}[e.tagName] || '');
          const nameFor = e => {
            const ids = e.getAttribute('aria-labelledby');
            const labelled = ids && ids.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
            const label = e.labels && Array.from(e.labels).map(item => item.textContent || '').join(' ').trim();
            return (e.getAttribute('aria-label') || labelled || label || e.getAttribute('title') ||
              e.getAttribute('alt') || e.getAttribute('value') ||
              (e.matches('input,textarea,select') ? e.getAttribute('placeholder') : e.innerText) || '').trim().slice(0, 256);
          };
          const sensitive = e => /password|one-time-code|cc-|card|cvc|cvv|security.?code|verification.?code|otp/i
            .test([e.type, e.autocomplete, e.name, e.id, e.getAttribute('aria-label'), e.getAttribute('placeholder'),
              e.labels && Array.from(e.labels).map(label => label.textContent).join(' ')].join(' '));
          const fingerprintFor = (e, currentRole, currentName, isSensitive) => JSON.stringify([
            currentRole, currentName, e.tagName, String(e.type || '').slice(0, 32),
            String(e.name || '').slice(0, 128), String(e.getAttribute('aria-label') || '').slice(0, 128),
            !isSensitive && e.matches('input,textarea,select') ? String(e.value || '').slice(0, 128) : ''
          ]);
          const currentRole = roleFor(this), currentName = nameFor(this), isSensitive = sensitive(this);
          if (!this.isConnected || currentRole !== role || currentName !== name ||
              fingerprintFor(this, currentRole, currentName, isSensitive) !== expected ||
              this.disabled || this.getAttribute('aria-disabled') === 'true') return {status:'stale'};
          const style = getComputedStyle(this), rect = this.getBoundingClientRect();
          if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0 ||
              rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 ||
              rect.left >= innerWidth || rect.top >= innerHeight) return {status:'stale'};
          const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
          const top = document.elementFromPoint(x, y);
          if (!top || (top !== this && !this.contains(top))) return {status:'covered'};
          if (action === 'click') {
            const context = this.closest('form,[role="dialog"],[aria-modal="true"]')?.innerText || '';
            const risky = /__IRREVERSIBLE_ACTION_PATTERN__/i.test(`${name} ${context}`);
            if (risky && !confirmed) return {status:'confirmation_required',summary:`Click "${name || role}" in Chrome.`};
            this.click();
          } else if (action === 'type') {
            const sensitive = /password|one-time-code|cc-|card|cvc|cvv|security.?code|verification.?code|otp/i
              .test([this.type, this.autocomplete, this.name, this.id, name, this.getAttribute('placeholder')].join(' '));
            if (sensitive || this.type === 'password') return {status:'blocked'};
            if (!this.matches('input:not([type="submit"]):not([type="button"]):not([type="hidden"]):not([type="file"]):not([type="image"]):not([type="checkbox"]):not([type="radio"]):not([type="reset"]),textarea,[contenteditable="true"]'))
              return {status:'stale'};
            if (/^\d{4,8}$/.test(value) || (value.replace(/\D/g, '').length >= 13 &&
                value.replace(/\D/g, '').length <= 19 && luhn(value.replace(/\D/g, '')))) return {status:'blocked'};
            this.focus();
            if (this.isContentEditable) this.textContent = value;
            else {
              const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value')?.set;
              if (setter) setter.call(this, (this.value || '') + value);
              else this.value = (this.value || '') + value;
            }

            this.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:value}));
            this.dispatchEvent(new Event('change', {bubbles:true}));
          } else if (action === 'select') {
            if (!(this instanceof HTMLSelectElement) || !Array.from(this.options).some(option => option.value === value))
              return {status:'stale'};
            this.value = value;
            this.dispatchEvent(new Event('input', {bubbles:true}));
            this.dispatchEvent(new Event('change', {bubbles:true}));
          } else if (action === 'scroll') {
            this.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
            window.scrollBy(0, value === 'down' ? 400 : -400);
          } else if (action !== 'wait') return {status:'stale'};
          return {status:'acted'};
          function luhn(number) {
            let sum = 0, alternate = false;
            for (let i = number.length - 1; i >= 0; i--) {
              let digit = Number(number[i]);
              if (alternate && (digit *= 2) > 9) digit -= 9;
              sum += digit; alternate = !alternate;
            }
            return sum % 10 === 0;
          }
        }
        """.Replace(
            "__IRREVERSIBLE_ACTION_PATTERN__",
            BrowserActionPolicy.IrreversibleActionPattern,
            StringComparison.Ordinal);

    private sealed record CdpTarget(
        string Id,
        string Type,
        string Title,
        string Url,
        [property: JsonPropertyName("webSocketDebuggerUrl")] string? WebSocketDebuggerUrl,
        bool IsExtension = false);

    private sealed record SnapshotReference(
        string ObjectId,
        string Role,
        string Name,
        string Value,
        string Fingerprint,
        bool Sensitive);

    private sealed record SnapshotState(
        string Id,
        string ObjectGroup,
        DateTimeOffset CreatedAt,
        IReadOnlyList<SnapshotReference> Elements);

    private sealed class TargetSession : IDisposable
    {
        private readonly ClientWebSocket? _socket;
        private readonly IExtensionBrowserPort? _extensionPort;
        private readonly string? _tabId;
        private readonly SemaphoreSlim _commandGate = new(1, 1);
        private int _nextId;
        private int _disposed;

        public TargetSession(ClientWebSocket socket) => _socket = socket;

        public TargetSession(IExtensionBrowserPort extensionPort, string tabId)
        {
            _extensionPort = extensionPort;
            _tabId = tabId;
        }

        public SnapshotState? Snapshot { get; set; }
        public bool UsesExtension => _extensionPort is not null;
        public bool IsOpen => _extensionPort?.IsConnected ?? _socket?.State == WebSocketState.Open;

        public async Task<JsonDocument> SendAsync(string method, object parameters, CancellationToken cancellationToken)
        {
            if (_extensionPort is not null)
            {
                await _commandGate.WaitAsync(cancellationToken).ConfigureAwait(false);
                try
                {
                    if (!_extensionPort.IsConnected) throw new BrowserActionRefusedException("not_found");
                    return await _extensionPort.SendCommandAsync(
                        _tabId!,
                        method,
                        JsonSerializer.SerializeToElement(parameters, JsonOptions),
                        cancellationToken).ConfigureAwait(false);
                }
                catch (BrowserActionRefusedException) { throw; }
                catch (OperationCanceledException) { throw; }
                catch { throw new BrowserActionRefusedException("failed"); }
                finally { _commandGate.Release(); }
            }

            await _commandGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (_socket?.State != WebSocketState.Open) throw new BrowserActionRefusedException("not_found");
                var id = Interlocked.Increment(ref _nextId);
                var payload = JsonSerializer.SerializeToUtf8Bytes(new { id, method, @params = parameters }, JsonOptions);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                await _socket.SendAsync(payload, WebSocketMessageType.Text, true, timeout.Token).ConfigureAwait(false);
                var buffer = new byte[8192];
                using var message = new MemoryStream();
                while (true)
                {
                    message.SetLength(0);
                    while (true)
                    {
                        var result = await _socket.ReceiveAsync(buffer, timeout.Token).ConfigureAwait(false);
                        if (result.MessageType == WebSocketMessageType.Close)
                            throw new BrowserActionRefusedException("not_found");
                        if (result.MessageType != WebSocketMessageType.Text || message.Length + result.Count > MaxTargetsBytes)
                            throw new BrowserActionRefusedException("failed");
                        message.Write(buffer, 0, result.Count);
                        if (result.EndOfMessage) break;
                    }
                    using var response = JsonDocument.Parse(message.GetBuffer().AsMemory(0, checked((int)message.Length)));
                    if (!response.RootElement.TryGetProperty("id", out var responseId) ||
                        responseId.ValueKind != JsonValueKind.Number || responseId.GetInt32() != id)
                    {
                        continue;
                    }
                    if (response.RootElement.TryGetProperty("error", out _))
                        throw new BrowserActionRefusedException("failed");
                    return JsonDocument.Parse(response.RootElement.GetRawText());
                }
            }
            catch (BrowserActionRefusedException) { throw; }
            catch (OperationCanceledException) { throw; }
            catch { throw new BrowserActionRefusedException("failed"); }
            finally { _commandGate.Release(); }
        }

        public Task DetachAsync(CancellationToken cancellationToken) =>
            _extensionPort is null
                ? Task.CompletedTask
                : _extensionPort.DetachAsync(_tabId!, cancellationToken);

        public async Task ReleaseSnapshotAsync(SnapshotState snapshot, CancellationToken cancellationToken)
        {
            try
            {
                using var _ = await SendAsync(
                    "Runtime.releaseObjectGroup",
                    new { objectGroup = snapshot.ObjectGroup },
                    cancellationToken).ConfigureAwait(false);
            }
            catch (BrowserActionRefusedException) { }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            if (_socket?.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                try { _socket.Abort(); } catch { }
            }
            _socket?.Dispose();
        }
    }
}

public static class BrowserActionPolicy
{
    public const string IrreversibleActionPattern =
        @"\b(?:send|sending|delete|deletion|erase|overwrite|overwriting|purchase|buy|pay|paid|payment|post|posting|publish|push|pushing|transfer|donate)\b|\bclear\s+(?:all|history|data|account)\b";

    public static bool RequiresConfirmation(string action, string name, string context = "") =>
        action == "click" && Regex.IsMatch(
            $"{name} {context}",
            IrreversibleActionPattern,
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
}

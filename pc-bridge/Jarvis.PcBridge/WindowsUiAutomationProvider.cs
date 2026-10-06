using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

public sealed class WindowsUiAutomationProvider : IUiAutomationProvider
{
    private const int MaxVisitedElements = 1_000;
    private const int MaxTreeDepth = 12;
    private static readonly TimeSpan ObservationLimit = TimeSpan.FromSeconds(1);
    private static readonly TreeWalker Walker = TreeWalker.ControlViewWalker;

    public UiAutomationView? Observe(CancellationToken cancellationToken)
    {
        var started = Stopwatch.StartNew();
        var window = ObserveWindow(cancellationToken);
        if (window is null) return null;
        var handle = new IntPtr(long.Parse(window.WindowId));
        var root = AutomationElement.FromHandle(handle);
        var controls = new List<UiAutomationControl>();
        var queue = new Queue<(AutomationElement Element, int Depth)>();
        queue.Enqueue((root, 0));
        var visited = 0;

        while (queue.Count > 0 && visited < MaxVisitedElements && started.Elapsed < ObservationLimit)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (element, depth) = queue.Dequeue();
            visited++;
            try
            {
                if (depth > 0) AddControl(element, controls);
                if (depth >= MaxTreeDepth) continue;
                var child = Walker.GetFirstChild(element);
                while (child is not null && visited + queue.Count < MaxVisitedElements &&
                       started.Elapsed < ObservationLimit)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    queue.Enqueue((child, depth + 1));
                    child = Walker.GetNextSibling(child);
                }
            }
            catch (ElementNotAvailableException)
            {
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        if (GetForegroundWindow() != handle) throw new UiAutomationRefusedException("stale");
        return window with { Controls = controls };
    }

    public UiAutomationView? ObserveWindow(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return null;
        _ = GetWindowThreadProcessId(handle, out var processId);
        using var process = Process.GetProcessById((int)processId);
        var processName = process.ProcessName.ToLowerInvariant();
        var application = processName switch
        {
            "code" => "vscode",
            "explorer" => "explorer",
            _ => processName,
        };
        return new UiAutomationView(application, handle.ToInt64().ToString(), []);
    }

    public void Act(
        UiAutomationControl control,
        UiAutomationAction action,
        string? value,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (control.NativeElement is not AutomationElement element)
            throw new CommandRefusedException("stale");

        switch (action)
        {
            case UiAutomationAction.Click:
                if (element.TryGetCurrentPattern(InvokePattern.Pattern, out var invoke))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    ((InvokePattern)invoke).Invoke();
                }
                else if (element.TryGetCurrentPattern(TogglePattern.Pattern, out var toggle))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    ((TogglePattern)toggle).Toggle();
                }
                else if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var selection))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    ((SelectionItemPattern)selection).Select();
                }
                else
                    throw new CommandRefusedException("blocked");
                break;
            case UiAutomationAction.Type:
                if (value is null || !element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern))
                    throw new CommandRefusedException("blocked");
                var valuePattern = (ValuePattern)pattern;
                if (valuePattern.Current.IsReadOnly) throw new CommandRefusedException("blocked");
                cancellationToken.ThrowIfCancellationRequested();
                valuePattern.SetValue(value);
                break;
            case UiAutomationAction.ScrollUp:
            case UiAutomationAction.ScrollDown:
                if (!element.TryGetCurrentPattern(ScrollPattern.Pattern, out var scroll))
                    throw new CommandRefusedException("blocked");
                cancellationToken.ThrowIfCancellationRequested();
                ((ScrollPattern)scroll).ScrollVertical(action == UiAutomationAction.ScrollUp
                    ? ScrollAmount.SmallDecrement
                    : ScrollAmount.SmallIncrement);
                break;
            default:
                throw new CommandRefusedException("not_allowed");
        }
        cancellationToken.ThrowIfCancellationRequested();
    }

    private static void AddControl(AutomationElement element, ICollection<UiAutomationControl> controls)
    {
        try
        {
            var current = element.Current;
            if (!current.IsEnabled || current.IsOffscreen) return;

            var name = new string((current.Name ?? string.Empty)
                .Where(character => !char.IsControl(character))
                .Take(256)
                .ToArray()).Trim();
            var isPassword = current.IsPassword;
            var canClick = HasPattern(element, InvokePattern.Pattern) ||
                HasPattern(element, TogglePattern.Pattern) ||
                HasPattern(element, SelectionItemPattern.Pattern);
            var canType = HasWritableValue(element);
            var canScroll = HasPattern(element, ScrollPattern.Pattern);
            if (!canClick && !canType && !canScroll) return;

            var runtimeId = string.Join("-", element.GetRuntimeId());
            controls.Add(new UiAutomationControl(
                runtimeId,
                Role(current.ControlType),
                name,
                current.IsEnabled,
                current.IsOffscreen,
                isPassword || UiAutomationPolicy.IsSensitiveControl(name),
                canClick,
                canType,
                canScroll,
                element));
        }
        catch (ElementNotAvailableException)
        {
        }
    }

    private static bool HasPattern(AutomationElement element, AutomationPattern pattern) =>
        element.TryGetCurrentPattern(pattern, out _);

    private static bool HasWritableValue(AutomationElement element) =>
        element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern) &&
        !((ValuePattern)pattern).Current.IsReadOnly;

    private static string Role(ControlType controlType)
    {
        if (controlType == ControlType.Button) return "button";
        if (controlType == ControlType.CheckBox) return "checkbox";
        if (controlType == ControlType.ComboBox) return "combobox";
        if (controlType == ControlType.Edit) return "edit";
        if (controlType == ControlType.ListItem) return "listitem";
        if (controlType == ControlType.MenuItem) return "menuitem";
        if (controlType == ControlType.RadioButton) return "radio";
        if (controlType == ControlType.TabItem) return "tab";
        if (controlType == ControlType.TreeItem) return "treeitem";
        return "control";
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}

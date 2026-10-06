using System.Runtime.InteropServices;
using System.Windows.Automation;
using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge;

public sealed class WindowsKeyboardProvider : IKeyboardProvider
{
    private const uint InputKeyboard = 1;
    private const uint KeyEventKeyUp = 0x0002;
    private const uint KeyEventUnicode = 0x0004;

    public bool IsSensitiveFieldFocused(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            if (GetForegroundWindow() == IntPtr.Zero) return true;
            var focused = AutomationElement.FocusedElement;
            if (focused is null) return true;
            var current = focused.Current;
            return current.IsPassword || UiAutomationPolicy.IsSensitiveControl(
                string.Join(' ', current.Name, current.AutomationId, current.HelpText));
        }
        catch
        {
            return true;
        }
    }

    public void SendKeys(IReadOnlyList<string> sequence, CancellationToken cancellationToken)
    {
        var foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero || IsSensitiveFieldFocused(cancellationToken) ||
            GetForegroundWindow() != foreground)
            throw new UiAutomationRefusedException("blocked");

        var events = new List<NativeInput>();
        foreach (var chord in sequence)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!CommandPolicy.TryParseKeyboardChord(chord, out var modifiers, out var key) ||
                !TryMapKey(key, modifiers, out var keyCode, out var implicitShift))
                throw new UiAutomationRefusedException("blocked");

            var down = modifiers.Select(ModifierKey).ToList();
            if (implicitShift && !down.Contains(0x10)) down.Add(0x10);
            foreach (var modifier in down) events.Add(KeyEvent(modifier, 0));
            events.Add(KeyEvent(keyCode, 0));
            events.Add(KeyEvent(keyCode, KeyEventKeyUp));
            foreach (var modifier in down.AsEnumerable().Reverse()) events.Add(KeyEvent(modifier, KeyEventKeyUp));
        }
        SendEvents(events, cancellationToken);
    }

    public void TypeFocused(string text, CancellationToken cancellationToken)
    {
        var foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero || IsSensitiveFieldFocused(cancellationToken) ||
            GetForegroundWindow() != foreground)
            throw new UiAutomationRefusedException("blocked");

        var events = new List<NativeInput>(text.Length * 2);
        foreach (var character in text)
        {
            cancellationToken.ThrowIfCancellationRequested();
            events.Add(UnicodeEvent(character, 0));
            events.Add(UnicodeEvent(character, KeyEventKeyUp));
        }
        SendEvents(events, cancellationToken);
    }

    private void SendEvents(IReadOnlyList<NativeInput> events, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero || IsSensitiveFieldFocused(cancellationToken) ||
            GetForegroundWindow() != foreground)
            throw new UiAutomationRefusedException("stale");

        cancellationToken.ThrowIfCancellationRequested();
        if (!WindowsCommandExecutor.IsInputIdle())
            throw new UiAutomationRefusedException("blocked");
        var sent = SendInput((uint)events.Count, events.ToArray(), Marshal.SizeOf<NativeInput>());
        if (sent == (uint)events.Count) return;

        var heldKeys = new HashSet<ushort>();
        for (var index = 0; index < sent; index++)
        {
            var keyboard = events[index].Data.Keyboard;
            if ((keyboard.Flags & KeyEventUnicode) != 0) continue;
            if ((keyboard.Flags & KeyEventKeyUp) != 0) heldKeys.Remove(keyboard.VirtualKey);
            else heldKeys.Add(keyboard.VirtualKey);
        }
        if (heldKeys.Count > 0)
            _ = SendInput((uint)heldKeys.Count,
                heldKeys.Select(key => KeyEvent(key, KeyEventKeyUp)).ToArray(),
                Marshal.SizeOf<NativeInput>());
        throw new UiAutomationRefusedException("failed");
    }

    private static ushort ModifierKey(string modifier) => modifier switch
    {
        "Ctrl" => 0x11,
        "Alt" => 0x12,
        "Shift" => 0x10,
        "Win" => 0x5B,
        _ => throw new UiAutomationRefusedException("blocked"),
    };

    private static bool TryMapKey(string key, IReadOnlyList<string> modifiers, out ushort virtualKey, out bool implicitShift)
    {
        implicitShift = false;
        virtualKey = key.ToLowerInvariant() switch
        {
            "enter" => 0x0D,
            "tab" => 0x09,
            "escape" or "esc" => 0x1B,
            "space" => 0x20,
            "backspace" => 0x08,
            "delete" => 0x2E,
            "insert" => 0x2D,
            "home" => 0x24,
            "end" => 0x23,
            "pageup" => 0x21,
            "pagedown" => 0x22,
            "arrowup" => 0x26,
            "arrowdown" => 0x28,
            "arrowleft" => 0x25,
            "arrowright" => 0x27,
            _ => 0,
        };
        if (virtualKey != 0) return true;

        if (key.Length is 2 or 3 && (key[0] is 'F' or 'f') &&
            int.TryParse(key[1..], out var functionKey) && functionKey is >= 1 and <= 12)
        {
            virtualKey = (ushort)(0x70 + functionKey - 1);
            return true;
        }

        if (key.Length != 1) return false;
        var scan = VkKeyScan(key[0]);
        if (scan == -1) return false;
        virtualKey = (ushort)(scan & 0xff);
        var requiredModifiers = (byte)(scan >> 8);
        if ((requiredModifiers & 0x06) != 0) return false;
        implicitShift = (requiredModifiers & 0x01) != 0 && modifiers.Count == 0;
        return true;
    }

    private static NativeInput KeyEvent(ushort key, uint flags) => new()
    {
        Type = InputKeyboard,
        Data = new InputUnion { Keyboard = new KeyboardInput { VirtualKey = key, Flags = flags } },
    };

    private static NativeInput UnicodeEvent(char character, uint flags) => new()
    {
        Type = InputKeyboard,
        Data = new InputUnion { Keyboard = new KeyboardInput { ScanCode = character, Flags = KeyEventUnicode | flags } },
    };

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeInput
    {
        public uint Type;
        public InputUnion Data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public KeyboardInput Keyboard;
        [FieldOffset(0)]
        public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X;
        public int Y;
        public uint Data;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, NativeInput[] inputs, int size);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern short VkKeyScan(char character);
}

namespace Jarvis.PcBridge.Core;

public static class InputIdlePolicy
{
    public const uint MinimumIdleMilliseconds = 500;

    public static bool CanInject(bool lastInputAvailable, uint nowTick, uint lastInputTick) =>
        lastInputAvailable && unchecked(nowTick - lastInputTick) >= MinimumIdleMilliseconds;
}

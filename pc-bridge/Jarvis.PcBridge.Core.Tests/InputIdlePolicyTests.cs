using Jarvis.PcBridge.Core;

namespace Jarvis.PcBridge.Core.Tests;

public sealed class InputIdlePolicyTests
{
    [Theory]
    [InlineData(1_000u, 501u, false)]
    [InlineData(1_000u, 500u, true)]
    [InlineData(1_000u, 0u, true)]
    [InlineData(0u, uint.MaxValue, false)]
    [InlineData(499u, uint.MaxValue, true)]
    [InlineData(498u, uint.MaxValue, false)]
    public void Requires_500ms_idle_including_tick_wrap(uint now, uint lastInput, bool expected) =>
        Assert.Equal(expected, InputIdlePolicy.CanInject(true, now, lastInput));

    [Fact]
    public void Fails_closed_when_native_last_input_cannot_be_read() =>
        Assert.False(InputIdlePolicy.CanInject(false, 10_000, 0));
}

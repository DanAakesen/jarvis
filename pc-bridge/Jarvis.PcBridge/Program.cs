namespace Jarvis.PcBridge;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        if (args.Contains("--native-messaging-host", StringComparer.Ordinal) ||
            args.Any(argument => argument.StartsWith("--parent-window=", StringComparison.Ordinal)))
        {
            NativeMessagingHost.RunAsync().GetAwaiter().GetResult();
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new BridgeApplicationContext());
    }
}
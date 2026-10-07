namespace Jarvis.PcBridge;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Contains("--native-messaging-host", StringComparer.Ordinal) ||
            args.Any(argument => argument.StartsWith("--parent-window=", StringComparison.Ordinal)))
        {
            return NativeMessagingHost.RunAsync().GetAwaiter().GetResult();
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new BridgeApplicationContext());
        return 0;
    }
}
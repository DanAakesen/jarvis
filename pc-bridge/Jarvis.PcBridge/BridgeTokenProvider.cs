using Jarvis.PcBridge.Core;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;

namespace Jarvis.PcBridge;

public sealed class BridgeTokenProvider
{
    private readonly IPublicClientApplication _application;
    private readonly MsalCacheHelper _cache;
    private readonly string[] _scopes;

    private BridgeTokenProvider(IPublicClientApplication application, MsalCacheHelper cache, string[] scopes)
    {
        _application = application;
        _cache = cache;
        _scopes = scopes;
    }

    public static async Task<BridgeTokenProvider> CreateAsync(BridgeSettings settings, CancellationToken cancellationToken)
    {
        var cacheDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Jarvis",
            "PcBridge");
        Directory.CreateDirectory(cacheDirectory);
        var application = PublicClientApplicationBuilder.Create(settings.BridgeClientId)
            .WithAuthority(AzureCloudInstance.AzurePublic, settings.TenantId)
            .Build();
        var storage = new StorageCreationPropertiesBuilder("pc-bridge.msalcache", cacheDirectory)
            .Build();
        var cache = await MsalCacheHelper.CreateAsync(storage).ConfigureAwait(false);
        cache.VerifyPersistence();
        cache.RegisterCache(application.UserTokenCache);
        return new BridgeTokenProvider(
            application,
            cache,
            [$"api://{settings.ApiClientId}/access_as_user"]);
    }

    public async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        var accounts = await _application.GetAccountsAsync().ConfigureAwait(false);
        try
        {
            if (accounts.FirstOrDefault() is { } account)
            {
                var silent = await _application.AcquireTokenSilent(_scopes, account)
                    .ExecuteAsync(cancellationToken).ConfigureAwait(false);
                return silent.AccessToken;
            }
        }
        catch (MsalUiRequiredException)
        {
        }

        var result = await _application.AcquireTokenWithDeviceCode(
            _scopes,
            deviceCode =>
            {
                MessageBox.Show(
                    deviceCode.Message,
                    "Sign in to Jarvis PC bridge",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information,
                    MessageBoxDefaultButton.Button1,
                    MessageBoxOptions.DefaultDesktopOnly);
                return Task.CompletedTask;
            }).ExecuteAsync(cancellationToken).ConfigureAwait(false);
        return result.AccessToken;
    }
}

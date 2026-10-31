import Foundation
import JarvisCore
import MSAL
import UIKit

enum MicrosoftAccessTokenProviderError: Error {
    case missingConfiguration
    case presentationUnavailable
    case emptyToken
}

@MainActor
final class MicrosoftAccessTokenProvider: AccessTokenProvider {
    private let application: MSALPublicClientApplication
    private let scope: String
    var onSignInRequired: (() -> Void)?

    init(bundle: Bundle = .main) throws {
        guard
            let clientID = Self.configuredValue("JARVIS_ENTRA_CLIENT_ID", bundle: bundle),
            let authorityValue = Self.configuredValue("JARVIS_ENTRA_AUTHORITY_URL", bundle: bundle),
            let scope = Self.configuredValue("JARVIS_ENTRA_API_SCOPE", bundle: bundle),
            let bundleID = bundle.bundleIdentifier,
            let authorityURL = URL(string: authorityValue),
            let authorityComponents = URLComponents(url: authorityURL, resolvingAgainstBaseURL: false),
            authorityComponents.scheme?.lowercased() == "https",
            authorityComponents.host?.lowercased() == "login.microsoftonline.com",
            authorityComponents.port == nil || authorityComponents.port == 443,
            authorityComponents.user == nil,
            authorityComponents.password == nil,
            authorityComponents.query == nil,
            authorityComponents.fragment == nil,
            authorityComponents.path.split(separator: "/").count == 1,
            let tenant = authorityComponents.path.split(separator: "/").first?.lowercased(),
            !["common", "consumers", "organizations"].contains(tenant),
            scope.split(separator: "/").last == "access_as_user"
        else {
            throw MicrosoftAccessTokenProviderError.missingConfiguration
        }

        let redirectURI = "msauth.\(bundleID)://auth"
        let authority = try MSALAADAuthority(url: authorityURL)
        let configuration = MSALPublicClientApplicationConfig(
            clientId: clientID,
            redirectUri: redirectURI,
            authority: authority
        )
        application = try MSALPublicClientApplication(configuration: configuration)
        self.scope = scope
    }

    func currentToken(for _: HTTPRequest) async throws -> String {
        guard let viewController = Self.presentationViewController() else {
            throw MicrosoftAccessTokenProviderError.presentationUnavailable
        }
        let webParameters = MSALWebviewParameters(authPresentationViewController: viewController)
        webParameters.webviewType = .authenticationSession
        let parameters = MSALInteractiveTokenParameters(scopes: [scope], webviewParameters: webParameters)

        return try await JarvisSignInRequest().token(start: { completion in
            application.acquireToken(with: parameters) { result, error in
                let outcome: Result<String, Error>
                if let error {
                    let nsError = error as NSError
                    if nsError.domain == MSALErrorDomain, nsError.code == MSALError.userCanceled.rawValue {
                        outcome = .failure(CancellationError())
                    } else if Self.isOffline(error) {
                        outcome = .failure(JarvisClientError.networkFailure)
                    } else {
                        outcome = .failure(error)
                    }
                } else if let token = result?.accessToken, !token.isEmpty {
                    outcome = .success(token)
                } else {
                    outcome = .failure(MicrosoftAccessTokenProviderError.emptyToken)
                }
                Task { @MainActor in completion(outcome) }
            }
        }, cancel: {
            _ = MSALPublicClientApplication.cancelCurrentWebAuthSession()
        })
    }

    func requestSignIn() async {
        onSignInRequired?()
    }

    func signOut() throws {
        for account in try application.allAccounts() {
            try application.remove(account)
        }
    }

    private static func configuredValue(_ key: String, bundle: Bundle) -> String? {
        guard
            let value = bundle.object(forInfoDictionaryKey: key) as? String,
            !value.isEmpty,
            !value.contains("$(")
        else {
            return nil
        }
        return value
    }

    private static func isOffline(_ error: Error, depth: Int = 0) -> Bool {
        guard depth < 4 else { return false }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            return [
                NSURLErrorNotConnectedToInternet,
                NSURLErrorTimedOut,
                NSURLErrorCannotConnectToHost,
                NSURLErrorNetworkConnectionLost,
                NSURLErrorDNSLookupFailed,
            ].contains(nsError.code)
        }
        guard let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? Error else { return false }
        return isOffline(underlying, depth: depth + 1)
    }

    private static func presentationViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
        let windows = scenes.flatMap(\.windows).filter {
            !$0.isHidden && $0.windowLevel == .normal && $0.rootViewController != nil
        }
        guard let window = windows.first(where: \.isKeyWindow) ?? windows.first else { return nil }

        var viewController = window.rootViewController
        while let presented = viewController?.presentedViewController {
            viewController = presented
        }
        guard let viewController, viewController.viewIfLoaded?.window === window,
              !viewController.isBeingDismissed else { return nil }
        return viewController
    }
}

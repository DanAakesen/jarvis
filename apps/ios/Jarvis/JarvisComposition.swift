import Foundation
import JarvisCore

enum JarvisCompositionError: Error {
    case missingBaseURL
}

extension Notification.Name {
    static let jarvisSignInRequired = Notification.Name("JarvisSignInRequired")
    static let jarvisAccountAccessChanged = Notification.Name("JarvisAccountAccessChanged")
    static let jarvisSessionRevoked = Notification.Name("JarvisSessionRevoked")
}

struct JarvisUnavailableAccessTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String {
        throw JarvisClientError.signInRequired
    }

    func requestSignIn() async {
        await MainActor.run {
            JarvisComposition.setAccountAccessSuspended(true)
            NotificationCenter.default.post(name: .jarvisSignInRequired, object: nil)
        }
    }
}

enum JarvisComposition {
    @MainActor private(set) static var accountAccessSuspended = false

    @MainActor static func setAccountAccessSuspended(_ suspended: Bool) {
        if suspended && accountAccessSuspended { return }
        accountAccessSuspended = suspended
        if suspended { CarScheduleActivityAttributes.clearActivities() }
        NotificationCenter.default.post(name: .jarvisAccountAccessChanged, object: nil)
    }

    static func makeClient(
        accessTokenProvider: any AccessTokenProvider,
        bundle: Bundle = .main,
        session: URLSession = .shared,
        requestTimeout: Duration = .seconds(30),
        retryPolicy: RetryPolicy = RetryPolicy()
    ) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: apiBaseURL(bundle: bundle),
                requestTimeout: requestTimeout,
                retryPolicy: retryPolicy
            ),
            transport: URLSessionTransport(session: session),
            tokenStore: try KeychainTokenStore(),
            accessTokenProvider: accessTokenProvider
        )
    }

    static func apiBaseURL(bundle: Bundle = .main) throws -> URL {
        guard let value = bundle.object(forInfoDictionaryKey: "JARVIS_API_BASE_URL") as? String,
              !value.isEmpty,
              let baseURL = URL(string: value) else {
            throw JarvisCompositionError.missingBaseURL
        }
        return baseURL
    }
}

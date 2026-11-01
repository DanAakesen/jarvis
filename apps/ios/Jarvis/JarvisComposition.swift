import Foundation
import JarvisCore

enum JarvisCompositionError: Error {
    case missingBaseURL
}

extension Notification.Name {
    static let jarvisSignInRequired = Notification.Name("JarvisSignInRequired")
    static let jarvisSessionRevoked = Notification.Name("JarvisSessionRevoked")
}

struct JarvisUnavailableAccessTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String {
        throw JarvisClientError.signInRequired
    }

    func requestSignIn() async {
        NotificationCenter.default.post(name: .jarvisSignInRequired, object: nil)
    }
}

enum JarvisComposition {
    static func makeWebAppURL(bundle: Bundle = .main) -> URL? {
        guard let value = bundle.object(forInfoDictionaryKey: "JARVIS_WEB_APP_URL") as? String,
              var components = URLComponents(string: value),
              components.scheme?.lowercased() == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/" else {
            return nil
        }
        components.path = ""
        return components.url
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

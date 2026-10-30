import Foundation
import JarvisCore

enum JarvisCompositionError: Error {
    case missingBaseURL
}

enum JarvisComposition {
    static func makeClient(
        accessTokenProvider: any AccessTokenProvider,
        bundle: Bundle = .main,
        session: URLSession = .shared
    ) throws -> JarvisClient {
        guard let value = bundle.object(forInfoDictionaryKey: "JARVIS_API_BASE_URL") as? String,
              !value.isEmpty,
              let baseURL = URL(string: value) else {
            throw JarvisCompositionError.missingBaseURL
        }
        return try JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: baseURL),
            transport: URLSessionTransport(session: session),
            tokenStore: try KeychainTokenStore(),
            accessTokenProvider: accessTokenProvider
        )
    }
}

struct JarvisUnavailableAccessTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String {
        throw JarvisClientError.signInRequired
    }

    func requestSignIn() async {}
}

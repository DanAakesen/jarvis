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
        try JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: apiBaseURL(bundle: bundle)),
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

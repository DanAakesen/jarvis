import JarvisCore
import SwiftUI

@main
struct JarvisApp: App {
    private let client: JarvisClient?
    private let webAppURL: URL?

    init() {
        client = try? JarvisComposition.makeClient(accessTokenProvider: StoredSessionTokenProvider())
        webAppURL = JarvisComposition.makeWebAppURL()
    }

    var body: some Scene {
        WindowGroup {
            ContentView(client: client, webAppURL: webAppURL)
        }
    }
}

private struct StoredSessionTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String {
        throw JarvisClientError.signInRequired
    }

    func requestSignIn() async {}
}

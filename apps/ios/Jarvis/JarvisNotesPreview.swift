import Foundation
import JarvisCore
import SwiftUI

#Preview("Noter · Dansk") {
    NavigationStack {
        JarvisNotesArea(
            client: JarvisNotesPreview.makeClient(),
            language: .da,
            onRetryConfiguration: {}
        )
    }
    .environmentObject(JarvisNavigationModel())
    .environment(\.locale, JarvisAppLanguage.da.locale)
}

#Preview("Notes · English") {
    NavigationStack {
        JarvisNotesArea(
            client: JarvisNotesPreview.makeClient(),
            language: .en,
            onRetryConfiguration: {}
        )
    }
    .environmentObject(JarvisNavigationModel())
    .environment(\.locale, JarvisAppLanguage.en.locale)
}

enum JarvisNotesPreview {
    static func makeClient() -> JarvisNotesClient? {
        let scenario = Data(
            """
            {
              "version": 1,
              "interactions": [
                {
                  "method": "GET",
                  "path": "/api/notes/tree",
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "directories": ["Inbox"],
                      "rootNoteCount": 0,
                      "truncated": false,
                      "updatedAt": "2026-10-30T12:00:00.000Z"
                    }
                  }
                },
                {
                  "method": "GET",
                  "path": "/api/notes",
                  "query": {"limit": "50", "offset": "0", "folder": "Inbox"},
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "notes": [{
                        "path": "Inbox/Synthetic_Note.md",
                        "title": "Synthetic note",
                        "folder": "Inbox",
                        "directory": "Inbox",
                        "updatedAt": "2026-10-30T12:00:00.000Z"
                      }],
                      "limit": 50,
                      "offset": 0,
                      "hasMore": false
                    }
                  }
                }
              ]
            }
            """.utf8
        )
        do {
            let transport = try FixtureTransport(scenario: scenario)
            let client = try JarvisClient(
                configuration: JarvisClientConfiguration(
                    baseURL: URL(string: "https://preview.invalid/api")!,
                    retryPolicy: RetryPolicy(maximumRetries: 0)
                ),
                transport: transport,
                tokenStore: JarvisNotesPreviewTokenStore(),
                accessTokenProvider: JarvisNotesPreviewTokenProvider()
            )
            return JarvisNotesClient(client: client)
        } catch {
            return nil
        }
    }
}

private actor JarvisNotesPreviewTokenStore: TokenStore {
    func read() async throws -> String? { "preview.session_token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor JarvisNotesPreviewTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String {
        "preview.access_token"
    }

    func requestSignIn() async {}
}

import Foundation
import XCTest
@testable import JarvisCore

final class JarvisNowFeedClientTests: XCTestCase {
    func testLoadsFullCalendarReviewAlongsideTenExistingConfirmations() async throws {
        let summary = String(repeating: "x", count: 40_000)
        let confirmations: [[String: String]] = (0..<11).map { index in
            let id = String(repeating: index == 10 ? "Z" : String(index), count: 43)
            return ["id": id, "actionKind": index == 10 ? "calendar_change" : "merge",
                    "summary": index == 10 ? summary : "Existing request",
                    "expiresAt": "2026-10-30T00:05:00Z"]
        }
        let scenario = try JSONSerialization.data(withJSONObject: [
            "version": 1, "interactions": [[
                "method": "GET", "path": "/api/now", "response": [
                    "statusCode": 200, "body": [
                        "running": [], "items": [], "updatedAt": "2026-10-30T00:00:02Z",
                        "awayMode": false, "confirmations": confirmations,
                    ],
                ],
            ]],
        ])
        let transport = try FixtureTransport(scenario: scenario)
        let feed = try await JarvisNowFeedClient(client: makeClient(transport: transport)).load()
        XCTAssertEqual(feed.confirmations.count, 11)
        XCTAssertEqual(feed.confirmations.last?.summary, summary)
    }

    func testLoadsFeedDismissesActivityAndResolvesConfirmation() async throws {
        let scenario = Data(
            """
            {
              "version": 1,
              "interactions": [
                {
                  "method": "GET",
                  "path": "/api/now",
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "running": [{"id":"7","title":"Synthetic task","project":"fixture","agent":"copilot","activity":"Working","startedAt":"2026-10-30T00:00:00Z"}],
                      "items": [{"id":"8","category":"attention","title":"Synthetic activity","link":"task:7","at":"2026-10-30T00:00:01Z"}],
                      "updatedAt":"2026-10-30T00:00:02Z",
                      "awayMode":false,
                      "confirmations":[{"id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","actionKind":"other","summary":"Synthetic confirmation","expiresAt":"2026-10-30T00:05:00Z"}]
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/now/activity/8/dismiss",
                  "response": {"statusCode":204}
                },
                {
                  "method": "POST",
                  "path": "/api/now/confirmations/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                  "requestBody":{"decision":"approve"},
                  "response":{"statusCode":204}
                }
              ]
            }
            """.utf8
        )
        let transport = try FixtureTransport(scenario: scenario)
        let client = try makeClient(transport: transport)
        let now = JarvisNowFeedClient(client: client)

        let feed = try await now.load()
        try await now.dismissActivity(id: "8")
        try await now.resolveConfirmation(
            id: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            decision: .approve
        )

        XCTAssertEqual(feed.running.count, 1)
        XCTAssertEqual(feed.items.first?.category, .attention)
        XCTAssertFalse(feed.awayMode)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(
            requests.map(\.path),
            [
                "/api/now",
                "/api/now/activity/8/dismiss",
                "/api/now/confirmations/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            ]
        )
    }

    func testRejectsInvalidActivityIDBeforeRequest() async throws {
        let transport = try FixtureTransport(scenario: Data(#"{"version":1,"interactions":[{"method":"POST","path":"/unused","response":{"statusCode":204}}]}"#.utf8))
        let now = JarvisNowFeedClient(client: try makeClient(transport: transport))

        do {
            try await now.dismissActivity(id: "0")
            XCTFail("Expected invalid activity id")
        } catch {
            XCTAssertEqual(error as? JarvisNowFeedClientError, .invalidActivityID)
        }
        let requests = await transport.recordedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    private func makeClient(transport: any HTTPTransport) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: URL(string: "https://fixture.invalid/api")!),
            transport: transport,
            tokenStore: NowFeedTokenStore(),
            accessTokenProvider: NowFeedTokenProvider()
        )
    }
}

private actor NowFeedTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct NowFeedTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}

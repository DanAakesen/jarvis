import Foundation
import XCTest
@testable import JarvisCore

final class WorkspacesClientTests: XCTestCase {
    func testSearchUsesExistingWorkspaceRouteAndValidatesItems() async throws {
        let transport = try makeTransport("""
        {"version":1,"interactions":[
          {"method":"GET","path":"/api/workspaces","query":{"q":"synthetic","kind":"research"},"response":{"statusCode":200,"body":{"items":[\(itemJSON(title: "Synthetic report"))]}}}
        ]}
        """)
        let client = makeClient(transport: transport)

        let items = try await client.search(query: "  synthetic  ", kind: .research)

        XCTAssertEqual(items.map(\.title), ["Synthetic report"])
        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 0)
    }

    func testMutationsUseExistingOpenRenamePinAndDeleteRoutes() async throws {
        let item = try makeItem()
        let renamed = itemJSON(title: "Renamed report")
        let pinned = itemJSON(title: "Renamed report", pinned: true)
        let transport = try makeTransport("""
        {"version":1,"interactions":[
          {"method":"PATCH","path":"/api/workspaces/\(item.id)","requestBody":{"title":"Renamed report"},"response":{"statusCode":200,"body":\(renamed)}},
          {"method":"PATCH","path":"/api/workspaces/\(item.id)","requestBody":{"pinned":true},"response":{"statusCode":200,"body":\(pinned)}},
          {"method":"POST","path":"/api/workspaces/\(item.id)/open","requestBody":{},"response":{"statusCode":200,"body":\(pinned)}},
          {"method":"DELETE","path":"/api/workspaces/\(item.id)","requestBody":{"confirm":true},"response":{"statusCode":200,"body":{"deleted":true}}}
        ]}
        """)
        let client = makeClient(transport: transport)

        let titleUpdate = try await client.rename(item, title: " Renamed report ")
        let pinUpdate = try await client.setPinned(titleUpdate, pinned: true)
        let opened = try await client.open(pinUpdate)
        try await client.remove(opened)

        XCTAssertEqual(opened.title, "Renamed report")
        XCTAssertTrue(opened.pinned)
        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 0)
    }

    func testGroupingPutsPinnedFirstAndUsesLocalCalendarDays() throws {
        let now = try XCTUnwrap(SavedWorkspaceItem.date(from: "2026-10-30T12:00:00.000Z"))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let items = [
            try makeItem(title: "Earlier", createdAt: "2026-10-23T12:00:00.000Z"),
            try makeItem(title: "Pinned", createdAt: "2026-10-01T12:00:00.000Z", pinned: true),
            try makeItem(title: "This week", createdAt: "2026-10-25T12:00:00.000Z"),
            try makeItem(title: "Today", createdAt: "2026-10-30T08:00:00.000Z"),
        ]

        let groups = SavedWorkspaceGrouping.groups(items, now: now, calendar: calendar)

        XCTAssertEqual(groups.map(\.title), ["Pinned", "Today", "This week", "Earlier"])
        XCTAssertEqual(groups.map { $0.items.first?.title }, ["Pinned", "Today", "This week", "Earlier"])
    }

    func testRejectsOversizedSearchAndMalformedItemsLocally() async throws {
        let transport = try makeTransport("""
        {"version":1,"interactions":[{"method":"GET","path":"/api/workspaces","response":{"statusCode":200,"body":{"items":[]}}}]}
        """)
        let client = makeClient(transport: transport)

        do {
            _ = try await client.search(query: String(repeating: "x", count: 121))
            XCTFail("Expected oversized search to be rejected")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .invalidRequest)
        }
        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 1)

        XCTAssertThrowsError(try SavedWorkspaceItem(
            id: "image:123e4567-e89b-42d3-a456-426614174000",
            title: "Synthetic report",
            kind: .research,
            createdAt: "2026-10-30T12:00:00.000Z",
            promptSummary: "Synthetic summary",
            pinned: false
        ))
    }

    private func makeItem(
        title: String = "Synthetic report",
        createdAt: String = "2026-10-30T12:00:00.000Z",
        pinned: Bool = false
    ) throws -> SavedWorkspaceItem {
        try SavedWorkspaceItem(
            id: "research:123e4567-e89b-42d3-a456-426614174000",
            title: title,
            kind: .research,
            createdAt: createdAt,
            promptSummary: "Synthetic summary",
            pinned: pinned
        )
    }

    private func itemJSON(title: String, pinned: Bool = false) -> String {
        """
        {"id":"research:123e4567-e89b-42d3-a456-426614174000","title":"\(title)","kind":"research","createdAt":"2026-10-30T12:00:00.000Z","promptSummary":"Synthetic summary","pinned":\(pinned)}
        """
    }

    private func makeTransport(_ scenario: String) throws -> FixtureTransport {
        try FixtureTransport(scenario: Data(scenario.utf8))
    }

    private func makeClient(transport: FixtureTransport) -> JarvisWorkspacesClient {
        let client = try! JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0, delay: .zero, maximumDelay: .zero)
            ),
            transport: transport,
            tokenStore: FixtureWorkspaceTokenStore(),
            accessTokenProvider: FixtureWorkspaceTokenProvider()
        )
        return JarvisWorkspacesClient(client: client)
    }
}

private actor FixtureWorkspaceTokenStore: TokenStore {
    func read() async throws -> String? { "session.fixture.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor FixtureWorkspaceTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "entra.fixture.token" }
    func requestSignIn() async {}
}

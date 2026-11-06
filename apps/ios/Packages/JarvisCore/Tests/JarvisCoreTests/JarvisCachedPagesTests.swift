import Foundation
import XCTest
@testable import JarvisCore

/// Every cached page read: sends If-None-Match, maps 304 to `notModified`, returns the server ETag with a valid 200,
/// never caches an invalid body, and sign-out clears every kind of cached data.
final class JarvisCachedPagesTests: XCTestCase {
    private func make(_ transport: ETagTransport) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0)
            ),
            transport: transport,
            tokenStore: CachedPagesTokenStore(),
            accessTokenProvider: CachedPagesTokenProvider()
        )
    }

    private func statusJSON() throws -> String {
        let entries = JarvisStatusCheckID.allCases.map {
            JarvisStatusEntry(id: $0.rawValue, status: .ok, checkedAt: "2026-11-04T10:00:00.000Z")
        }
        let snapshot = JarvisStatusSnapshot(checkedAt: "2026-11-04T10:00:00.000Z", entries: entries)
        return String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)
    }

    /// Runs one conditional read twice: once cold, once with the ETag the first answer carried.
    private func assertConditional<Value: Sendable & Equatable>(
        path: String,
        body: String,
        file: StaticString = #filePath,
        line: UInt = #line,
        read: (JarvisClient, String?) async throws -> JarvisFetchResult<Value>
    ) async throws {
        let transport = ETagTransport(routes: [path: (etag: "\"v1\"", body: body)])
        let client = try make(transport)
        let first = try await read(client, nil)
        guard case .modified(_, let validator) = first else { return XCTFail("cold read: \(first)", file: file, line: line) }
        XCTAssertEqual(validator, "\"v1\"", file: file, line: line)
        let second = try await read(client, validator)
        guard case .notModified = second else { return XCTFail("warm read: \(second)", file: file, line: line) }
        let requests = await transport.requests
        XCTAssertEqual(requests.map(\.path), [path, path], file: file, line: line)
        XCTAssertNil(requests[0].ifNoneMatch, file: file, line: line)
        XCTAssertEqual(requests[1].ifNoneMatch, "\"v1\"", file: file, line: line)
    }

    private func assertRejectsInvalidBody<Value: Sendable>(
        path: String,
        file: StaticString = #filePath,
        line: UInt = #line,
        read: (JarvisClient, String?) async throws -> JarvisFetchResult<Value>
    ) async throws {
        let transport = ETagTransport(routes: [path: (etag: "\"bad\"", body: "{\"unexpected\":true}")])
        do {
            _ = try await read(try make(transport), nil)
            XCTFail("An invalid body must never be cached", file: file, line: line)
        } catch {}
    }

    func testUsageCurrentContractReadsConditionallyForEveryPeriod() async throws {
        for period in JarvisUsagePeriod.allCases {
            let report = JarvisUsageReport(period: period.rawValue, from: nil, to: "2026-11-04T10:00:00Z",
                entries: [], totalEntries: "0", toolCalls: [])
            try await assertConditional(path: "/api/usage", body: String(decoding: JSONEncoder().encode(report), as: UTF8.self)) {
                try await JarvisUsageClient(client: $0).fetchReport(period: period, validator: $1)
            }
        }
        try await assertRejectsInvalidBody(path: "/api/usage") {
            try await JarvisUsageClient(client: $0).fetchReport(period: .thirtyDays, validator: $1)
        }
    }

    func testStatusRepositoryReadsConditionally() async throws {
        let json = try statusJSON()
        try await assertConditional(path: "/api/status", body: json) {
            try await JarvisStatusClient(client: $0).fetchSnapshot(validator: $1)
        }
        try await assertRejectsInvalidBody(path: "/api/status") {
            try await JarvisStatusClient(client: $0).fetchSnapshot(validator: $1)
        }
    }

    func testProactiveRepositoriesReadConditionally() async throws {
        try await assertConditional(path: "/api/proactive/items", body: #"{"items":[]}"#) {
            try await JarvisProactiveClient(client: $0).fetchItems(validator: $1)
        }
        try await assertConditional(path: "/api/proactive/runs", body: #"{"runs":[]}"#) {
            try await JarvisProactiveClient(client: $0).fetchRuns(validator: $1)
        }
        try await assertRejectsInvalidBody(path: "/api/proactive/status") {
            try await JarvisProactiveClient(client: $0).fetchStatus(validator: $1)
        }
        let transport = ETagTransport(routes: [:], alwaysNotModified: true)
        let result = try await JarvisProactiveClient(client: try make(transport)).fetchStatus(validator: "\"s\"")
        guard case .notModified = result else { return XCTFail("\(result)") }
    }

    func testNotificationsRepositoryReadsConditionally() async throws {
        try await assertConditional(
            path: "/api/now",
            body: #"{"confirmations":[],"awayMode":false,"updatedAt":"2026-11-04T10:00:00.000Z"}"#
        ) { try await JarvisApprovalsClient(client: $0).fetchPending(validator: $1) }
        try await assertRejectsInvalidBody(path: "/api/now") {
            try await JarvisApprovalsClient(client: $0).fetchPending(validator: $1)
        }
    }

    func testSettingsRepositoryReadsConditionally() async throws {
        try await assertConditional(
            path: "/api/settings",
            body: #"{"settings":{"appearance":{"theme":"dark"}},"options":{},"credentials":[]}"#
        ) { try await JarvisSettingsClient(client: $0).fetchSettings(validator: $1) }
        try await assertRejectsInvalidBody(path: "/api/settings") {
            try await JarvisSettingsClient(client: $0).fetchSettings(validator: $1)
        }
    }

    func testNotesRepositoriesReadConditionally() async throws {
        try await assertConditional(
            path: "/api/notes/tree",
            body: #"{"directories":["Work"],"rootNoteCount":1,"truncated":false,"updatedAt":"2026-11-04T10:00:00.000Z"}"#
        ) { try await JarvisNotesClient(client: $0).fetchFolderTree(validator: $1) }
        try await assertConditional(
            path: "/api/notes",
            body: #"{"notes":[],"limit":50,"offset":0,"hasMore":false}"#
        ) { try await JarvisNotesClient(client: $0).fetchNotes(validator: $1) }
        try await assertConditional(
            path: "/api/vault/tasks",
            body: #"{"items":[],"readAt":"2026-11-04T10:00:00.000Z","today":"2026-11-04","total":0,"truncated":false}"#
        ) { try await JarvisNotesClient(client: $0).fetchOpenTasks(validator: $1) }
        try await assertRejectsInvalidBody(path: "/api/vault/tasks") {
            try await JarvisNotesClient(client: $0).fetchOpenTasks(validator: $1)
        }
    }

    func testHealthRepositoriesReadConditionally() async throws {
        try await assertConditional(
            path: "/api/health/capabilities",
            body: #"{"module":"health","version":6,"sources":["steps"]}"#
        ) { try await JarvisHealthClient(client: $0).fetchCapabilities(validator: $1) }
        try await assertConditional(
            path: "/api/health/training-targets",
            body: #"{"targets":{"gymSessionsPerWeek":3}}"#
        ) { try await JarvisHealthClient(client: $0).fetchTrainingTargets(validator: $1) }
        try await assertConditional(
            path: "/api/health/nutrition-targets",
            body: #"{"targets":{"proteinGrams":150}}"#
        ) { try await JarvisHealthClient(client: $0).fetchNutritionTargets(validator: $1) }
        try await assertRejectsInvalidBody(path: "/api/health/capabilities") {
            try await JarvisHealthClient(client: $0).fetchCapabilities(validator: $1)
        }
    }

    func testFactoryRepositoriesReadConditionally() async throws {
        try await assertConditional(path: "/api/factory/projects", body: "[]") {
            try await JarvisFactoryClient(client: $0).fetchProjects(validator: $1)
        }
        try await assertRejectsInvalidBody(path: "/api/factory/projects") {
            try await JarvisFactoryClient(client: $0).fetchProjects(validator: $1)
        }
        let transport = ETagTransport(routes: [:], alwaysNotModified: true)
        let board = try await JarvisFactoryClient(client: try make(transport)).fetchBoard(projectId: "7", validator: "\"b\"")
        guard case .notModified = board else { return XCTFail("\(board)") }
        let requests = await transport.requests
        XCTAssertEqual(requests.first?.path, "/api/factory/board")
        XCTAssertEqual(requests.first?.query, "project=7")
    }

    func testSignOutClearsEveryKindOfCachedData() async throws {
        let storage = JarvisInMemoryCacheStorage()
        let cache = JarvisCache(storage: storage)
        await cache.bind(account: "owner")
        var repositories: [JarvisRepository<[String]>] = []
        for kind in JarvisRepositoryKind.allCases {
            let repository = JarvisRepository<[String]>(cache: cache, kind: kind) { _ in .modified([kind.rawValue], validator: "e") }
            for await _ in repository.updates() {}
            repositories.append(repository)
        }
        for repository in repositories {
            let stored = await repository.cachedValue()
            XCTAssertNotNil(stored)
        }
        await cache.clear()
        for repository in repositories {
            let cleared = await repository.cachedValue()
            XCTAssertNil(cleared)
        }
        let account = await cache.currentAccount
        XCTAssertNil(account)
    }

    func testCardStateKeepsCachedValueWhenRefreshFails() {
        struct Offline: Error {}
        var state = JarvisCardState<[String]>.loading
        state.apply(.refreshing)
        XCTAssertTrue(state.isLoading)
        state.apply(.cached(["a"], isStale: true))
        XCTAssertEqual(state.value, ["a"])
        state.apply(.failed(Offline(), cached: ["a"]))
        XCTAssertEqual(state.value, ["a"])
        XCTAssertTrue(state.refreshFailed)
        state.apply(.fresh(["b"]))
        XCTAssertEqual(state.value, ["b"])
        XCTAssertFalse(state.refreshFailed)
        var cold = JarvisCardState<[String]>.loading
        cold.apply(.failed(Offline(), cached: nil))
        guard case .failed = cold else { return XCTFail("\(cold)") }
    }
}

private struct RecordedRequest: Sendable {
    let path: String
    let query: String?
    let ifNoneMatch: String?
}

private actor ETagTransport: HTTPTransport {
    private let routes: [String: (etag: String, body: String)]
    private let alwaysNotModified: Bool
    private(set) var requests: [RecordedRequest] = []

    init(routes: [String: (etag: String, body: String)], alwaysNotModified: Bool = false) {
        self.routes = routes
        self.alwaysNotModified = alwaysNotModified
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let components = URLComponents(url: request.url, resolvingAgainstBaseURL: false)
        let path = components?.path ?? ""
        let ifNoneMatch = request.headers["If-None-Match"]
        requests.append(RecordedRequest(path: path, query: components?.query, ifNoneMatch: ifNoneMatch))
        if alwaysNotModified { return HTTPResponse(statusCode: 304) }
        guard let route = routes[path] else { return HTTPResponse(statusCode: 404) }
        if ifNoneMatch == route.etag { return HTTPResponse(statusCode: 304, headers: ["ETag": route.etag]) }
        return HTTPResponse(statusCode: 200, headers: ["ETag": route.etag], body: Data(route.body.utf8))
    }
}

private actor CachedPagesTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct CachedPagesTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.access.token" }
    func requestSignIn() async {}
}

import Foundation
import XCTest
@testable import JarvisCore

final class JarvisSettingsClientTests: XCTestCase {
    func testSettingsLoadAndSaveUseSharedOwnerRoutesAndKeepTypedPatch() async throws {
        let transport = try settingsFixture("""
        {
          "version": 1,
          "interactions": [
            {
              "method": "GET",
              "path": "/api/settings",
              "response": {
                "statusCode": 200,
                "body": {
                  "settings": {"appearance": {"theme": "system"}},
                  "options": {"themes": ["light", "dark", "system"]},
                  "credentials": []
                }
              }
            },
            {
              "method": "PATCH",
              "path": "/api/settings",
              "requestBody": {"settings": {"appearance": {"theme": "dark"}}},
              "response": {
                "statusCode": 200,
                "body": {
                  "settings": {"appearance": {"theme": "dark"}},
                  "options": {"themes": ["light", "dark", "system"]},
                  "credentials": []
                }
              }
            }
          ]
        }
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport))

        let loaded = try await settings.loadSettings()
        let saved = try await settings.saveSettings(
            JarvisSettingsPatch(area: "appearance", key: "theme", value: .string("dark"))
        )
        let requests = await transport.recordedRequests()

        XCTAssertEqual(loaded.string(area: "appearance", key: "theme"), "system")
        XCTAssertEqual(saved.string(area: "appearance", key: "theme"), "dark")
        XCTAssertEqual(requests.map(\.path), ["/api/settings", "/api/settings"])
        await assertConsumed(transport)
    }

    func testTargetWritesAreBoundedAndMemoryPagesUseTheVerifiedOffsetContract() async throws {
        let transport = try settingsFixture("""
        {
          "version": 1,
          "interactions": [
            {
              "method": "PATCH",
              "path": "/api/daily/training-targets",
              "requestBody": {"gymSessionsPerWeek": 3},
              "response": {
                "statusCode": 200,
                "body": {
                  "targets": {"gymSessionsPerWeek": 3},
                  "bounds": {"gymSessionsPerWeek": {"label": "Gym", "unit": "sessions", "min": 0, "max": 7}},
                  "missing": [],
                  "updatedAt": null
                }
              }
            },
            {
              "method": "GET",
              "path": "/api/memory",
              "query": {"folder": "General", "limit": "50", "offset": "50", "query": "synthetic"},
              "response": {
                "statusCode": 200,
                "body": {
                  "items": [{
                    "id": 42, "type": "memory", "title": "Synthetic memory",
                    "folder": "General", "content": "Synthetic memory text.", "updatedAt": null
                  }],
                  "count": 1, "limit": 50, "offset": 50, "hasMore": false
                }
              }
            }
          ]
        }
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport))

        let targets = try await settings.saveTrainingTargets(["gymSessionsPerWeek": 3])
        let memories = try await settings.loadMemory(query: "synthetic", offset: 50)

        XCTAssertEqual(targets.targets["gymSessionsPerWeek"]!, 3)
        XCTAssertEqual(memories.items.map(\.title), ["Synthetic memory"])
        XCTAssertEqual(memories.items.first?.id, "42")
        XCTAssertFalse(memories.hasMore)
        await assertConsumed(transport)
    }

    func testInvalidWritesAreRejectedBeforeAnyFixtureRequest() async throws {
        let transport = try settingsFixture("""
        {"version":1,"interactions":[{"method":"GET","path":"/api/me","response":{"statusCode":200,"body":{"name":"Fixture Owner"}}}]}
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport))

        do {
            _ = try await settings.loadMemory(offset: 10_001)
            XCTFail("An out-of-range memory offset must be rejected")
        } catch {
            XCTAssertEqual(error as? JarvisSettingsClientError, .invalidRequest)
        }
        do {
            try await settings.updateMemory(id: "../private", text: "Synthetic text")
            XCTFail("An unsafe memory identifier must be rejected")
        } catch {
            XCTAssertEqual(error as? JarvisSettingsClientError, .invalidRequest)
        }
        do {
            _ = try await settings.saveNutritionTargets(["unknownTarget": 1])
            XCTFail("Unknown target fields must be rejected")
        } catch {
            XCTAssertEqual(error as? JarvisSettingsClientError, .invalidRequest)
        }

        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 1)
    }

    func testSettingsDraftTracksOnlyChangedValuesAndKeepsFailedEdits() {
        let original: JarvisSettingsValue = .object([
            "appearance": .object(["theme": .string("system")]),
            "roles": .object([
                "chat": .object(["model": .string("fixture-model"), "reasoningEffort": .string("none")]),
            ]),
        ])
        var draft = JarvisSettingsEditState(original)
        XCTAssertFalse(draft.isDirty)
        draft.set(.string("dark"), area: "appearance", key: "theme")

        XCTAssertTrue(draft.isDirty)
        XCTAssertEqual(draft.changes?.areas["appearance"]?["theme"], .string("dark"))
        XCTAssertEqual(draft.saved, original)
        XCTAssertEqual(draft.value["appearance"]?["theme"], .string("dark"))

        draft.markSaved(draft.value)
        XCTAssertFalse(draft.isDirty)
    }

    func testSettingsValidationBoundsRowsAndErrorMapping() throws {
        let bound = JarvisTargetBound(label: "Synthetic target", unit: "items", min: 2, max: 8)
        XCTAssertTrue(JarvisSettingsLogic.validTarget(2, bound: bound))
        XCTAssertFalse(JarvisSettingsLogic.validTarget(9, bound: bound))
        XCTAssertTrue(JarvisSettingsLogic.validTarget(nil, bound: bound))
        XCTAssertTrue(JarvisSettingsLogic.validOption("system", options: ["light", "dark", "system"]))
        XCTAssertFalse(JarvisSettingsLogic.validOption("unknown", options: ["light", "dark", "system"]))
        XCTAssertTrue(JarvisSettingsLogic.validMemoryPage(offset: 10_000, limit: 50))
        XCTAssertFalse(JarvisSettingsLogic.validMemoryPage(offset: 10_001, limit: 50))
        XCTAssertFalse(JarvisSettingsLogic.validMemoryPage(offset: 0, limit: 51))
        XCTAssertFalse(JarvisSettingsLogic.validDeploymentInput(model: " ", version: "v1", sku: "Standard", capacity: 1))

        XCTAssertEqual(
            JarvisSettingsLogic.filter(
                ["appearance", "voice"],
                labels: ["appearance": "Udseende", "voice": "Stemme"],
                query: "UDSEENDE",
                language: .da
            ),
            ["appearance"]
        )
    }

    func testSignOutRevokesTheServerSessionBeforeDeletingTheStoredToken() async throws {
        let tokenStore = SettingsTokenStore()
        let transport = try settingsFixture("""
        {"version":1,"interactions":[{"method":"DELETE","path":"/api/auth/session","response":{"statusCode":204}}]}
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport, tokenStore: tokenStore))

        try await settings.signOut()
        let storedToken = try await tokenStore.read()
        let requests = await transport.recordedRequests()

        XCTAssertNil(storedToken)
        XCTAssertEqual(requests.map(\.path), ["/api/auth/session"])
        await assertConsumed(transport)
    }

    private func makeClient(
        _ transport: FixtureTransport,
        tokenStore: SettingsTokenStore = SettingsTokenStore()
    ) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0)
            ),
            transport: transport,
            tokenStore: tokenStore,
            accessTokenProvider: SettingsTokenProvider()
        )
    }
}

private func assertConsumed(
    _ transport: FixtureTransport,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    let remaining = await transport.remainingInteractions()
    XCTAssertEqual(remaining, 0, file: file, line: line)
}

private func settingsFixture(_ json: String) throws -> FixtureTransport {
    try FixtureTransport(scenario: Data(json.utf8))
}

private actor SettingsTokenStore: TokenStore {
    private var token: String? = "synthetic.owner.session"

    func read() async throws -> String? { token }
    func write(_ token: String) async throws { self.token = token }
    func delete() async throws { token = nil }
}

private struct SettingsTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "synthetic.entra.token" }
    func requestSignIn() async {}
}

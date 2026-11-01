import Foundation
import XCTest
@testable import JarvisCore

final class JarvisSettingsClientTests: XCTestCase {
    func testEverySettingsLabelHasDanishAndEnglishCopy() {
        XCTAssertEqual(JarvisAppLanguage.default, .da)
        for key in JarvisSettingsLocalizationKey.allCases {
            XCTAssertNotEqual(JarvisSettingsLocalization.string(key, language: .da), key.rawValue)
            XCTAssertNotEqual(JarvisSettingsLocalization.string(key, language: .en), key.rawValue)
        }
        XCTAssertEqual(JarvisSettingsLocalization.string(.general, language: .da), "Generelt")
        XCTAssertEqual(JarvisSettingsLocalization.string(.models, language: .en), "Models")
        XCTAssertEqual(JarvisSettingsLocalization.string(.save, language: .da), "Gem")
    }

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

    func testVoiceLanguageMenuSavesThroughTheExistingSettingsRoute() async throws {
        let transport = try settingsFixture("""
        {
          "version": 1,
          "interactions": [{
            "method": "PATCH",
            "path": "/api/settings",
            "requestBody": {"settings": {"voice": {"defaultLanguage": "en"}}},
            "response": {
              "statusCode": 200,
              "body": {
                "settings": {"voice": {"defaultLanguage": "en"}},
                "options": {},
                "credentials": []
              }
            }
          }]
        }
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport))

        let saved = try await settings.saveSettings(
            JarvisSettingsPatch(
                area: "voice",
                key: "defaultLanguage",
                value: .string(ChatLanguage.en.rawValue)
            )
        )

        XCTAssertEqual(saved.string(area: "voice", key: "defaultLanguage"), "en")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), ["/api/settings"])
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
                  "targets": {"gymSessionsPerWeek": 3, "runSessionsPerWeek": null, "dailySteps": null},
                  "bounds": {
                    "gymSessionsPerWeek": {"label": "Gym", "unit": "sessions", "min": 0, "max": 7},
                    "runSessionsPerWeek": {"label": "Run", "unit": "sessions", "min": 0, "max": 7},
                    "dailySteps": {"label": "Steps", "unit": "steps", "min": 0, "max": 200000}
                  },
                  "missing": ["runSessionsPerWeek", "dailySteps"],
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
                  }, {
                    "id": "vault_synthetic", "type": "vault_note", "title": "Synthetic note",
                    "folder": "General", "content": "Synthetic note content.", "updatedAt": null
                  }],
                  "count": 2, "limit": 50, "offset": 50, "hasMore": false
                }
              }
            }
          ]
        }
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport))

        let targets = try await settings.saveTrainingTargets(
            ["gymSessionsPerWeek": 3],
            bounds: [
                "gymSessionsPerWeek": JarvisTargetBound(label: "Gym", unit: "sessions", min: 0, max: 7),
            ]
        )
        let memories = try await settings.loadMemory(query: "synthetic", offset: 50)

        XCTAssertEqual(targets.targets["gymSessionsPerWeek"]?.integerValue, 3)
        XCTAssertEqual(targets.targets["runSessionsPerWeek"], .null)
        XCTAssertEqual(memories.items.map(\.title), ["Synthetic memory"])
        XCTAssertEqual(memories.count, 1)
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
            _ = try await settings.saveNutritionTargets(["unknownTarget": 1], bounds: [:])
            XCTFail("Unknown target fields must be rejected")
        } catch {
            XCTAssertEqual(error as? JarvisSettingsClientError, .invalidRequest)
        }
        do {
            _ = try await settings.saveSettings(
                JarvisSettingsPatch(area: "appearance", key: "theme", value: .string("unknown-theme"))
            )
            XCTFail("Unknown settings values must be rejected")
        } catch {
            XCTAssertEqual(error as? JarvisSettingsClientError, .invalidRequest)
        }
        do {
            _ = try await settings.saveSettings(
                JarvisSettingsPatch(area: "voice", key: "defaultLanguage", value: .string("fr"))
            )
            XCTFail("Only Danish and English voice languages are supported")
        } catch {
            XCTAssertEqual(error as? JarvisSettingsClientError, .invalidRequest)
        }

        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 1)
    }

    func testRoutineDeleteUsesTheExistingRecipeRoute() async throws {
        let id = String(repeating: "a", count: 64)
        let transport = try settingsFixture("""
        {"version":1,"interactions":[{"method":"DELETE","path":"/api/recipes/\(id)","response":{"statusCode":204}}]}
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport))

        try await settings.deleteRoutine(id: id)

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), ["/api/recipes/\(id)"])
        await assertConsumed(transport)
    }

    func testSettingsSegmentsLoadTheirSyntheticOwnerSessionData() async throws {
        let routineID = String(repeating: "b", count: 64)
        let revision = String(repeating: "c", count: 64)
        let transport = try settingsFixture("""
        {
          "version": 1,
          "interactions": [
            {"method":"GET","path":"/api/models","response":{"statusCode":200,"body":{
              "source":"arm","deployments":[{"name":"fixture-deployment","model":"fixture-model","version":"v1","sku":"Standard","capacity":1,"capabilities":["chat"],"reasoningEfforts":["none"]}]
            }}},
            {"method":"GET","path":"/api/daily/training-targets","response":{"statusCode":200,"body":{
              "targets":{"gymSessionsPerWeek":null,"runSessionsPerWeek":null,"dailySteps":null},
              "bounds":{
                "gymSessionsPerWeek":{"label":"Synthetic gym","unit":"sessions","min":0,"max":7},
                "runSessionsPerWeek":{"label":"Synthetic run","unit":"sessions","min":0,"max":7},
                "dailySteps":{"label":"Synthetic steps","unit":"steps","min":0,"max":200000}
              },
              "missing":["gymSessionsPerWeek","runSessionsPerWeek","dailySteps"],"updatedAt":null
            }}},
            {"method":"GET","path":"/api/daily/nutrition-targets","response":{"statusCode":200,"body":{
              "targets":{"restingKcal":null,"deficitKcal":null,"proteinGrams":null},
              "bounds":{
                "restingKcal":{"label":"Synthetic resting","unit":"kcal","min":500,"max":5000},
                "deficitKcal":{"label":"Synthetic deficit","unit":"kcal","min":0,"max":1500},
                "proteinGrams":{"label":"Synthetic protein","unit":"g","min":0,"max":500}
              },
              "missing":["restingKcal","deficitKcal","proteinGrams"],"updatedAt":null
            }}},
            {"method":"GET","path":"/api/health/upload-credential","response":{"statusCode":200,"body":{"state":"empty","expiresAt":null}}},
            {"method":"GET","path":"/api/proactive/settings","response":{"statusCode":200,"body":{"paused":false,"revision":"\(revision)"}}},
            {"method":"GET","path":"/api/routines","response":{"statusCode":200,"body":{"routines":[{"id":"\(routineID)","kind":"task","key":"synthetic","goal":"Synthetic routine"}]}}},
            {"method":"GET","path":"/api/me","response":{"statusCode":200,"body":{"name":"Fixture Owner"}}}
          ]
        }
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport))

        let models = try await settings.loadModels()
        let training = try await settings.loadTrainingTargets()
        let nutrition = try await settings.loadNutritionTargets()
        let health = try await settings.loadHealthUploadCredential()
        let proactive = try await settings.loadProactiveSettings()
        let routines = try await settings.loadRoutines()
        let owner = try await settings.loadOwnerProfile()

        XCTAssertEqual(models.deployments.first?.name, "fixture-deployment")
        XCTAssertEqual(training.bounds["dailySteps"]?.max, 200_000)
        XCTAssertEqual(nutrition.bounds["proteinGrams"]?.max, 500)
        XCTAssertEqual(health.state, "empty")
        XCTAssertFalse(proactive.paused)
        XCTAssertEqual(routines.first?.id, routineID)
        XCTAssertEqual(owner.name, "Fixture Owner")

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), [
            "/api/models", "/api/daily/training-targets", "/api/daily/nutrition-targets",
            "/api/health/upload-credential", "/api/proactive/settings", "/api/routines", "/api/me",
        ])
        await assertConsumed(transport)
    }

    func testDeploymentChangesUseTheExistingApprovalRoutes() async throws {
        let body = #"{"model":"fixture-model","version":"v1","sku":"Standard","capacity":10}"#
        let transport = try settingsFixture("""
        {
          "version": 1,
          "interactions": [
            {"method":"POST","path":"/api/models/deployments","requestBody":\(body),"response":{"statusCode":202,"body":{"status":"approval_pending","name":"fixture-model"}}},
            {"method":"DELETE","path":"/api/models/deployments/fixture-model","response":{"statusCode":202,"body":{"status":"approval_pending","name":"fixture-model"}}}
          ]
        }
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport))

        let created = try await settings.requestDeployment(
            model: "fixture-model", version: "v1", sku: "Standard", capacity: 10
        )
        let removed = try await settings.removeDeployment(named: "fixture-model")

        XCTAssertEqual(created.status, "approval_pending")
        XCTAssertEqual(removed.status, "approval_pending")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), [
            "/api/models/deployments", "/api/models/deployments/fixture-model",
        ])
        await assertConsumed(transport)
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

        var roleDraft = JarvisSettingsEditState(original)
        roleDraft.set(.string("replacement-model"), path: ["roles", "chat", "model"])
        XCTAssertEqual(
            roleDraft.changes?.areas["roles"]?["chat"],
            .object(["model": .string("replacement-model")])
        )
        XCTAssertThrowsError(
            try JarvisSettingsLogic.validateSettingsPatch(
                JarvisSettingsPatch(area: "appearance", key: "theme", value: .string("unknown-theme"))
            )
        )
        XCTAssertNoThrow(
            try JarvisSettingsLogic.validateSettingsPatch(
                JarvisSettingsPatch(area: "appearance", key: "theme", value: .string("dark"))
            )
        )
    }

    func testSettingsValidationBoundsRowsAndErrorMapping() throws {
        let bound = JarvisTargetBound(label: "Synthetic target", unit: "items", min: 2, max: 8)
        XCTAssertTrue(JarvisSettingsLogic.validTarget(2, bound: bound))
        XCTAssertFalse(JarvisSettingsLogic.validTarget(9, bound: bound))
        XCTAssertTrue(JarvisSettingsLogic.validTarget(nil, bound: bound))
        XCTAssertTrue(JarvisSettingsLogic.validOption("system", options: ["light", "dark", "system"]))
        XCTAssertFalse(JarvisSettingsLogic.validOption("unknown", options: ["light", "dark", "system"]))
        XCTAssertNoThrow(try JarvisSettingsLogic.validateSettingsPatch(
            JarvisSettingsPatch(area: "codex", key: "reasoning", value: .string("default"))
        ))
        XCTAssertNoThrow(try JarvisSettingsLogic.validateSettingsPatch(
            JarvisSettingsPatch(area: "roles", key: "chat", value: .object([
                "reasoningEffort": .string("xhigh"),
            ]))
        ))
        XCTAssertNoThrow(try JarvisSettingsLogic.validateSettingsPatch(
            JarvisSettingsPatch(area: "newProjects", key: "owner", value: .string("fixture-owner"))
        ))
        XCTAssertThrowsError(try JarvisSettingsLogic.validateSettingsPatch(
            JarvisSettingsPatch(area: "newProjects", key: "owner", value: .string("invalid owner"))
        ))
        XCTAssertNoThrow(try JarvisSettingsLogic.validateSettingsPatch(
            JarvisSettingsPatch(area: "newProjects", key: "templatesRepository", value: .string("fixture-owner/project"))
        ))
        XCTAssertThrowsError(try JarvisSettingsLogic.validateSettingsPatch(
            JarvisSettingsPatch(area: "newProjects", key: "templatesRepository", value: .string(""))
        ))
        XCTAssertNoThrow(try JarvisSettingsLogic.validateSettingsPatch(
            JarvisSettingsPatch(area: "newProjects", key: "defaultBranch", value: .string("feature/settings"))
        ))
        XCTAssertThrowsError(try JarvisSettingsLogic.validateSettingsPatch(
            JarvisSettingsPatch(area: "newProjects", key: "defaultBranch", value: .string("feature//settings"))
        ))
        XCTAssertTrue(JarvisSettingsLogic.validMemoryPage(offset: 10_000, limit: 50))
        XCTAssertFalse(JarvisSettingsLogic.validMemoryPage(offset: 10_001, limit: 50))
        XCTAssertFalse(JarvisSettingsLogic.validMemoryPage(offset: 0, limit: 51))
        XCTAssertFalse(JarvisSettingsLogic.validDeploymentInput(model: " ", version: "v1", sku: "Standard", capacity: 1))
        XCTAssertFalse(JarvisSettingsLogic.validRoutineID("synthetic-routine"))
        XCTAssertTrue(JarvisSettingsLogic.validRoutineID(String(repeating: "a", count: 64)))
        XCTAssertEqual(JarvisSettingsLogic.numericBounds(area: "global", key: "maxCheckAttempts"), 0...10)

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

    func testSignOutAllDevicesUsesTheOwnerSessionRouteAndClearsTheToken() async throws {
        let tokenStore = SettingsTokenStore()
        let transport = try settingsFixture("""
        {"version":1,"interactions":[{"method":"DELETE","path":"/api/auth/sessions","response":{"statusCode":200,"body":{"revoked":2}}}]}
        """)
        let settings = JarvisSettingsClient(client: try makeClient(transport, tokenStore: tokenStore))

        try await settings.signOutAllDevices()

        let storedToken = try await tokenStore.read()
        let requests = await transport.recordedRequests()
        XCTAssertNil(storedToken)
        XCTAssertEqual(requests.map(\.path), ["/api/auth/sessions"])
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

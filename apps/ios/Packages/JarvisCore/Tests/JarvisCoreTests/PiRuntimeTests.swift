import Foundation
import XCTest
@testable import JarvisCore

final class PiRuntimeTests: XCTestCase {
    func testDeviceLocationPatchKeepsPermissionAndObservationFreshness() throws {
        let observed = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-19T05:00:00Z"))
        let patch = try XCTUnwrap(DeviceLocationSettings.patch(
            city: " Copenhagen ",
            latitude: 55.6761,
            longitude: 12.5683,
            observedAt: observed
        ))
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(patch)) as? [String: Any]
        )
        let location = try XCTUnwrap((object["settings"] as? [String: Any])?["location"] as? [String: Any])
        XCTAssertEqual(location["city"] as? String, "Copenhagen")
        XCTAssertEqual(location["permission"] as? String, "granted")
        XCTAssertEqual(location["observedAt"] as? String, "2026-11-19T05:00:00Z")
        XCTAssertEqual(location["latitude"] as? Double, 55.68)
        XCTAssertEqual(location["longitude"] as? Double, 12.57)
        XCTAssertNil(DeviceLocationSettings.permissionPatch("authorized_when_in_use"))
    }

    func testProactiveEditorPatchesTheCombinedBackgroundTurnAllowance() throws {
        let config = JarvisProactiveConfig(monthlyBudgetDkk: 100, backgroundTurnsPerDay: 12)
        var editor = JarvisProactiveSettingsEditor(settings: config)
        editor.draft.backgroundTurnsPerDay = 4
        let patch = try XCTUnwrap(editor.beginSave())
        XCTAssertEqual(patch.backgroundTurnsPerDay, 4)
        XCTAssertNil(patch.monthlyBudgetDkk)
        XCTAssertFalse(patch.isEmpty)
    }

    func testVoiceEndpointAlwaysUsesTheSinglePiRoute() throws {
        let base = try XCTUnwrap(URL(string: "https://example.invalid/api"))
        XCTAssertEqual(try VoiceEndpoint.url(baseURL: base).absoluteString, "wss://example.invalid/api/voice")
    }

    func testVoiceSessionConnectsOnlyToThePiRoute() async throws {
        let base = try XCTUnwrap(URL(string: "https://example.invalid/api"))
        let socket = VoiceRecordingSocket()
        try await VoiceSessionClient(baseURL: base, transport: socket).start(accessToken: "a.b.c")
        let urls = await socket.connectedURLs()
        XCTAssertEqual(urls.map(\.absoluteString), ["wss://example.invalid/api/voice"])
    }

    func testWarmThrottleAllowsOneAttemptPerInterval() {
        var throttle = PiWarmThrottle(interval: 300)
        let start = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(throttle.shouldWarm(now: start))
        XCTAssertFalse(throttle.shouldWarm(now: start.addingTimeInterval(299)))
        XCTAssertTrue(throttle.shouldWarm(now: start.addingTimeInterval(300)))
    }

    func testTurnBodyNeverCarriesAnEngineSelector() async throws {
        let transport = RecordingTransport([])
        let chat = JarvisChatClient(client: try makeClient(transport: transport))

        _ = try await chat.sendTurn(sessionId: "12", text: "Hello")

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
        let bodies = try requests.map {
            try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap($0.body)) as? [String: Any])
        }
        XCTAssertEqual(requests.map(\.url.path), ["/api/conversation/sessions/12/turns"])
        XCTAssertNil(bodies[0]["engine"])
        XCTAssertEqual(bodies[0]["text"] as? String, "Hello")
    }

    func testPiWarmPostsEmptyObjectAndSurfacesServerFailure() async throws {
        let transport = RecordingTransport([
            HTTPResponse(statusCode: 200, body: Data(#"{"state":"warm","alreadyWarm":false,"ms":1800}"#.utf8)),
            HTTPResponse(statusCode: 503, body: Data(#"{"error":"PI is not configured.","code":"pi_not_configured"}"#.utf8)),
        ])
        let chat = JarvisChatClient(client: try makeClient(transport: transport))

        let result = try await chat.piWarm()
        XCTAssertEqual(result, PiWarmResult(state: "warm", alreadyWarm: false, ms: 1800, skipped: nil))
        let skipped = try JSONDecoder().decode(
            PiWarmResult.self,
            from: Data(#"{"state":"cold","alreadyWarm":false,"ms":0,"skipped":"budget_exhausted"}"#.utf8)
        )
        XCTAssertEqual(skipped.skipped, "budget_exhausted")
        do {
            _ = try await chat.piWarm()
            XCTFail("Expected a PI failure")
        } catch {
            XCTAssertEqual(
                error as? JarvisChatClientError,
                .serverEvent(code: "pi_not_configured", message: "PI is not configured.")
            )
        }

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .post])
        XCTAssertEqual(requests.map(\.url.path), ["/api/pi/warm", "/api/pi/warm"])
        XCTAssertEqual(requests.first?.body, Data("{}".utf8))
    }

    func testPiBrainStatusDecodesAndTheSwitchIsAPutWithTheFlagOnly() async throws {
        let body = #"""
        {"available":true,"enabled":true,"updatedAt":"2026-11-16T10:00:00.000Z","paused":false,
         "budget":{"limitDkk":100,"spentDkk":82.5,"state":"warn"},
         "month":{"wakes":14,"costDkk":1.9},"today":{"messages":2,"usedTurns":3,"allowedTurns":12},
         "lastWake":{"at":"2026-11-16T10:00:00.000Z","totalMs":4100,"inputTokens":12000,"cachedTokens":9000,"outputTokens":300,"costDkk":0.09,"outcome":"ok"},
         "logPending":1,
         "slots":{"used":3,"allowed":12,"remaining":9,"lastAt":"2026-11-16T10:00:00.000Z","nextAllowedAt":null,"quiet":false,
                  "queue":{"pending":0,"leased":0,"retrying":0}},
         "situation":{"revision":2,"asOf":"2026-11-16T09:55:00.000Z","updatedAt":"2026-11-16T10:00:00.000Z",
                      "staleSources":[],"missingSources":["weather"],"disabledSources":[]},
         "cost":{"coldSweepMinDkk":0.14,"coldSweepMaxDkk":0.28,"representativeToolTurnDkk":0.17,"preflightWorstCaseDkk":0.79,
                 "estimatedDayMinDkk":1.68,"estimatedDayMaxDkk":3.36,"estimatedThirtyDayMinDkk":50.4,"estimatedThirtyDayMaxDkk":100}}
        """#
        let transport = RecordingTransport([
            HTTPResponse(statusCode: 200, body: Data(body.utf8)),
            HTTPResponse(statusCode: 200, body: Data(body.utf8)),
        ])
        let chat = JarvisChatClient(client: try makeClient(transport: transport))

        let status = try await chat.piBrainStatus()
        XCTAssertTrue(status.available)
        XCTAssertTrue(status.enabled)
        XCTAssertEqual(status.budget, PiBrainStatus.Budget(limitDkk: 100, spentDkk: 82.5, state: "warn"))
        XCTAssertEqual(status.month.wakes, 14)
        XCTAssertEqual(status.today.messages, 2)
        XCTAssertEqual(status.today.usedTurns, 3)
        XCTAssertEqual(status.slots.remaining, 9)
        XCTAssertEqual(status.situation.revision, 2)
        XCTAssertEqual(status.lastWake?.cachedTokens, 9000)
        XCTAssertEqual(status.logPending, 1)

        _ = try await chat.setPiBrain(enabled: false)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get, .put])
        XCTAssertEqual(requests.map(\.url.path), ["/api/pi/brain", "/api/pi/brain"])
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(requests[1].body)) as? [String: Any])
        XCTAssertEqual(sent["enabled"] as? Bool, false)
        XCTAssertEqual(sent.count, 1)
    }

    func testPiBrainStatusAndMemoryReadsRemainRetryableAfterUnavailableResponses() async throws {
        let brainBody = #"""
        {"available":true,"enabled":false,"updatedAt":null,"paused":false,
         "budget":{"limitDkk":100,"spentDkk":0,"state":"ok"},
         "month":{"wakes":0,"costDkk":0},"today":{"messages":0,"usedTurns":0,"allowedTurns":12},
         "lastWake":null,"logPending":0,
         "slots":{"used":0,"allowed":12,"remaining":12,"lastAt":null,"nextAllowedAt":null,"quiet":false,
                  "queue":{"pending":0,"leased":0,"retrying":0}},
         "situation":{"revision":0,"asOf":null,"updatedAt":null,
                      "staleSources":[],"missingSources":[],"disabledSources":[]},
         "cost":{"coldSweepMinDkk":0.14,"coldSweepMaxDkk":0.28,"representativeToolTurnDkk":0.17,"preflightWorstCaseDkk":0.79,
                 "estimatedDayMinDkk":1.68,"estimatedDayMaxDkk":3.36,"estimatedThirtyDayMinDkk":50.4,"estimatedThirtyDayMaxDkk":100}}
        """#
        let memoryBody = #"""
        {"items":[{"id":"1","type":"memory","title":"Fixture memory","folder":"General","content":"A retained memory"}],
         "count":1,"limit":50,"offset":0,"hasMore":false}
        """#
        let transport = RecordingTransport([
            HTTPResponse(statusCode: 503),
            HTTPResponse(statusCode: 200, body: Data(brainBody.utf8)),
            HTTPResponse(statusCode: 503),
            HTTPResponse(statusCode: 200, body: Data(memoryBody.utf8)),
        ])
        let client = try makeClient(
            transport: transport,
            retryPolicy: RetryPolicy(maximumRetries: 0)
        )
        let pi = JarvisChatClient(client: client)
        do {
            _ = try await pi.piBrainStatus()
            XCTFail("Expected the first PI read to fail")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .serviceUnavailable)
        }
        let brain = try await pi.piBrainStatus()
        XCTAssertFalse(brain.enabled)

        let settings = JarvisSettingsClient(client: client)
        do {
            _ = try await settings.loadMemory()
            XCTFail("Expected the first Memory read to fail")
        } catch {
            XCTAssertEqual(error as? JarvisSettingsClientError, .unavailable)
        }
        let memory = try await settings.loadMemory()
        XCTAssertEqual(memory.items.map(\.title), ["Fixture memory"])
    }

    func testPersonalMemoryReadsStayFreshAndAdvancePastExcludedEntries() async throws {
        let current = #"{"id":"7","type":"memory","content":"Current memory"}"#
        let vault = #"{"id":"9","type":"vault_note","content":"Vault only"}"#
        let written = #"{"id":"8","type":"memory","content":"Written by PI"}"#
        func page(_ item: String, offset: Int, hasMore: Bool) -> HTTPResponse {
            HTTPResponse(statusCode: 200, body: Data("""
            {"items":[\(item)],"count":1,"limit":1,"offset":\(offset),"hasMore":\(hasMore)}
            """.utf8))
        }
        let transport = RecordingTransport([
            page(vault, offset: 0, hasMore: true),
            page(current, offset: 1, hasMore: false),
            page(written, offset: 0, hasMore: true),
            HTTPResponse(statusCode: 200, body: Data(vault.utf8)),
            HTTPResponse(statusCode: 200, body: Data(written.utf8)),
            HTTPResponse(statusCode: 200),
            HTTPResponse(statusCode: 202),
        ])
        let client = JarvisSettingsClient(client: try makeClient(transport: transport))
        let first = try await client.loadMemory(query: "fixture", limit: 1)
        XCTAssertTrue(first.items.isEmpty)
        XCTAssertEqual(first.nextOffset, 1)
        let second = try await client.loadMemory(query: "fixture", offset: try XCTUnwrap(first.nextOffset), limit: 1)
        XCTAssertEqual(second.items.map(\.text), ["Current memory"])
        XCTAssertNil(second.nextOffset)
        let fresh = try await client.loadMemory(query: "fixture", limit: 1)
        XCTAssertEqual(fresh.items.map(\.text), ["Written by PI"])
        do {
            _ = try await client.readMemory(id: "9")
            XCTFail("Vault detail must not be shown in Memory")
        } catch {
            XCTAssertEqual(error as? JarvisSettingsClientError, .invalidResponse)
        }
        let detail = try await client.readMemory(id: "8")
        XCTAssertEqual(detail.text, "Written by PI")
        try await client.updateMemory(id: "8", text: "Corrected")
        let pending = try await client.deleteMemory(id: "8")
        XCTAssertTrue(pending)

        let requests = await transport.recordedRequests()
        let queries = requests.map { request in
            URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        }
        XCTAssertTrue(queries.allSatisfy { $0.contains(URLQueryItem(name: "scope", value: "personal")) })
        XCTAssertFalse(queries.joined().contains { $0.name == "folder" })
        XCTAssertEqual(queries.compactMap { $0.first { $0.name == "offset" }?.value }, ["0", "1", "0"])
        XCTAssertTrue(requests.filter { $0.method == .get }.allSatisfy { $0.headers["Cache-Control"] == "no-cache, no-store" })
    }

    private func makeClient(
        transport: RecordingTransport,
        retryPolicy: RetryPolicy = RetryPolicy()
    ) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: retryPolicy
            ),
            transport: transport,
            tokenStore: StaticTokenStore(),
            accessTokenProvider: StaticTokenProvider()
        )
    }
}

private actor VoiceRecordingSocket: WebSocketTransport {
    private var urls: [URL] = []

    func connect(url: URL, subprotocols: [String]) async throws { urls.append(url) }
    func send(text: String) async throws {}
    func receive() async -> AsyncThrowingStream<String, any Error> { AsyncThrowingStream { $0.finish() } }
    func close(code: UInt16) async {}

    func connectedURLs() -> [URL] { urls }
}

private actor RecordingTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private var requests: [HTTPRequest] = []

    init(_ responses: [HTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        return responses.isEmpty ? HTTPResponse(statusCode: 200) : responses.removeFirst()
    }

    func recordedRequests() -> [HTTPRequest] {
        requests
    }
}

private struct StaticTokenStore: TokenStore {
    func read() async throws -> String? { "session.fixture.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct StaticTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "entra.fixture.token" }
    func requestSignIn() async {}
}

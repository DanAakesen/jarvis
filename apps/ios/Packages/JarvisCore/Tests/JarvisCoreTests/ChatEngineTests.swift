import Foundation
import XCTest
@testable import JarvisCore

// TEST-ONLY chat engine switch: delete with the switch at cutover.
final class ChatEngineTests: XCTestCase {
    func testSelectionDefaultsToPiPersistsAndIgnoresUnknownValues() throws {
        let suite = "ChatEngineTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertEqual(ChatEngineSelection.load(from: defaults), .pi)
        ChatEngineSelection.save(.current, to: defaults)
        XCTAssertEqual(defaults.string(forKey: "jarvis.test.chatEngine"), "current")
        XCTAssertEqual(ChatEngineSelection.load(from: defaults), .current)
        defaults.set("something-else", forKey: ChatEngineSelection.key)
        XCTAssertEqual(ChatEngineSelection.load(from: defaults), .pi)
    }

    func testVoiceEndpointNamesTheEngineOnlyWhenOneIsChosen() throws {
        let base = try XCTUnwrap(URL(string: "https://example.invalid/api"))
        XCTAssertEqual(try VoiceEndpoint.url(baseURL: base).absoluteString, "wss://example.invalid/api/voice")
        XCTAssertEqual(try VoiceEndpoint.url(baseURL: base, engine: .current).absoluteString, "wss://example.invalid/api/voice?engine=current")
        XCTAssertEqual(try VoiceEndpoint.url(baseURL: base, engine: .pi).absoluteString, "wss://example.invalid/api/voice?engine=pi")
    }

    func testVoiceSessionConnectsWithTheChosenEngine() async throws {
        let base = try XCTUnwrap(URL(string: "https://example.invalid/api"))
        let current = VoiceRecordingSocket()
        try await VoiceSessionClient(baseURL: base, engine: .current, transport: current).start(accessToken: "a.b.c")
        let unnamed = VoiceRecordingSocket()
        try await VoiceSessionClient(baseURL: base, transport: unnamed).start(accessToken: "a.b.c")
        let currentURLs = await current.connectedURLs()
        let unnamedURLs = await unnamed.connectedURLs()
        XCTAssertEqual(currentURLs.map(\.absoluteString), ["wss://example.invalid/api/voice?engine=current"])
        XCTAssertEqual(unnamedURLs.map(\.absoluteString), ["wss://example.invalid/api/voice"])
    }

    func testWarmThrottleAllowsOneAttemptPerInterval() {
        var throttle = PiWarmThrottle(interval: 300)
        let start = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(throttle.shouldWarm(now: start))
        XCTAssertFalse(throttle.shouldWarm(now: start.addingTimeInterval(299)))
        XCTAssertTrue(throttle.shouldWarm(now: start.addingTimeInterval(300)))
    }

    func testTurnBodyNamesTheEngineOnlyWhenOneIsChosen() async throws {
        let transport = RecordingTransport([])
        let chat = JarvisChatClient(client: try makeClient(transport: transport))

        _ = try await chat.sendTurn(sessionId: "12", text: "Hello")
        _ = try await chat.sendTurn(sessionId: "12", text: "Hello", engine: .current)
        _ = try await chat.sendTurn(sessionId: "12", text: "Hello", engine: .pi)

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 3)
        let bodies = try requests.map {
            try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap($0.body)) as? [String: Any])
        }
        XCTAssertEqual(requests.map(\.url.path), Array(repeating: "/api/conversation/sessions/12/turns", count: 3))
        XCTAssertNil(bodies[0]["engine"])
        XCTAssertEqual(bodies[1]["engine"] as? String, "current")
        XCTAssertEqual(bodies[2]["engine"] as? String, "pi")
        XCTAssertEqual(bodies[2]["text"] as? String, "Hello")
    }

    func testPiStatusDecodesFullAndMinimalPayloads() throws {
        let full = Data(#"""
        {"enabled":true,"reason":null,
         "agent":{"name":"Jarvis PI","model":"gpt-test","effort":"medium"},
         "month":{"spentDkk":1.25,"capDkk":100,"remainingDkk":98.75,"turns":7},
         "warm":{"state":"warm","warmedAt":"2026-11-15T10:00:00.000Z"},
         "lastTurn":{"at":"2026-11-15T10:01:00.000Z","firstTextMs":900,"totalMs":4200,
                     "inputTokens":1200,"cachedTokens":900,"outputTokens":150,"costDkk":0.08}}
        """#.utf8)
        let status = try JSONDecoder().decode(PiStatus.self, from: full)
        XCTAssertTrue(status.enabled)
        XCTAssertNil(status.reason)
        XCTAssertEqual(status.agent.name, "Jarvis PI")
        XCTAssertEqual(status.month.capDkk, 100)
        XCTAssertEqual(status.month.remaining, 98.75)
        XCTAssertTrue(status.warm.isWarm)
        XCTAssertEqual(status.lastTurn?.cachedTokens, 900)
        XCTAssertEqual(status.lastTurn?.firstTextMs, 900)

        let minimal = Data(#"""
        {"enabled":false,"reason":"budget_exhausted",
         "agent":{"name":null,"model":"gpt-test","effort":"low"},
         "month":{"spentDkk":100,"capDkk":100,"turns":40},
         "warm":{"state":"cold","warmedAt":null},"lastTurn":null}
        """#.utf8)
        let exhausted = try JSONDecoder().decode(PiStatus.self, from: minimal)
        XCTAssertFalse(exhausted.enabled)
        XCTAssertEqual(exhausted.month.remaining, 0)
        XCTAssertEqual(exhausted.reason, "budget_exhausted")
        XCTAssertFalse(exhausted.warm.isWarm)
        XCTAssertNil(exhausted.lastTurn)
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
         "month":{"wakes":14,"costDkk":1.9},"today":{"messages":2},
         "lastWake":{"at":"2026-11-16T10:00:00.000Z","totalMs":4100,"inputTokens":12000,"cachedTokens":9000,"outputTokens":300,"costDkk":0.09,"outcome":"ok"},
         "logPending":1}
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

    private func makeClient(transport: RecordingTransport) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: URL(string: "https://api.example.invalid/api")!),
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

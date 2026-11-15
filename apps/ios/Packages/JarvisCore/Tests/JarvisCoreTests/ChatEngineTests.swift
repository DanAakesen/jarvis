import Foundation
import XCTest
@testable import JarvisCore

// TEST-ONLY chat engine switch: delete with the switch at cutover.
final class ChatEngineTests: XCTestCase {
    func testSelectionDefaultsToCurrentPersistsAndIgnoresUnknownValues() throws {
        let suite = "ChatEngineTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertEqual(ChatEngineSelection.load(from: defaults), .current)
        ChatEngineSelection.save(.pi, to: defaults)
        XCTAssertEqual(defaults.string(forKey: "jarvis.test.chatEngine"), "pi")
        XCTAssertEqual(ChatEngineSelection.load(from: defaults), .pi)
        defaults.set("something-else", forKey: ChatEngineSelection.key)
        XCTAssertEqual(ChatEngineSelection.load(from: defaults), .current)
    }

    func testWarmThrottleAllowsOneAttemptPerInterval() {
        var throttle = PiWarmThrottle(interval: 300)
        let start = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(throttle.shouldWarm(now: start))
        XCTAssertFalse(throttle.shouldWarm(now: start.addingTimeInterval(299)))
        XCTAssertTrue(throttle.shouldWarm(now: start.addingTimeInterval(300)))
    }

    func testTurnBodyCarriesEngineOnlyForPi() async throws {
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
        XCTAssertNil(bodies[1]["engine"])
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

    private func makeClient(transport: RecordingTransport) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: URL(string: "https://api.example.invalid/api")!),
            transport: transport,
            tokenStore: StaticTokenStore(),
            accessTokenProvider: StaticTokenProvider()
        )
    }
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

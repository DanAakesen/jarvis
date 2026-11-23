import Foundation
import XCTest
@testable import JarvisCore

final class ChatStreamLimitTests: XCTestCase {
    func testASavedReplyIsNotFailedBecauseItsDoneFrameTakesTheStreamPastOneMebibyte() async throws {
        // The server stops progress frames at 1 MiB but always sends `done`, so this is a stream it accepted and saved.
        let text = String(repeating: "a", count: 600_000)
        let body = frame("user", message(id: "430", role: "dan", text: "Hi"))
            + frame("delta", #"{"text":"\#(text)"}"#)
            + frame("done", message(id: "431", role: "jarvis", text: text))

        let events = try await receive(Data(body.utf8))

        let saved = events.compactMap { event -> ChatMessage? in
            if case .done(let message) = event { return message }
            return nil
        }
        XCTAssertEqual(saved.first?.text.count, text.count)
    }

    func testAStreamFarPastWhatTheServerEverSendsIsStillRefused() async throws {
        let delta = frame("delta", #"{"text":"\#(String(repeating: "a", count: 900_000))"}"#)
        let body = frame("user", message(id: "430", role: "dan", text: "Hi")) + String(repeating: delta, count: 5)

        do {
            _ = try await receive(Data(body.utf8))
            XCTFail("Expected the stream to be refused")
        } catch {
            XCTAssertEqual(error as? JarvisChatClientError, .responseTooLarge)
        }
    }

    func testAReplacedAttemptCanStillDeliverTheFollowUpReply() async throws {
        let body = frame("user", message(id: "430", role: "dan", text: "Hi"))
            + frame("superseded", #"{"messageId":"430"}"#)
            + frame("done", message(id: "432", role: "jarvis", text: "Follow-up answer"))
            + frame("error", #"{"error":"A late error is not the reply's outcome."}"#)

        let events = try await receive(Data(body.utf8))

        XCTAssertEqual(events.count, 3)
        XCTAssertTrue(events.contains(.superseded(messageID: "430")))
        guard case .done(let reply) = events.last else { return XCTFail("Expected a saved reply") }
        XCTAssertEqual(reply.text, "Follow-up answer")
    }

    func testReturningToChatDiscoversAndReplaysTheAcceptedReplyWithoutResubmitting() async throws {
        let request = frame("user", message(id: "430", role: "dan", text: "Hi"))
        let reply = frame("done", message(id: "431", role: "jarvis", text: "Hello"))
        let transport = ResumeTransport(replay: Data((request + reply).utf8))
        let client = try JarvisChatClient(client: JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: URL(string: "https://api.example.invalid/api")!),
            transport: transport,
            tokenStore: FixtureTokenStore(),
            accessTokenProvider: FixtureTokenProvider()
        ))
        let active = try await client.listActiveTurns()
        let turn = try XCTUnwrap(ActiveChatTurnSelection.select(turns: active, forSessionID: "12"))
        var replyIDs: [String] = []
        for try await event in try await client.reattachTurn(sessionId: turn.sessionId, messageId: turn.messageId) {
            if case .done(let saved) = event { replyIDs.append(saved.id) }
        }
        XCTAssertEqual(replyIDs, ["431"])
        let calls = await transport.calls
        XCTAssertEqual(calls, ["GET /api/conversation/turns/active", "GET /api/conversation/sessions/12/turns/430/events"])
    }

    private func receive(_ body: Data) async throws -> [ChatEvent] {
        let client = try JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: URL(string: "https://api.example.invalid/api")!),
            transport: OneResponseTransport(body),
            tokenStore: FixtureTokenStore(),
            accessTokenProvider: FixtureTokenProvider()
        )
        var events: [ChatEvent] = []
        for try await event in try await JarvisChatClient(client: client).sendTurn(sessionId: "12", text: "Hi") {
            events.append(event)
        }
        return events
    }

    private func frame(_ name: String, _ data: String) -> String {
        "event: \(name)\ndata: \(data)\n\n"
    }

    private func message(id: String, role: String, text: String) -> String {
        #"{"id":"\#(id)","sessionId":"12","role":"\#(role)","text":"\#(text)","model":null,"at":"2026-11-22T09:00:00Z"}"#
    }
}

/// Answers every request with the same stream body, delivered as one chunk by the default `stream` implementation.
private actor OneResponseTransport: HTTPTransport {
    private let body: Data

    init(_ body: Data) {
        self.body = body
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        HTTPResponse(statusCode: 200, body: body)
    }
}

private actor ResumeTransport: HTTPTransport {
    let replay: Data
    private(set) var calls: [String] = []

    init(replay: Data) { self.replay = replay }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        calls.append("\(request.method.rawValue) \(request.url.path)")
        if request.url.path.hasSuffix("/active") {
            // Existing backends send just the two identifiers.
            return HTTPResponse(statusCode: 200, body: Data(#"{"turns":[{"sessionId":"12","messageId":"430"}]}"#.utf8))
        }
        return HTTPResponse(statusCode: 200, body: replay)
    }
}

private struct FixtureTokenStore: TokenStore {
    func read() async throws -> String? { "session.fixture.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct FixtureTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "entra.fixture.token" }
    func requestSignIn() async {}
}

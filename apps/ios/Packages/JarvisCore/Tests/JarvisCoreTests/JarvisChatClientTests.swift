import Foundation
import XCTest
@testable import JarvisCore

final class JarvisChatClientTests: XCTestCase {
    func testCreatesSessionAndStreamsACompleteTurn() async throws {
        let transport = FakeChatTransport([
            .response(jsonResponse(status: 201, body: [
                "id": "12", "channel": "chat", "language": "da",
            ])),
            .stream(streamResponse(events: [
                event("user", ["id": "42", "sessionId": "12", "role": "dan", "text": "Hi", "model": NSNull(), "at": "2026-10-30T00:00:00.000Z"]),
                event("delta", ["text": "Hello"]),
                "event: future\ndata: retained\n\n",
                event("done", ["id": "43", "sessionId": "12", "role": "jarvis", "text": "Hello", "model": "fixture", "at": "2026-10-30T00:00:01.000Z"]),
            ].joined())),
        ])
        let chat = makeChatClient(transport: transport)

        let session = try await chat.createSession(language: .da)
        let events = try await chat.sendTurn(sessionId: session.id, text: "Hi")
        let received = try await collect(events)

        XCTAssertEqual(session, ChatSession(id: "12", channel: .chat, language: .da))
        XCTAssertEqual(received.count, 4)
        XCTAssertEqual(received[0], .user(ChatMessage(
            id: "42", sessionId: "12", role: .dan, text: "Hi", model: nil, at: "2026-10-30T00:00:00.000Z"
        )))
        XCTAssertEqual(received[1], .delta(text: "Hello"))
        XCTAssertEqual(received[2], .unknown(name: "future", data: "retained"))
        XCTAssertEqual(received[3], .done(ChatMessage(
            id: "43", sessionId: "12", role: .jarvis, text: "Hello", model: "fixture", at: "2026-10-30T00:00:01.000Z"
        )))

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .post])
        XCTAssertEqual(requests.map(\.url.path), [
            "/api/conversation/sessions",
            "/api/conversation/sessions/12/turns",
        ])
        XCTAssertEqual(requests.map { $0.headers["Authorization"] }, [
            authorization("session.fixture.token"),
            authorization("session.fixture.token"),
        ])
        XCTAssertEqual(requests[1].headers["Accept"], "text/event-stream")
        let sessionBody = try JSONSerialization.jsonObject(with: requests[0].body!) as? [String: String]
        XCTAssertEqual(sessionBody, [
            "channel": "chat",
            "language": "da",
        ])
    }

    func testServerErrorEventThrowsTypedChatFailure() async throws {
        let transport = FakeChatTransport([
            .stream(streamResponse(events: event("error", ["error": "Synthetic failure", "code": "fixture_failure"]))),
        ])
        let chat = makeChatClient(transport: transport)
        let events = try await chat.sendTurn(sessionId: "12", text: "Hi")

        do {
            _ = try await collect(events)
            XCTFail("Expected typed stream error")
        } catch {
            XCTAssertEqual(
                error as? JarvisChatClientError,
                .serverEvent(code: "fixture_failure", message: "Synthetic failure")
            )
        }
    }

    func testRejectsInvalidTurnInputWithoutSending() async throws {
        let transport = FakeChatTransport([])
        let chat = makeChatClient(transport: transport)
        let attachments = Array(repeating: "123e4567-e89b-42d3-a456-426614174000", count: 6)

        do {
            _ = try await chat.sendTurn(sessionId: "12", text: "")
            XCTFail("Expected empty-text validation")
        } catch {
            XCTAssertEqual(error as? JarvisChatClientError, .invalidTextLength)
        }
        do {
            _ = try await chat.sendTurn(sessionId: "12", text: String(repeating: "x", count: 20_001))
            XCTFail("Expected maximum-text validation")
        } catch {
            XCTAssertEqual(error as? JarvisChatClientError, .invalidTextLength)
        }
        do {
            _ = try await chat.sendTurn(sessionId: "12", text: "Hi", attachmentIds: attachments)
            XCTFail("Expected attachment-count validation")
        } catch {
            XCTAssertEqual(error as? JarvisChatClientError, .tooManyAttachments)
        }
        do {
            _ = try await chat.sendTurn(sessionId: "12", text: "Hi", attachmentIds: ["not-a-uuid"])
            XCTFail("Expected attachment-id validation")
        } catch {
            XCTAssertEqual(error as? JarvisChatClientError, .invalidAttachmentIDs)
        }
        let requests = await transport.recordedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testListsActiveTurnsAndHistoryToolCalls() async throws {
        let transport = FakeChatTransport([
            .response(jsonResponse(status: 200, body: ["turns": [
                ["sessionId": "12", "messageId": "42", "language": "en"],
            ]])),
            .response(jsonResponse(status: 200, body: [
                "messages": [[
                    "id": "43", "sessionId": "12", "channel": "chat", "language": "en",
                    "role": "jarvis", "text": "Done", "model": NSNull(), "interrupted": false,
                    "voiceMinutes": NSNull(), "at": "2026-10-30T00:00:01.000Z",
                    "toolCalls": [[
                        "id": "call-1", "tool": "read_fixture", "outcome": "ok",
                        "taskId": NSNull(), "artifactId": NSNull(),
                    ]],
                    "attachments": [],
                ]],
                "nextCursor": "43",
            ])),
        ])
        let chat = makeChatClient(transport: transport)

        let turns = try await chat.listActiveTurns()
        let page = try await chat.history(limit: 20, before: "55", sessionId: "12")

        XCTAssertEqual(turns, [ActiveChatTurn(sessionId: "12", messageId: "42", language: .en)])
        XCTAssertEqual(page.nextCursor, "43")
        XCTAssertEqual(page.messages.first?.toolCalls.first?.tool, "read_fixture")
        XCTAssertEqual(page.messages.first?.toolCalls.first?.outcome, .ok)
        XCTAssertEqual(page.messages.first?.toolCalls.first?.taskId, nil)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests[0].url.path, "/api/conversation/turns/active")
        XCTAssertEqual(requests[1].url.path, "/api/conversation/history")
        let query = URLComponents(url: requests[1].url, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query?.first { $0.name == "limit" }?.value, "20")
        XCTAssertEqual(query?.first { $0.name == "before" }?.value, "55")
        XCTAssertEqual(query?.first { $0.name == "sessionId" }?.value, "12")
    }

    func testReattachRetriesTransientFailuresAndStopsAtPolicyDeadline() async throws {
        let ready = streamResponse(events: event("done", [
            "id": "43", "sessionId": "12", "role": "jarvis", "text": "Done",
            "model": NSNull(), "at": "2026-10-30T00:00:01.000Z",
        ]))
        let retryTransport = FakeChatTransport([
            .streamFailure(.network),
            .streamFailure(.network),
            .stream(ready),
        ])
        let retryClock = FakeChatClock()
        let retrying = makeChatClient(
            transport: retryTransport,
            reattachPolicy: ReattachPolicy(maximumDuration: .seconds(10)),
            clock: retryClock
        )
        let events = try await retrying.reattachTurn(sessionId: "12", messageId: "42")
        let retriedEvents = try await collect(events)
        XCTAssertEqual(retriedEvents.last, .done(ChatMessage(
            id: "43", sessionId: "12", role: .jarvis, text: "Done", model: nil, at: "2026-10-30T00:00:01.000Z"
        )))
        let retryRequests = await retryTransport.recordedRequests()
        let retrySleeps = await retryClock.sleeps()
        XCTAssertEqual(retryRequests.count, 3)
        XCTAssertEqual(retrySleeps, [.seconds(2), .seconds(2)])

        let timeoutTransport = FakeChatTransport(Array(repeating: .streamFailure(.network), count: 4))
        let timeoutClock = FakeChatClock()
        let timingOut = makeChatClient(
            transport: timeoutTransport,
            reattachPolicy: ReattachPolicy(maximumDuration: .seconds(5)),
            clock: timeoutClock
        )
        do {
            _ = try await timingOut.reattachTurn(sessionId: "12", messageId: "42")
            XCTFail("Expected reattach deadline")
        } catch {
            XCTAssertEqual(error as? JarvisChatClientError, .reattachTimedOut)
        }
        let timeoutRequests = await timeoutTransport.recordedRequests()
        let timeoutSleeps = await timeoutClock.sleeps()
        XCTAssertEqual(timeoutRequests.count, 3)
        XCTAssertEqual(timeoutSleeps, [.seconds(2), .seconds(2), .seconds(1)])
    }

    func testReattachAndCancelTreatMissingTurnAsGone() async throws {
        let transport = FakeChatTransport([
            .stream(HTTPStreamResponse(
                statusCode: 404,
                body: AsyncThrowingStream { $0.finish() }
            )),
            .response(HTTPResponse(statusCode: 404)),
            .response(jsonResponse(status: 200, body: ["cancelled": true])),
        ])
        let chat = makeChatClient(transport: transport)

        do {
            _ = try await chat.reattachTurn(sessionId: "12", messageId: "42")
            XCTFail("Expected unknown turn")
        } catch {
            XCTAssertEqual(error as? JarvisChatClientError, .turnNotFound)
        }
        let cancelled = try await chat.cancelTurn(sessionId: "12", messageId: "42")
        XCTAssertFalse(cancelled)
        let cancelledActiveTurn = try await chat.cancelTurn(sessionId: "12", messageId: "42")
        XCTAssertTrue(cancelledActiveTurn)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.url.path), [
            "/api/conversation/sessions/12/turns/42/events",
            "/api/conversation/sessions/12/turns/42/cancel",
            "/api/conversation/sessions/12/turns/42/cancel",
        ])
    }

    func testUploadsOneMultipartAttachmentWithinSizeLimit() async throws {
        let transport = FakeChatTransport([
            .response(jsonResponse(status: 201, body: [
                "id": "123e4567-e89b-42d3-a456-426614174000",
                "name": "sample.txt", "contentType": "text/plain", "size": 5, "status": "ready",
            ])),
        ])
        let chat = makeChatClient(transport: transport)

        let descriptor = try await chat.uploadAttachment(ChatAttachmentUpload(
            fileName: "sample\".txt",
            contentType: "text/plain",
            data: Data("hello".utf8)
        ))

        XCTAssertEqual(descriptor.status, .ready)
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/api/conversation/attachments")
        XCTAssertTrue(request.headers["Content-Type"]?.hasPrefix("multipart/form-data; boundary=") == true)
        XCTAssertTrue(String(decoding: request.body!, as: UTF8.self).contains("filename=\"sample\\\".txt\""))
        XCTAssertTrue(String(decoding: request.body!, as: UTF8.self).contains("\r\n\r\nhello\r\n"))
    }

    func testCancellationOfConsumerCancelsUnderlyingTransportStream() async throws {
        let probe = StreamTerminationProbe()
        let source = AsyncThrowingStream<Data, any Error> { continuation in
            continuation.yield(Data("event: delta\ndata: {\"text\":\"hello\"}\n\n".utf8))
            continuation.onTermination = { _ in
                Task { await probe.sourceTerminated() }
            }
        }
        let transport = FakeChatTransport([
            .stream(HTTPStreamResponse(statusCode: 200, body: source)),
        ])
        let chat = makeChatClient(transport: transport)
        let events = try await chat.sendTurn(sessionId: "12", text: "Hi")
        let consumer = Task {
            for try await event in events {
                if case .delta = event { await probe.receivedEvent() }
            }
        }

        await probe.waitForEvent()
        consumer.cancel()
        await probe.waitForSourceTermination()
        _ = try? await consumer.value
    }

    private func makeChatClient(
        transport: FakeChatTransport,
        reattachPolicy: ReattachPolicy = ReattachPolicy(),
        clock: any ChatClock = ContinuousChatClock()
    ) -> JarvisChatClient {
        let client = try! JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0, delay: .zero, maximumDelay: .zero)
            ),
            transport: transport,
            tokenStore: FakeChatTokenStore(),
            accessTokenProvider: FakeChatTokenProvider()
        )
        return JarvisChatClient(client: client, reattachPolicy: reattachPolicy, clock: clock)
    }

    private func collect(_ stream: AsyncThrowingStream<ChatEvent, any Error>) async throws -> [ChatEvent] {
        var events: [ChatEvent] = []
        for try await event in stream { events.append(event) }
        return events
    }

    private func event(_ name: String, _ body: [String: Any]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed])
        return "event: \(name)\ndata: \(String(decoding: data, as: UTF8.self))\n\n"
    }

    private func streamResponse(events: String) -> HTTPStreamResponse {
        let bytes = Data(events.utf8)
        let body = AsyncThrowingStream<Data, any Error> { continuation in
            for index in stride(from: 0, to: bytes.count, by: 3) {
                continuation.yield(bytes.subdata(in: index..<min(index + 3, bytes.count)))
            }
            continuation.finish()
        }
        return HTTPStreamResponse(statusCode: 200, body: body)
    }

    private func jsonResponse(status: Int, body: Any) -> HTTPResponse {
        HTTPResponse(
            statusCode: status,
            body: try! JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed])
        )
    }

    private func authorization(_ token: String) -> String {
        ["Bear", "er"].joined() + " " + token
    }
}

private actor FakeChatTransport: HTTPTransport {
    enum Stub: Sendable {
        case response(HTTPResponse)
        case stream(HTTPStreamResponse)
        case failure(HTTPTransportFailure)
        case streamFailure(HTTPTransportFailure)
    }

    private var stubs: [Stub]
    private var requests: [HTTPRequest] = []

    init(_ stubs: [Stub]) {
        self.stubs = stubs
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        guard !stubs.isEmpty else { throw HTTPTransportFailure.network }
        switch stubs.removeFirst() {
        case .response(let response):
            return response
        case .stream(let response):
            return HTTPResponse(statusCode: response.statusCode)
        case .failure(let failure), .streamFailure(let failure):
            throw failure
        }
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        requests.append(request)
        guard !stubs.isEmpty else { throw HTTPTransportFailure.network }
        switch stubs.removeFirst() {
        case .stream(let response):
            return response
        case .response(let response):
            let body = AsyncThrowingStream<Data, any Error> { continuation in
                if !response.body.isEmpty { continuation.yield(response.body) }
                continuation.finish()
            }
            return HTTPStreamResponse(statusCode: response.statusCode, headers: response.headers, body: body)
        case .failure(let failure), .streamFailure(let failure):
            throw failure
        }
    }

    func recordedRequests() -> [HTTPRequest] {
        requests
    }
}

private actor FakeChatTokenStore: TokenStore {
    func read() async throws -> String? { "session.fixture.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor FakeChatTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "entra.fixture.token" }
    func requestSignIn() async {}
}

private actor FakeChatClock: ChatClock {
    private var currentTime: Duration = .zero
    private var recordedSleeps: [Duration] = []

    func now() async -> Duration { currentTime }

    func sleep(for duration: Duration) async throws {
        try Task.checkCancellation()
        recordedSleeps.append(duration)
        currentTime += duration
    }

    func sleeps() -> [Duration] { recordedSleeps }
}

private actor StreamTerminationProbe {
    private var hasReceivedEvent = false
    private var hasTerminated = false
    private var eventWaiters: [CheckedContinuation<Void, Never>] = []
    private var terminationWaiters: [CheckedContinuation<Void, Never>] = []

    func receivedEvent() {
        hasReceivedEvent = true
        eventWaiters.forEach { $0.resume() }
        eventWaiters.removeAll()
    }

    func sourceTerminated() {
        hasTerminated = true
        terminationWaiters.forEach { $0.resume() }
        terminationWaiters.removeAll()
    }

    func waitForEvent() async {
        if hasReceivedEvent { return }
        await withCheckedContinuation { eventWaiters.append($0) }
    }

    func waitForSourceTermination() async {
        if hasTerminated { return }
        await withCheckedContinuation { terminationWaiters.append($0) }
    }
}

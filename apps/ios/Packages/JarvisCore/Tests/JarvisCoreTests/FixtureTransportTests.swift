import Foundation
import XCTest
@testable import JarvisCore

final class FixtureTransportTests: XCTestCase {
    func testShortChatThroughRealClientWithDeterministicChunkDelays() async throws {
        let clock = AdvancingFixtureClock()
        let transport = try fixture("short-chat", clock: clock)
        let chat = JarvisChatClient(client: try client(transport), clock: clock)
        let session = try await chat.createSession(language: .en)
        let events = try await collect(chat.sendTurn(sessionId: session.id, text: "Hello fixture"))

        XCTAssertEqual(session.id, "12")
        XCTAssertEqual(events.count, 5)
        XCTAssertEqual(Array(events[1...3]), [
            .delta(text: "Hello"), .delta(text: " from"), .delta(text: " fixtures"),
        ])
        guard case .done(let message) = events.last else { return XCTFail("Missing done") }
        XCTAssertEqual(message.text, "Hello from fixtures")
        let sleeps = await clock.sleeps()
        XCTAssertEqual(sleeps, [.milliseconds(10), .milliseconds(20), .milliseconds(30)])
        await assertConsumed(transport)
    }

    func testErrorTurnThroughRealChatClient() async throws {
        let transport = try fixture("error-turn")
        let chat = JarvisChatClient(client: try client(transport))
        do {
            _ = try await collect(chat.sendTurn(sessionId: "12", text: "Hello fixture"))
            XCTFail("Expected server error")
        } catch {
            XCTAssertEqual(error as? JarvisChatClientError, .serverEvent(
                code: "fixture_failure", message: "Synthetic turn failure"
            ))
        }
        await assertConsumed(transport)
    }

    func testDroppedStreamReattachesThroughRealChatClientWithoutDuplicateDeltas() async throws {
        let clock = AdvancingFixtureClock()
        let transport = try fixture("dropped-stream", clock: clock)
        let chat = JarvisChatClient(client: try client(transport), clock: clock)
        let events = try await collect(chat.sendTurn(sessionId: "12", text: "Hello fixture"))
        XCTAssertEqual(events.count, 4)
        XCTAssertEqual(Array(events[1...2]), [.delta(text: "Recovered"), .delta(text: " safely")])
        guard case .done(let message) = events.last else { return XCTFail("Missing recovered done") }
        XCTAssertEqual(message.text, "Recovered safely")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .get])
        XCTAssertEqual(requests.last?.path, "/api/conversation/sessions/12/turns/42/events")
        let sleeps = await clock.sleeps()
        XCTAssertEqual(sleeps, [.seconds(2)])
        await assertConsumed(transport)
    }

    func testEmptyAndCursorHistoryThroughRealChatClient() async throws {
        let transport = try fixture("history")
        let chat = JarvisChatClient(client: try client(transport))
        let empty = try await chat.history(limit: 20)
        XCTAssertTrue(empty.messages.isEmpty)
        XCTAssertNil(empty.nextCursor)
        let first = try await chat.history(limit: 1, sessionId: "12")
        XCTAssertEqual(first.messages.map(\.id), ["43"])
        XCTAssertEqual(first.messages.first?.toolCalls.first?.tool, "get_system_health")
        let next = try await chat.history(limit: 1, before: first.nextCursor, sessionId: "12")
        XCTAssertEqual(next.messages.map(\.id), ["42"])
        XCTAssertNil(next.nextCursor)
        await assertConsumed(transport)
    }

    func testPendingConfirmationApprovedThroughRealApprovalsClient() async throws {
        let transport = try fixture("approval")
        let approvals = JarvisApprovalsClient(client: try client(transport))
        let pending = try await approvals.pendingConfirmations()
        XCTAssertFalse(pending.awayMode)
        let confirmation = try XCTUnwrap(pending.confirmations.first)
        XCTAssertEqual(confirmation.actionKind, .other)
        XCTAssertEqual(confirmation.summary, "Approve the synthetic no-op")
        try await approvals.resolveConfirmation(id: confirmation.id, decision: .approve)
        let resolved = try await approvals.pendingConfirmations()
        XCTAssertTrue(resolved.confirmations.isEmpty)
        await assertConsumed(transport)
    }

    func testToolsListAndRunThroughRealHTTPClient() async throws {
        let transport = try fixture("tools")
        let http = try client(transport)
        let tools = try await http.listTools()
        XCTAssertEqual(tools.map(\.name), ["get_system_health"])
        let result = try await http.runTool(
            tools[0].name, arguments: ["operation": "confirmation_test"], as: FixtureToolResult.self
        )
        XCTAssertEqual(result.outcome, .ok)
        XCTAssertTrue(result.result.executed)
        XCTAssertEqual(result.confirmation, "Synthetic no-op completed.")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), ["/api/tools", "/api/tools/get_system_health"])
        // The public log deliberately has no URL origin, body or headers to leak credentials.
        XCTAssertEqual(Mirror(reflecting: requests[0]).children.compactMap(\.label), ["method", "path", "query"])
        await assertConsumed(transport)
    }

    func test401ClearsSessionAnd429RetryAfterAnd503MapThroughRealHTTPClient() async throws {
        let transport = try fixture("http-errors")
        let store = FixtureTokenStore()
        let provider = FixtureTokenProvider()
        let http = try client(transport, store: store, provider: provider)
        let expected: [JarvisClientError] = [
            .signInRequired, .rateLimited(retryAfter: .seconds(7)), .serviceUnavailable,
        ]
        for error in expected {
            do {
                _ = try await http.listTools()
                XCTFail("Expected HTTP failure")
            } catch let actual as JarvisClientError {
                XCTAssertEqual(actual, error)
            }
        }
        let deleted = await store.wasDeleted()
        let signIns = await provider.signIns()
        XCTAssertTrue(deleted)
        XCTAssertEqual(signIns, 1)
        await assertConsumed(transport)
    }

    func testIdempotentRetriesConsumeFixtureResponsesButToolWritesDoNotRetry() async throws {
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"GET","path":"/api/tools","response":{"statusCode":503}},
          {"method":"GET","path":"/api/tools","response":{"statusCode":429,"headers":{"Retry-After":"0"}}},
          {"method":"GET","path":"/api/tools","response":{"statusCode":200,"body":[]}},
          {"method":"POST","path":"/api/tools/get_system_health","response":{"statusCode":503}}
        ]}
        """)
        let http = try client(transport, retries: 2)
        let tools = try await http.listTools()
        XCTAssertTrue(tools.isEmpty)
        do {
            let _: ToolCallResponse<FixtureToolResult> = try await http.runTool(
                "get_system_health", arguments: ["operation": "confirmation_test"]
            )
            XCTFail("Expected failure without retrying the write")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .serviceUnavailable)
        }
        await assertConsumed(transport)
    }

    func testExactMethodPathQueryMatchingAndExhaustion() async throws {
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"GET","path":"/api/history","query":{"before":"43","limit":"1"},"response":{"statusCode":200}}
        ]}
        """)
        for request in [
            request("/api/history?before=43&limit=1", method: .post),
            request("/api/other?before=43&limit=1"),
            request("/api/history?limit=1"),
            request("/api/history?before=44&limit=1"),
            request("/api/history?before=43&limit=1&extra=yes"),
            request("/api/history?before=43&limit=1&limit=1"),
            request("/api/history?before&limit=1"),
        ] {
            do {
                _ = try await transport.send(request)
                XCTFail("Expected mismatch")
            } catch {
                XCTAssertEqual(error as? FixtureTransportError, .requestMismatch)
            }
        }
        let remaining = await transport.remainingInteractions()
        let unmatchedLog = await transport.recordedRequests()
        XCTAssertEqual(remaining, 1)
        XCTAssertTrue(unmatchedLog.isEmpty)
        let response = try await transport.send(request("/api/history?limit=1&before=43"))
        XCTAssertEqual(response.statusCode, 200)
        do {
            _ = try await transport.send(request("/api/history?limit=1&before=43"))
            XCTFail("Expected exhausted scenario")
        } catch {
            XCTAssertEqual(error as? FixtureTransportError, .exhausted)
        }
    }

    func testSendRejectsStreamWithoutConsumingAndStreamAdaptsHTTPError() async throws {
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"GET","path":"/api/events","stream":{"statusCode":200,"chunks":[{"text":"fixture"}]}},
          {"method":"GET","path":"/api/events","response":{"statusCode":429,"headers":{"Retry-After":"4"},"body":{"error":"fixture"}}}
        ]}
        """)
        do {
            _ = try await transport.send(request("/api/events"))
            XCTFail("Expected stream-only failure")
        } catch {
            XCTAssertEqual(error as? FixtureTransportError, .expectedStream)
        }
        let first = try await transport.stream(request("/api/events"))
        var firstBody = Data()
        for try await chunk in first.body { firstBody.append(chunk) }
        XCTAssertEqual(String(decoding: firstBody, as: UTF8.self), "fixture")
        let second = try await transport.stream(request("/api/events"))
        XCTAssertEqual(second.statusCode, 429)
        XCTAssertEqual(second.header("retry-after"), "4")
        var secondBody = Data()
        for try await chunk in second.body { secondBody.append(chunk) }
        XCTAssertEqual(try JSONDecoder().decode([String: String].self, from: secondBody), ["error": "fixture"])
        await assertConsumed(transport)
    }

    func testOptionalRequestBodyMatchesJSONSemanticallyWithoutLoggingIt() async throws {
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"POST","path":"/api/fixture","requestBody":{"decision":"approve","fixture":true},
           "response":{"statusCode":204}}
        ]}
        """)
        for body in [nil, Data("invalid".utf8), Data(#"{"decision":"reject","fixture":true}"#.utf8)] {
            do {
                _ = try await transport.send(HTTPRequest(
                    method: .post, url: URL(string: "https://fixture.test/api/fixture")!,
                    body: body, timeout: .seconds(30)
                ))
                XCTFail("Expected body mismatch")
            } catch {
                XCTAssertEqual(error as? FixtureTransportError, .requestMismatch)
            }
        }
        let response = try await transport.send(HTTPRequest(
            method: .post, url: URL(string: "https://fixture.test/api/fixture")!,
            body: Data(#"{ "fixture": true, "decision": "approve" }"#.utf8), timeout: .seconds(30)
        ))
        XCTAssertEqual(response.statusCode, 204)
        await assertConsumed(transport)
    }

    func testHTTPStreamErrorsMapThroughRealChatClient() async throws {
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"POST","path":"/api/conversation/sessions/12/turns","response":{"statusCode":401}},
          {"method":"POST","path":"/api/conversation/sessions/12/turns","response":{"statusCode":429,"headers":{"Retry-After":"9"}}},
          {"method":"POST","path":"/api/conversation/sessions/12/turns","stream":{"statusCode":503,"chunks":[]}}
        ]}
        """)
        let chat = JarvisChatClient(client: try client(transport))
        for expected in [
            JarvisClientError.signInRequired, .rateLimited(retryAfter: .seconds(9)), .serviceUnavailable,
        ] {
            do {
                _ = try await chat.sendTurn(sessionId: "12", text: "Hello fixture")
                XCTFail("Expected HTTP stream failure")
            } catch {
                XCTAssertEqual(error as? JarvisClientError, expected)
            }
        }
        await assertConsumed(transport)
    }

    func testConfiguredTimedOutStreamDropMapsThroughRealChatClient() async throws {
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"POST","path":"/api/conversation/sessions/12/turns",
           "stream":{"statusCode":200,"chunks":[
             {"text":"event: delta\\ndata: {\\"text\\":\\"partial\\"}\\n\\n"}
           ],"drop":"timedOut"}}
        ]}
        """)
        let chat = JarvisChatClient(client: try client(transport))
        let stream = try await chat.sendTurn(sessionId: "12", text: "Hello fixture")
        var received: [ChatEvent] = []
        do {
            for try await event in stream { received.append(event) }
            XCTFail("Expected timed-out stream")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .timedOut)
        }
        XCTAssertEqual(received, [.delta(text: "partial")])
        await assertConsumed(transport)
    }

    func testConfiguredFailuresMapThroughRealClient() async throws {
        for (failure, expected) in [
            ("network", JarvisClientError.networkFailure), ("timedOut", .timedOut),
        ] {
            let transport = try inline("""
            {"version":1,"interactions":[{"method":"GET","path":"/api/tools","failure":"\(failure)"}]}
            """)
            do {
                _ = try await client(transport).listTools()
                XCTFail("Expected configured failure")
            } catch {
                XCTAssertEqual(error as? JarvisClientError, expected)
            }
        }
    }

    func testResponseDelayUsesClockAndTimesOutAtRequestDeadline() async throws {
        let clock = AdvancingFixtureClock()
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"GET","path":"/api/tools","delayMilliseconds":30,"response":{"statusCode":200,"body":[]}},
          {"method":"GET","path":"/api/tools","delayMilliseconds":100,"response":{"statusCode":200,"body":[]}}
        ]}
        """, clock: clock)
        let http = try client(transport, timeout: .milliseconds(50))
        let tools = try await http.listTools()
        XCTAssertTrue(tools.isEmpty)
        do {
            _ = try await http.listTools()
            XCTFail("Expected bounded timeout")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .timedOut)
        }
        let sleeps = await clock.sleeps()
        XCTAssertEqual(sleeps, [.milliseconds(30), .milliseconds(50)])
    }

    func testStreamChunkDelaysShareTheRequestDeadline() async throws {
        let clock = AdvancingFixtureClock()
        let transport = try inline("""
        {"version":1,"interactions":[{"method":"GET","path":"/api/events","delayMilliseconds":10,
          "stream":{"statusCode":200,"chunks":[
            {"text":"first","delayMilliseconds":20},{"text":"second","delayMilliseconds":30}
          ]}}]}
        """, clock: clock)
        let response = try await transport.stream(request("/api/events", timeout: .milliseconds(50)))
        var received: [String] = []
        do {
            for try await chunk in response.body { received.append(String(decoding: chunk, as: UTF8.self)) }
            XCTFail("Expected stream timeout")
        } catch {
            guard case HTTPTransportFailure.timedOut = error else { return XCTFail("Wrong timeout: \(error)") }
        }
        XCTAssertEqual(received, ["first"])
        let sleeps = await clock.sleeps()
        XCTAssertEqual(sleeps, [.milliseconds(10), .milliseconds(20), .milliseconds(20)])
    }

    func testCancellationBeforeRequestDoesNotConsumeScenario() async throws {
        let transport = try fixture("tools")
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await transport.send(request("/api/tools"))
        }
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch is CancellationError {}
        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 2)
    }

    func testCancellationInterruptsResponseDelayThroughRealHTTPClient() async throws {
        let clock = SuspendingFixtureClock()
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"GET","path":"/api/tools","delayMilliseconds":100,"response":{"statusCode":200,"body":[]}}
        ]}
        """, clock: clock)
        let http = try client(transport)
        let task = Task { try await http.listTools() }
        await clock.waitForSleep()
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch is CancellationError {}
        let cancelled = await clock.wasCancelled()
        XCTAssertTrue(cancelled)
    }

    func testConsumerCancellationInterruptsDelayedFixtureStreamThroughRealChatClient() async throws {
        let clock = SuspendingFixtureClock()
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"POST","path":"/api/conversation/sessions/12/turns",
           "stream":{"statusCode":200,"chunks":[
             {"text":"event: delta\\ndata: {\\"text\\":\\"waiting\\"}\\n\\n","delayMilliseconds":100}
           ]}}
        ]}
        """, clock: clock)
        let chat = JarvisChatClient(client: try client(transport), clock: clock)
        let task = Task { try await collect(chat.sendTurn(sessionId: "12", text: "Hello fixture")) }
        await clock.waitForSleep()
        task.cancel()
        _ = try? await task.value
        await clock.waitForCancellation()
        let cancelled = await clock.wasCancelled()
        XCTAssertTrue(cancelled)
        await assertConsumed(transport)
    }

    func testInvalidScenariosFailAtLoadTime() throws {
        for json in [
            "not JSON",
            #"{"version":2,"interactions":[]}"#,
            #"{"version":1,"interactions":[]}"#,
            #"{"version":1,"interactions":[{"method":"OPTIONS","path":"/api/tools","response":{"statusCode":200}}]}"#,
            #"{"version":1,"interactions":[{"method":"TRACE","path":"/api/tools","response":{"statusCode":200}}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"https://fixture.test/api","response":{"statusCode":200}}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/../tools","response":{"statusCode":200}}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/tools?limit=1","response":{"statusCode":200}}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/tools","delayMilliseconds":-1,"response":{"statusCode":200}}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/tools","delayMilliseconds":300001,"response":{"statusCode":200}}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/tools","response":{"statusCode":600}}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/tools","response":{"statusCode":200,"headers":{"X-Test":"a\r\nb"}}}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/tools","response":{"statusCode":200},"failure":"network"}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/tools"}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/tools","failure":"unknown"}]}"#,
            #"{"version":1,"interactions":[{"method":"GET","path":"/api/tools","stream":{"statusCode":200,"chunks":[{"text":"x","delayMilliseconds":-1}]}}]}"#,
        ] {
            XCTAssertThrowsError(try inline(json)) {
                XCTAssertEqual($0 as? FixtureTransportError, .invalidScenario)
            }
        }
        XCTAssertThrowsError(try FixtureTransport(scenario: Data(repeating: 32, count: 4 * 1024 * 1024 + 1))) {
            XCTAssertEqual($0 as? FixtureTransportError, .invalidScenario)
        }
    }

    func testApprovalsValidationAndResolutionFailuresUseFixtureTransport() async throws {
        let id = "fake_confirmation_0000000000000000000000000"
        let transport = try inline("""
        {"version":1,"interactions":[
          {"method":"GET","path":"/api/now","response":{"statusCode":200,"body":{"confirmations":[{"id":"invalid","actionKind":"other","summary":"fixture","expiresAt":"2026-10-30T00:00:00Z"}],"awayMode":false,"updatedAt":"2026-10-30T00:00:00Z"}}},
          {"method":"POST","path":"/api/now/confirmations/\(id)","response":{"statusCode":404}},
          {"method":"POST","path":"/api/now/confirmations/\(id)","response":{"statusCode":409}},
          {"method":"POST","path":"/api/now/confirmations/\(id)","response":{"statusCode":503}}
        ]}
        """)
        let approvals = JarvisApprovalsClient(client: try client(transport, retries: 2))
        do {
            try await approvals.resolveConfirmation(id: "invalid", decision: .approve)
            XCTFail("Expected local ID validation")
        } catch {
            XCTAssertEqual(error as? JarvisApprovalsClientError, .invalidConfirmationID)
        }
        do {
            _ = try await approvals.pendingConfirmations()
            XCTFail("Expected invalid response")
        } catch {
            XCTAssertEqual(error as? JarvisApprovalsClientError, .invalidResponse)
        }
        for expected in [JarvisApprovalsClientError.confirmationUnavailable, .awayMode] {
            do {
                try await approvals.resolveConfirmation(id: id, decision: .reject)
                XCTFail("Expected resolution failure")
            } catch {
                XCTAssertEqual(error as? JarvisApprovalsClientError, expected)
            }
        }
        do {
            try await approvals.resolveConfirmation(id: id, decision: .approve)
            XCTFail("Expected non-retried 503")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .serviceUnavailable)
        }
        await assertConsumed(transport)
    }
}

private func fixture(_ name: String, clock: any ChatClock = AdvancingFixtureClock()) throws -> FixtureTransport {
    let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Resources"))
    return try FixtureTransport(scenario: Data(contentsOf: url), clock: clock)
}

private func inline(_ json: String, clock: any ChatClock = AdvancingFixtureClock()) throws -> FixtureTransport {
    try FixtureTransport(scenario: Data(json.utf8), clock: clock)
}

private func client(
    _ transport: FixtureTransport,
    store: FixtureTokenStore = FixtureTokenStore(),
    provider: FixtureTokenProvider = FixtureTokenProvider(),
    retries: Int = 0,
    timeout: Duration = .seconds(30)
) throws -> JarvisClient {
    try JarvisClient(
        configuration: JarvisClientConfiguration(
            baseURL: URL(string: "https://fixture.test/api")!,
            requestTimeout: timeout,
            retryPolicy: RetryPolicy(maximumRetries: retries, delay: .zero)
        ),
        transport: transport, tokenStore: store, accessTokenProvider: provider
    )
}

private func request(_ path: String, method: HTTPMethod = .get, timeout: Duration = .seconds(30)) -> HTTPRequest {
    HTTPRequest(method: method, url: URL(string: "https://fixture.test" + path)!, timeout: timeout)
}

private func collect(_ stream: AsyncThrowingStream<ChatEvent, any Error>) async throws -> [ChatEvent] {
    var events: [ChatEvent] = []
    for try await event in stream { events.append(event) }
    return events
}

private func assertConsumed(_ transport: FixtureTransport, file: StaticString = #filePath, line: UInt = #line) async {
    let remaining = await transport.remainingInteractions()
    XCTAssertEqual(remaining, 0, file: file, line: line)
}

private struct FixtureToolResult: Codable, Sendable {
    let executed: Bool
}

private actor FixtureTokenStore: TokenStore {
    private var deleted = false
    func read() async throws -> String? { deleted ? nil : "fake-session-token" }
    func write(_ token: String) async throws {}
    func delete() async throws { deleted = true }
    func wasDeleted() -> Bool { deleted }
}

private actor FixtureTokenProvider: AccessTokenProvider {
    private var requests = 0
    func currentToken(for request: HTTPRequest) async throws -> String { "fake-provider-token" }
    func requestSignIn() async { requests += 1 }
    func signIns() -> Int { requests }
}

private actor AdvancingFixtureClock: ChatClock {
    private var time: Duration = .zero
    private var delays: [Duration] = []
    func now() async -> Duration { time }
    func sleep(for duration: Duration) async throws {
        try Task.checkCancellation()
        delays.append(duration)
        time += duration
    }
    func sleeps() -> [Duration] { delays }
}

private actor SuspendingFixtureClock: ChatClock {
    private var sleeper: CheckedContinuation<Void, any Error>?
    private var sleeping = false
    private var cancelled = false
    private var sleepWaiters: [CheckedContinuation<Void, Never>] = []
    private var cancellationWaiters: [CheckedContinuation<Void, Never>] = []

    func now() async -> Duration { .zero }

    func sleep(for duration: Duration) async throws {
        try Task.checkCancellation()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                sleeper = continuation
                sleeping = true
                sleepWaiters.forEach { $0.resume() }
                sleepWaiters.removeAll()
                if cancelled { cancelSleep() }
            }
        } onCancel: {
            Task { await self.cancelSleep() }
        }
    }

    private func cancelSleep() {
        cancelled = true
        sleeper?.resume(throwing: CancellationError())
        sleeper = nil
        cancellationWaiters.forEach { $0.resume() }
        cancellationWaiters.removeAll()
    }

    func waitForSleep() async {
        if sleeping { return }
        await withCheckedContinuation { sleepWaiters.append($0) }
    }

    func waitForCancellation() async {
        if cancelled { return }
        await withCheckedContinuation { cancellationWaiters.append($0) }
    }

    func wasCancelled() -> Bool { cancelled }
}

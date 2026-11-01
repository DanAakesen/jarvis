import Foundation
import XCTest
@testable import JarvisCore

final class JarvisWorkspaceClientTests: XCTestCase {
    func testJobEventTriggersActivitySnapshotRefresh() async throws {
        let transport = FakeWorkspaceTransport(
            streams: [.stream(sseResponse("job", ["jobId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "status": "running"], staysOpen: true))],
            responses: []
        )
        let workspace = makeWorkspaceClient(transport: transport)
        for try await event in workspace.events() {
            XCTAssertEqual(event, .activityChanged)
            break
        }
    }

    func testRegistersFlatSnapshotAndRejectsOversizedSnapshotsLocally() async throws {
        let sessionId = "12345678-1234-4234-8234-123456789abc"
        let transport = FakeWorkspaceTransport(
            streams: [.stream(sseResponse("workspace-ready", ["sessionId": sessionId], staysOpen: true))],
            responses: [HTTPResponse(statusCode: 204)]
        )
        let workspace = makeWorkspaceClient(transport: transport)
        let listener = await listenForReady(workspace)

        try await workspace.register(WorkspaceSnapshot(
            windows: [WorkspaceWindow(viewId: "fixture_view", title: "Synthetic view")],
            contextPanelOpen: true,
            device: WorkspaceDevice(label: "Fixture phone")
        ))

        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.last)
        XCTAssertEqual(request.url.path, "/api/now/workspace/state")
        let body = try XCTUnwrap(request.body)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["sessionId", "windows", "contextPanelOpen", "device"])
        XCTAssertNil(object["snapshot"])
        XCTAssertEqual(object["sessionId"] as? String, sessionId)
        let windows = try XCTUnwrap(object["windows"] as? [[String: Any]])
        XCTAssertEqual(Set(try XCTUnwrap(windows.first).keys), ["viewId", "title"])
        XCTAssertEqual(object["contextPanelOpen"] as? Bool, true)
        XCTAssertEqual((object["device"] as? [String: String])?["kind"], "phone")

        do {
            try await workspace.register(WorkspaceSnapshot(
                windows: Array(repeating: WorkspaceWindow(viewId: "view", title: "View"), count: 33),
                contextPanelOpen: false
            ))
            XCTFail("Expected window limit validation")
        } catch {
            XCTAssertEqual(error as? JarvisWorkspaceClientError, .invalidSnapshot)
        }
        let allRequests = await transport.recordedRequests()
        XCTAssertEqual(allRequests.count, 2)
        listener.cancel()
    }

    func testAcknowledgementUsesExpiryTimeoutAndAllowsIdenticalRepeat() async throws {
        let sessionId = "12345678-1234-4234-8234-123456789abc"
        let clock = FakeWorkspaceClock(now: Date(timeIntervalSince1970: 1))
        let transport = FakeWorkspaceTransport(
            streams: [.stream(sseResponse("workspace-ready", ["sessionId": sessionId], staysOpen: true))],
            responses: [HTTPResponse(statusCode: 204), HTTPResponse(statusCode: 204)]
        )
        let workspace = makeWorkspaceClient(transport: transport, clock: clock)
        let listener = await listenForReady(workspace)

        for _ in 0..<2 {
            try await workspace.acknowledge(
                commandId: "fixture_command",
                expiresAtMilliseconds: 5_000,
                applied: false,
                outcome: .refused,
                reason: "Synthetic refusal"
            )
        }

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 3)
        let acknowledgements = Array(requests.suffix(2))
        XCTAssertEqual(acknowledgements.map(\.url.path), [
            "/api/now/workspace/commands/fixture_command/ack",
            "/api/now/workspace/commands/fixture_command/ack",
        ])
        let firstBody = try XCTUnwrap(acknowledgements[0].body)
        let secondBody = try XCTUnwrap(acknowledgements[1].body)
        let firstObject = try XCTUnwrap(JSONSerialization.jsonObject(with: firstBody) as? [String: Any])
        let secondObject = try XCTUnwrap(JSONSerialization.jsonObject(with: secondBody) as? [String: Any])
        XCTAssertEqual(firstObject["sessionId"] as? String, secondObject["sessionId"] as? String)
        XCTAssertEqual(firstObject["applied"] as? Bool, secondObject["applied"] as? Bool)
        XCTAssertEqual(firstObject["outcome"] as? String, secondObject["outcome"] as? String)
        XCTAssertEqual(firstObject["reason"] as? String, secondObject["reason"] as? String)
        XCTAssertEqual(acknowledgements[0].timeout, .seconds(4))
        XCTAssertEqual(Set(firstObject.keys), ["sessionId", "applied", "outcome", "reason"])
        XCTAssertEqual(firstObject["sessionId"] as? String, sessionId)
        XCTAssertEqual(firstObject["applied"] as? Bool, false)
        XCTAssertEqual(firstObject["outcome"] as? String, "refused")
        XCTAssertEqual(firstObject["reason"] as? String, "Synthetic refusal")
        listener.cancel()
    }

    func testRejectsExpiredAndInvalidAcknowledgementsBeforeSending() async throws {
        let sessionId = "12345678-1234-4234-8234-123456789abc"
        let clock = FakeWorkspaceClock(now: Date(timeIntervalSince1970: 5))
        let transport = FakeWorkspaceTransport(
            streams: [.stream(sseResponse("workspace-ready", ["sessionId": sessionId], staysOpen: true))],
            responses: []
        )
        let workspace = makeWorkspaceClient(transport: transport, clock: clock)
        let listener = await listenForReady(workspace)

        do {
            try await workspace.acknowledge(commandId: "fixture_command", expiresAtMilliseconds: 5_000, applied: true)
            XCTFail("Expected expired acknowledgement")
        } catch {
            XCTAssertEqual(error as? JarvisWorkspaceClientError, .acknowledgementExpired)
        }
        do {
            try await workspace.acknowledge(
                commandId: "fixture_command",
                expiresAtMilliseconds: 10_000,
                applied: false,
                reason: String(repeating: "x", count: 301)
            )
            XCTFail("Expected local reason validation")
        } catch {
            XCTAssertEqual(error as? JarvisWorkspaceClientError, .invalidAcknowledgement)
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
        listener.cancel()
    }

    func testMapsMissingAndStaleAcknowledgementStatuses() async throws {
        for (status, expected) in [
            (404, JarvisWorkspaceClientError.commandNoLongerPending),
            (409, JarvisWorkspaceClientError.staleConnection),
        ] {
            let sessionId = "12345678-1234-4234-8234-123456789abc"
            let transport = FakeWorkspaceTransport(
                streams: [.stream(sseResponse("workspace-ready", ["sessionId": sessionId], staysOpen: true))],
                responses: [HTTPResponse(statusCode: status)]
            )
            let workspace = makeWorkspaceClient(
                transport: transport,
                clock: FakeWorkspaceClock(now: Date(timeIntervalSince1970: 1))
            )
            let listener = await listenForReady(workspace)

            do {
                try await workspace.acknowledge(
                    commandId: "fixture_command",
                    expiresAtMilliseconds: 5_000,
                    applied: true
                )
                XCTFail("Expected status \(status) to fail")
            } catch {
                XCTAssertEqual(error as? JarvisWorkspaceClientError, expected)
            }
            if status == 409 {
                do {
                    try await workspace.register(WorkspaceSnapshot(windows: [], contextPanelOpen: false))
                    XCTFail("A stale session must not be reused")
                } catch {
                    XCTAssertEqual(error as? JarvisWorkspaceClientError, .noActiveConnection)
                }
            }
            listener.cancel()
        }
    }

    func testMapsInvalidAndStaleSnapshotStatuses() async throws {
        for (status, expected) in [
            (400, JarvisWorkspaceClientError.invalidSnapshot),
            (409, JarvisWorkspaceClientError.staleConnection),
        ] {
            let sessionId = "12345678-1234-4234-8234-123456789abc"
            let transport = FakeWorkspaceTransport(
                streams: [.stream(sseResponse("workspace-ready", ["sessionId": sessionId], staysOpen: true))],
                responses: [HTTPResponse(statusCode: status)]
            )
            let workspace = makeWorkspaceClient(transport: transport)
            let listener = await listenForReady(workspace)

            do {
                try await workspace.register(WorkspaceSnapshot(windows: [], contextPanelOpen: false))
                XCTFail("Expected status \(status) to fail")
            } catch {
                XCTAssertEqual(error as? JarvisWorkspaceClientError, expected)
            }
            if status == 409 {
                do {
                    try await workspace.acknowledge(
                        commandId: "fixture_command",
                        expiresAtMilliseconds: 5_000,
                        applied: true
                    )
                    XCTFail("A stale session must not be reused")
                } catch {
                    XCTAssertEqual(error as? JarvisWorkspaceClientError, .noActiveConnection)
                }
            }
            listener.cancel()
        }
    }

    func testDecodesWorkspaceAndApprovalEventsAndRetainsUnknownEvents() async throws {
        let sessionId = "12345678-1234-4234-8234-123456789abc"
        let events = [
            ("workspace-ready", [
                "sessionId": sessionId,
                "trustedBlobHost": "fixture.blob.core.windows.net",
            ] as [String: Any]),
            ("now", [:] as [String: Any]),
            ("refresh", [:] as [String: Any]),
            ("mode", ["mode": "away"] as [String: Any]),
            ("status", ["kind": "approval_pending"] as [String: Any]),
            ("jarvis-activity", ["type": "synthetic"] as [String: Any]),
            ("workspace-command", [
                "command": ["commandId": "fixture_command", "operation": "show", "viewId": "fixture_view"],
                "expiresAt": 5_000,
            ] as [String: Any]),
            ("workspace-cancel", ["commandId": "fixture_command"] as [String: Any]),
            ("future-event", ["value": "synthetic"] as [String: Any]),
        ]
        let transport = FakeWorkspaceTransport(
            streams: [.stream(sseResponse(events: events, staysOpen: true))],
            responses: []
        )
        let workspace = makeWorkspaceClient(transport: transport)
        let listener = Task { () throws -> [WorkspaceEvent] in
            var received: [WorkspaceEvent] = []
            for try await event in workspace.events() {
                received.append(event)
                if received.count == events.count { return received }
            }
            return received
        }
        let received = try await listener.value

        XCTAssertEqual(received, [
            .workspaceReady(sessionId: sessionId, trustedBlobHost: "fixture.blob.core.windows.net"),
            .pendingConfirmationsChanged,
            .pendingConfirmationsChanged,
            .pendingConfirmationsChanged,
            .pendingConfirmationsChanged,
            .activityChanged,
            .workspaceCommand(
                command: WorkspaceCommand(
                    commandId: "fixture_command",
                    operation: "show",
                    fields: ["viewId": .string("fixture_view")]
                ),
                expiresAtMilliseconds: 5_000,
                trustedBlobHost: "fixture.blob.core.windows.net"
            ),
            .workspaceCancel(commandId: "fixture_command"),
            .unknown(name: "future-event", data: #"{"value":"synthetic"}"#),
        ])
    }

    func testReconnectsWithBoundedBackoffAndUsesFreshSessionIDs() async throws {
        let first = "12345678-1234-4234-8234-123456789abc"
        let second = "12345678-1234-4234-8234-123456789def"
        let transport = FakeWorkspaceTransport(
            streams: [
                .failure(.network),
                .failure(.network),
                .stream(sseResponse("workspace-ready", ["sessionId": first])),
                .stream(sseResponse("workspace-ready", ["sessionId": second])),
            ],
            responses: []
        )
        let clock = FakeWorkspaceClock(
            now: Date(timeIntervalSince1970: 1),
            cancelAfterSleeps: 4
        )
        let workspace = makeWorkspaceClient(
            transport: transport,
            policy: WorkspaceReconnectPolicy(initialDelay: .seconds(1), maximumDelay: .seconds(2)),
            clock: clock
        )
        var received: [WorkspaceEvent] = []
        do {
            for try await event in workspace.events() { received.append(event) }
            XCTFail("Expected the fake clock to stop the stream")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }

        XCTAssertEqual(received, [
            .connectionInterrupted,
            .connectionInterrupted,
            .workspaceReady(sessionId: first, trustedBlobHost: nil),
            .workspaceReady(sessionId: second, trustedBlobHost: nil),
        ])
        let requests = await transport.recordedRequests()
        let sleeps = await clock.sleeps()
        XCTAssertEqual(requests.count, 4)
        XCTAssertEqual(sleeps, [.seconds(1), .seconds(2), .seconds(1), .seconds(1)])
        XCTAssertEqual(
            WorkspaceReconnectPolicy(initialDelay: .seconds(2), maximumDelay: .seconds(4))
                .delay(afterAttempt: 8),
            .seconds(4)
        )
    }

    func testReconnectsWhenAnEstablishedEventStreamDrops() async throws {
        let first = "12345678-1234-4234-8234-123456789abc"
        let second = "12345678-1234-4234-8234-123456789def"
        let transport = FakeWorkspaceTransport(
            streams: [
                .stream(sseResponse(
                    "workspace-ready",
                    ["sessionId": first],
                    failure: .network
                )),
                .stream(sseResponse("workspace-ready", ["sessionId": second], staysOpen: true)),
            ],
            responses: [HTTPResponse(statusCode: 204)]
        )
        let workspace = makeWorkspaceClient(
            transport: transport,
            policy: WorkspaceReconnectPolicy(initialDelay: .milliseconds(5), maximumDelay: .milliseconds(10)),
            clock: FakeWorkspaceClock(now: Date(timeIntervalSince1970: 1))
        )
        let listener = Task { () throws -> [WorkspaceEvent] in
            var received: [WorkspaceEvent] = []
            for try await event in workspace.events() {
                received.append(event)
                if received.count == 3 {
                    try await workspace.register(WorkspaceSnapshot(windows: [], contextPanelOpen: false))
                    return received
                }
            }
            return received
        }

        let received = try await listener.value
        XCTAssertEqual(received, [
            .workspaceReady(sessionId: first, trustedBlobHost: nil),
            .connectionInterrupted,
            .workspaceReady(sessionId: second, trustedBlobHost: nil),
        ])
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 3)
        XCTAssertEqual(requests[2].url.path, "/api/now/workspace/state")
        let registrationBody = try XCTUnwrap(requests[2].body)
        let registration = try XCTUnwrap(JSONSerialization.jsonObject(with: registrationBody) as? [String: Any])
        XCTAssertEqual(registration["sessionId"] as? String, second)
    }

    private func makeWorkspaceClient(
        transport: FakeWorkspaceTransport,
        policy: WorkspaceReconnectPolicy = WorkspaceReconnectPolicy(),
        clock: any WorkspaceClock = FakeWorkspaceClock(now: Date(timeIntervalSince1970: 1))
    ) -> JarvisWorkspaceClient {
        let client = try! JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0, delay: .zero, maximumDelay: .zero)
            ),
            transport: transport,
            tokenStore: WorkspaceTokenStore(),
            accessTokenProvider: WorkspaceTokenProvider()
        )
        return JarvisWorkspaceClient(client: client, reconnectPolicy: policy, clock: clock)
    }

    private func listenForReady(_ workspace: JarvisWorkspaceClient) async -> Task<Void, Never> {
        let signal = WorkspaceReadySignal()
        let listener = Task {
            do {
                for try await event in workspace.events() {
                    if case .workspaceReady = event { await signal.markReady() }
                }
            } catch {}
        }
        await signal.wait()
        return listener
    }
}

private actor FakeWorkspaceTransport: HTTPTransport {
    enum StreamStub: Sendable {
        case stream(HTTPStreamResponse)
        case failure(HTTPTransportFailure)
    }

    private var streams: [StreamStub]
    private var responses: [HTTPResponse]
    private var requests: [HTTPRequest] = []

    init(streams: [StreamStub], responses: [HTTPResponse]) {
        self.streams = streams
        self.responses = responses
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        guard !responses.isEmpty else { throw HTTPTransportFailure.network }
        return responses.removeFirst()
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        requests.append(request)
        guard !streams.isEmpty else { throw HTTPTransportFailure.network }
        switch streams.removeFirst() {
        case .stream(let response): return response
        case .failure(let failure): throw failure
        }
    }

    func recordedRequests() -> [HTTPRequest] { requests }
}

private actor FakeWorkspaceClock: WorkspaceClock {
    private var currentTime: Date
    private var recordedSleeps: [Duration] = []
    private let cancelAfterSleeps: Int?

    init(now: Date, cancelAfterSleeps: Int? = nil) {
        currentTime = now
        self.cancelAfterSleeps = cancelAfterSleeps
    }

    func now() async -> Date { currentTime }

    func sleep(for duration: Duration) async throws {
        recordedSleeps.append(duration)
        guard cancelAfterSleeps.map({ recordedSleeps.count < $0 }) ?? true else {
            throw CancellationError()
        }
        try Task.checkCancellation()
        currentTime.addTimeInterval(Double(duration.components.seconds))
        currentTime.addTimeInterval(Double(duration.components.attoseconds) / 1e18)
    }

    func sleeps() -> [Duration] { recordedSleeps }
}

private actor WorkspaceReadySignal {
    private var ready = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func markReady() {
        ready = true
        waiters.forEach { $0.resume() }
        waiters.removeAll()
    }

    func wait() async {
        if ready { return }
        await withCheckedContinuation { waiters.append($0) }
    }
}

private actor WorkspaceTokenStore: TokenStore {
    func read() async throws -> String? { "session.fixture.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor WorkspaceTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "entra.fixture.token" }
    func requestSignIn() async {}
}

private func sseResponse(
    _ name: String,
    _ value: [String: Any],
    staysOpen: Bool = false,
    failure: HTTPTransportFailure? = nil
) -> HTTPStreamResponse {
    sseResponse(events: [(name, value)], staysOpen: staysOpen, failure: failure)
}

private func sseResponse(
    events: [(String, [String: Any])],
    staysOpen: Bool = false,
    failure: HTTPTransportFailure? = nil
) -> HTTPStreamResponse {
    let text = events.map { name, value in
        let data = try! JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        return "event: \(name)\ndata: \(String(decoding: data, as: UTF8.self))\n\n"
    }.joined()
    let body = AsyncThrowingStream<Data, any Error> { continuation in
        continuation.yield(Data(text.utf8))
        if let failure {
            continuation.finish(throwing: failure)
        } else if !staysOpen {
            continuation.finish()
        }
    }
    return HTTPStreamResponse(statusCode: 200, body: body)
}

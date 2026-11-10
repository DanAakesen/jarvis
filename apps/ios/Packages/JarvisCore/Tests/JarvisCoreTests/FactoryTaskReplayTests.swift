import Foundation
import XCTest
@testable import JarvisCore

final class FactoryTaskReplayTests: XCTestCase {
    func testDelayedFailedReplayCannotMakeTheFirstPageLookComplete() async throws {
        let allEvents = (1...1_200).map(event)
        let connected = expectation(description: "Stream opened but replay is delayed")
        let (body, continuation) = AsyncThrowingStream<Data, any Error>.makeStream()
        let transport = ReplayTransport(events: allEvents, streams: [body], connected: connected)
        let client = try makeClient(transport)
        let detail = try await client.task(id: "21")
        let recorder = ReplayRecorder(page: detail.events)
        let reader = Task {
            try await client.listenForTaskEventBatches(
                taskId: "21", onReplayComplete: { await recorder.ready() }
            ) { batch, replaying in await recorder.receive(batch, replaying: replaying) }
        }
        await fulfillment(of: [connected], timeout: 2)
        var snapshot = await recorder.snapshot()
        XCTAssertTrue(snapshot.history.hasMore, "UI must show factory.historyIncomplete")
        XCTAssertEqual(snapshot.history.events.last?.id, "100")
        XCTAssertFalse(snapshot.ready)
        XCTAssertNil(snapshot.history.streamCursor)
        // A failure before the 100-event boundary must still publish validated chunks.
        continuation.yield(try frames(Array(allEvents.prefix(37))))
        continuation.finish(throwing: HTTPTransportFailure.network)
        do {
            try await reader.value
            XCTFail("Dropped replay must fail, not report ready")
        } catch {}
        snapshot = await recorder.snapshot()
        XCTAssertFalse(snapshot.ready)
        XCTAssertTrue(snapshot.history.hasMore)
        XCTAssertEqual(snapshot.history.events.count, 100, "Replay overlap must not duplicate HTTP history")
        XCTAssertEqual(snapshot.history.nextOffset, 100)
        XCTAssertEqual(snapshot.history.streamCursor, "37")
        XCTAssertFalse(snapshot.preview.contains { $0.events.contains { $0.id == "1200" } })
        XCTAssertFalse(snapshot.preview.map(\.text).joined().contains("Synthetic latest progress 1200"))
        // History remains recoverable through HTTP while SSE is unavailable.
        for offset in stride(from: 100, through: 1_200, by: 100) {
            let page = try await client.task(id: "21", eventOffset: offset)
            await recorder.mergePage(page.events, offset: offset)
        }
        snapshot = await recorder.snapshot()
        XCTAssertFalse(snapshot.history.hasMore, "Only the HTTP end establishes complete archived coverage")
        XCTAssertEqual(snapshot.history.events.count, 1_200)
        XCTAssertEqual(snapshot.preview.last?.text, "Synthetic latest progress 1200")
    }

    func testLongReplayPublishesBoundedBatchesAndReachesActualTailWithoutDuplicates() async throws {
        let allEvents = (1...1_200).map(event)
        let replay = try frames(allEvents) + Data("event: ready\ndata: {}\n\n".utf8)
        let (body, continuation) = AsyncThrowingStream<Data, any Error>.makeStream()
        let recorder = ReplayRecorder(page: Array(allEvents.prefix(100)))
        let transport = ReplayTransport(events: allEvents, streams: [body])
        let client = try makeClient(transport)
        // One large transport chunk must still produce bounded, yielding publications.
        continuation.yield(replay)
        continuation.yield(try frames([event(1_201)]))
        continuation.finish()
        try await client.listenForTaskEventBatches(
            taskId: "21", onReplayComplete: { await recorder.ready() }
        ) { batch, replaying in await recorder.receive(batch, replaying: replaying) }

        let snapshot = await recorder.snapshot()
        XCTAssertTrue(snapshot.ready)
        XCTAssertEqual(snapshot.replayBatchSizes, Array(repeating: 100, count: 12))
        XCTAssertEqual(snapshot.liveBatchSizes, [1], "Live text must not wait for another replay batch")
        XCTAssertEqual(snapshot.history.events.count, 1_201)
        XCTAssertEqual(Set(snapshot.history.events.map(\.id)).count, 1_201)
        XCTAssertEqual(snapshot.history.nextOffset, 100)
        XCTAssertTrue(snapshot.history.hasMore, "Active SQL ready is not complete archived history")
        XCTAssertEqual(snapshot.history.streamCursor, "1201")
        XCTAssertTrue(snapshot.preview.contains { $0.text == "Synthetic latest progress 1200" })
        XCTAssertTrue(snapshot.preview.contains { $0.needsAttention && $0.events.first?.id == "1" })
        XCTAssertEqual(snapshot.joinedMessage, (2...1_199).map { "chunk \($0)\n" }.joined())
        XCTAssertLessThanOrEqual(snapshot.publications, 13, "Avoid one render/refresh for each of 1,200 replay events")
    }

    func testReconnectRetainsShortReplayBeforeFailureAndDoesNotAdvanceTheHTTPOffset() async throws {
        let allEvents = (1...1_200).map(event)
        let (first, failed) = AsyncThrowingStream<Data, any Error>.makeStream()
        let (second, resumed) = AsyncThrowingStream<Data, any Error>.makeStream()
        let recorder = ReplayRecorder(page: Array(allEvents.prefix(100)))
        let transport = ReplayTransport(events: allEvents, streams: [first, second])
        let client = try makeClient(transport)
        failed.yield(try frames(Array(allEvents.prefix(237))))
        failed.finish(throwing: HTTPTransportFailure.network)
        do {
            try await client.listenForTaskEventBatches(
                taskId: "21", onReplayComplete: { await recorder.ready() }
            ) { batch, replaying in await recorder.receive(batch, replaying: replaying) }
            XCTFail("Expected disconnected replay")
        } catch {}
        var snapshot = await recorder.snapshot()
        XCTAssertFalse(snapshot.ready)
        XCTAssertEqual(snapshot.history.streamCursor, "237")
        XCTAssertEqual(snapshot.replayBatchSizes, [100, 100, 37])
        // Deliberately replay an overlapping boundary to exercise ID-based deduplication.
        resumed.yield(try frames(Array(allEvents.dropFirst(236))))
        resumed.yield(Data("event: ready\ndata: {}\n\n".utf8))
        resumed.finish()
        try await client.listenForTaskEventBatches(
            taskId: "21", after: snapshot.history.streamCursor,
            onReplayComplete: { await recorder.ready() }
        ) { batch, replaying in await recorder.receive(batch, replaying: replaying) }
        snapshot = await recorder.snapshot()
        XCTAssertTrue(snapshot.ready)
        XCTAssertEqual(snapshot.history.events.count, 1_200)
        XCTAssertEqual(snapshot.history.streamCursor, "1200")
        XCTAssertEqual(snapshot.history.nextOffset, 100)
        XCTAssertEqual(snapshot.preview.last?.text, "Synthetic latest progress 1200")
        let headers = await transport.resumeHeaders()
        XCTAssertEqual(headers, [nil, "237"])
    }

    func testEmptyReadyDoesNotClaimThatArchivedHistoryIsComplete() async throws {
        let (body, continuation) = AsyncThrowingStream<Data, any Error>.makeStream()
        let allEvents = (1...1_200).map(event)
        let recorder = ReplayRecorder(page: Array(allEvents.prefix(100)))
        continuation.yield(Data("event: ready\ndata: {}\n\n".utf8))
        continuation.finish()
        try await makeClient(ReplayTransport(events: allEvents, streams: [body]))
            .listenForTaskEventBatches(
                taskId: "21", onReplayComplete: { await recorder.ready() }
            ) { batch, replaying in await recorder.receive(batch, replaying: replaying) }
        let snapshot = await recorder.snapshot()
        XCTAssertTrue(snapshot.ready)
        XCTAssertTrue(snapshot.history.hasMore, "An archived-only task still needs the partial-history notice")
        XCTAssertEqual(snapshot.history.events.last?.id, "100")
    }

    func testCancelledLongReplayStopsAtABatchBoundary() async throws {
        let (body, continuation) = AsyncThrowingStream<Data, any Error>.makeStream()
        continuation.yield(try frames((1...1_200).map(event)))
        continuation.yield(Data("event: ready\ndata: {}\n\n".utf8))
        continuation.finish()
        let recorder = ReplayRecorder(page: [])
        let client = try makeClient(ReplayTransport(events: [], streams: [body]))
        let reader = Task {
            try await client.listenForTaskEventBatches(
                taskId: "21", onReplayComplete: { await recorder.ready() }
            ) { batch, replaying in
                await recorder.receive(batch, replaying: replaying)
                withUnsafeCurrentTask { $0?.cancel() }
            }
        }
        do {
            try await reader.value
            XCTFail("Cancellation must interrupt replay")
        } catch is CancellationError {} catch {
            XCTFail("Unexpected error: \(error)")
        }
        let snapshot = await recorder.snapshot()
        XCTAssertEqual(snapshot.history.events.count, 100)
        XCTAssertEqual(snapshot.history.streamCursor, "100")
        XCTAssertFalse(snapshot.ready)
    }

    private func makeClient(_ transport: ReplayTransport) throws -> JarvisFactoryClient {
        JarvisFactoryClient(client: try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0)
            ),
            transport: transport, tokenStore: ReplayTokenStore(), accessTokenProvider: ReplayTokenProvider()
        ))
    }

    private func event(_ id: Int) -> FactoryTaskEvent {
        FactoryTaskEvent(
            id: String(id), taskId: "21",
            type: id == 1 ? "disk_low" : id >= 1_200 ? "task_result" : "acp_notification",
            summary: id >= 1_200 ? "Synthetic latest progress \(id)" : nil,
            payload: .object(["invocationId": .string("fixture-replay"), "data": .object([
                "method": .string("session/update"), "params": .object([
                    "sessionId": .string("fixture-session"), "update": .object([
                        "sessionUpdate": .string("agent_message_chunk"),
                        "content": .object(["type": .string("text"), "text": .string("chunk \(id)\n")])
                    ])
                ])
            ])]),
            payloadTruncated: false, source: .runner, at: "2026-11-10T10:00:00Z"
        )
    }

    private func frames(_ events: [FactoryTaskEvent]) throws -> Data {
        try Data(events.map { event in
            let json = String(decoding: try JSONEncoder().encode(event), as: UTF8.self)
            return "event: task\nid: \(event.id)\ndata: \(json)\n\n"
        }.joined().utf8)
    }
}

private actor ReplayRecorder {
    private var history = FactoryTaskHistory(taskID: "21")
    private var completed = false
    private var replaySizes: [Int] = []
    private var liveSizes: [Int] = []

    init(page: [FactoryTaskEvent]) { history.mergePage(page, offset: 0) }
    func ready() { completed = true }
    func mergePage(_ page: [FactoryTaskEvent], offset: Int) { history.mergePage(page, offset: offset) }
    func receive(_ batch: [FactoryTaskEvent], replaying: Bool) {
        if replaying { replaySizes.append(batch.count) } else { liveSizes.append(batch.count) }
        for event in batch { history.receive(event) }
    }

    func snapshot() -> ReplaySnapshot {
        let entries = FactoryTaskTimeline.entries(events: history.events, taskID: "21", language: .en)
        return ReplaySnapshot(
            history: history, ready: completed, preview: FactoryTaskTimeline.preview(entries),
            replayBatchSizes: replaySizes, liveBatchSizes: liveSizes,
            joinedMessage: entries.filter { $0.kind == .message }.map(\.text).joined()
        )
    }
}

private struct ReplaySnapshot: Sendable {
    let history: FactoryTaskHistory
    let ready: Bool
    let preview: [FactoryTimelineEntry]
    let replayBatchSizes: [Int]
    let liveBatchSizes: [Int]
    let joinedMessage: String
    var publications: Int { replayBatchSizes.count + liveBatchSizes.count }
}

private actor ReplayTransport: HTTPTransport {
    let events: [FactoryTaskEvent]
    var streams: [AsyncThrowingStream<Data, any Error>]
    let connected: XCTestExpectation?
    private var headers: [String?] = []

    init(events: [FactoryTaskEvent], streams: [AsyncThrowingStream<Data, any Error>], connected: XCTestExpectation? = nil) {
        self.events = events
        self.streams = streams
        self.connected = connected
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let offset = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems?
            .first(where: { $0.name == "eventOffset" })?.value.flatMap(Int.init) ?? 0
        let page = try JSONSerialization.jsonObject(with: JSONEncoder().encode(Array(events.dropFirst(offset).prefix(100))))
        let body: [String: Any] = [
            "id": "21", "projectId": "7", "title": "Synthetic replay task", "request": "Synthetic request",
            "source": "board", "agent": "copilot", "state": "Running", "priority": 0, "attemptCount": 1,
            "createdAt": "2026-11-10T10:00:00Z", "events": page, "usage": []
        ]
        return HTTPResponse(statusCode: 200, body: try JSONSerialization.data(withJSONObject: body))
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        guard !streams.isEmpty else { throw HTTPTransportFailure.network }
        headers.append(request.headers["Last-Event-ID"])
        connected?.fulfill()
        return HTTPStreamResponse(statusCode: 200, body: streams.removeFirst())
    }

    func resumeHeaders() -> [String?] { headers }
}

private actor ReplayTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct ReplayTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}

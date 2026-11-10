import XCTest
@testable import JarvisCore

final class FactoryTaskTimelineTests: XCTestCase {
    func testMixedLongTimelineIsCompactAndPreservesCountsAndOldFailures() {
        var events = (1...1_000).map { notification($0, update: ["sessionUpdate": .string("agent_thought_chunk")]) }
        events.insert(event(0, type: "disk_low", summary: "Workspace low on disk"), at: 0)
        events += [
            notification(1_001, update: message("Checking ")),
            notification(1_002, update: message("the build.\n")),
            event(1_003, type: "state_changed", payload: .object(["from": .string("Ready"), "to": .string("Running")])),
            event(1_004, type: "checks_completed", summary: "Checks passed"),
            event(1_005, type: "pull_request_opened", summary: "Opened PR #19"),
            event(1_006, type: "artifact_created", summary: "Test report"),
            event(1_007, type: "turn_completed", summary: "Review ready"),
            event(1_008, type: "task_result", summary: "Ready for review")
        ]
        let entries = FactoryTaskTimeline.entries(events: events, taskID: "21", language: .en)
        XCTAssertEqual(entries.reduce(0) { $0 + $1.events.count }, events.count)
        XCTAssertEqual(entries[1].events.count, 1_000)
        XCTAssertEqual(entries[1].kind, .notifications)
        XCTAssertEqual(entries[2].text, "Checking the build.\n")
        XCTAssertEqual(entries[2].events.map(\.id), ["1001", "1002"])
        let preview = FactoryTaskTimeline.preview(entries)
        XCTAssertLessThanOrEqual(preview.count, FactoryTaskTimeline.previewLimit + 1)
        XCTAssertEqual(preview.first?.text, "Workspace low on disk")
        XCTAssertEqual(preview.last?.text, "Ready for review")
        XCTAssertTrue(entries.contains { $0.text.contains("Running") })
    }

    func testOnlyExplicitPublicACPChannelsAreReadable() {
        let secret = "PRIVATE_PAYLOAD_SENTINEL"
        let events = [
            notification(1, update: ["sessionUpdate": .string("agent_thought_chunk"), "content": .object([
                "type": .string("text"), "text": .string(secret)
            ])]),
            notification(2, update: message("Public update")),
            notification(3, update: [
                "sessionUpdate": .string("tool_call"), "title": .string("Run checks"), "status": .string("in_progress"),
                "rawInput": .string(secret), "rawOutput": .string(secret)
            ]),
            notification(4, update: [
                "sessionUpdate": .string("plan"), "entries": .array([
                    .object(["content": .string("Review changes"), "status": .string("completed"), "private": .string(secret)])
                ])
            ]),
            notification(5, update: [
                "sessionUpdate": .string("tool_call_update"), "status": .string("failed"), "rawOutput": .string(secret)
            ]),
            notification(6, update: ["sessionUpdate": .string("future_private_channel"), "text": .string(secret)])
        ]
        let entries = FactoryTaskTimeline.entries(events: events, taskID: "21", language: .en)
        XCTAssertFalse(entries.map(\.text).joined().contains(secret))
        XCTAssertTrue(entries.contains { $0.text == "Public update" })
        XCTAssertTrue(entries.contains { $0.text == "Run checks · In progress" })
        XCTAssertTrue(entries.contains { $0.text == "Review changes · Done" })
        XCTAssertTrue(entries.contains { $0.needsAttention && $0.text.contains("Failed") })
    }

    func testChunksAreNotTrimmedOrMergedAcrossSessionInvocationOrInterveningEvents() {
        let events = [
            notification(1, update: message("  first\n")),
            notification(2, update: message(" second  ")),
            notification(3, update: message("another invocation"), invocation: "fixture-2"),
            notification(4, update: message("another session"), session: "fixture-session-2"),
            event(5, type: "state_changed"),
            notification(6, update: message("new message"))
        ]
        let entries = FactoryTaskTimeline.entries(events: events, taskID: "21", language: .en)
        XCTAssertEqual(entries.map(\.text), [
            "  first\n second  ", "another invocation", "another session", "state changed", "new message"
        ])
    }

    func testHistoryOffsetsRemainIndependentOfLiveReplayRefreshAndDuplicates() {
        var history = FactoryTaskHistory(taskID: "21")
        let first = (1...100).map { event($0) }
        history.mergePage(first, offset: 0)
        XCTAssertNil(history.streamCursor, "Replay from the beginning until SSE establishes its own cursor")
        for id in 1...250 { history.receive(event(id, taskID: "21")) }
        XCTAssertEqual(history.events.count, 250)
        XCTAssertEqual(history.nextOffset, 100, "SSE records cannot skip unfetched historical pages")
        XCTAssertEqual(history.streamCursor, "250")
        history.mergePage((101...200).map { event($0) }, offset: 100)
        XCTAssertEqual(history.nextOffset, 200)
        history.mergePage(first, offset: 0)
        XCTAssertEqual(history.nextOffset, 200, "Refresh must retain pagination progress")
        XCTAssertTrue(history.hasMore)
        history.mergePage((201...250).map { event($0) }, offset: 200)
        XCTAssertEqual(history.nextOffset, 250)
        XCTAssertFalse(history.hasMore)
        XCTAssertFalse(history.receive(event(249, taskID: "21")))
        XCTAssertEqual(history.streamCursor, "250", "Reconnect replay cannot move cursor backwards")
        XCTAssertEqual(history.events.count, 250)
        XCTAssertEqual(Set(history.events.map(\.id)).count, 250)
        XCTAssertFalse(history.receive(event(251, taskID: "22")))
        XCTAssertEqual(history.events.count, 250)
        history.mergePage([], offset: 500)
        XCTAssertEqual(history.nextOffset, 250)
    }

    func testChronologicalTieBreakAndFullPayloadSurviveTruncatedRefresh() {
        var history = FactoryTaskHistory(taskID: "21")
        history.receive(event(10, taskID: "21", payload: .object(["public": .string("full")])))
        history.mergePage([
            event(10, payload: .null, truncated: true),
            event(2),
            event(1, taskID: "22")
        ], offset: 0)
        XCTAssertEqual(history.events.map(\.id), ["2", "10"])
        XCTAssertFalse(history.events.last!.payloadTruncated)
        XCTAssertEqual(history.events.last!.payload, .object(["public": .string("full")]))
    }

    func testRefreshDoesNotReopenAnExhaustedFullPage() {
        var history = FactoryTaskHistory(taskID: "21")
        let page = (1...100).map { event($0) }
        history.mergePage(page, offset: 0)
        history.mergePage([], offset: 100)
        XCTAssertFalse(history.hasMore)
        history.mergePage(page, offset: 0)
        XCTAssertFalse(history.hasMore)
        XCTAssertEqual(history.nextOffset, 100)
    }

    func testDanishStateLabelsAndUnknownAndTruncatedNotificationsStayTruthful() {
        let entries = FactoryTaskTimeline.entries(events: [
            event(1, type: "state_changed", payload: .object(["from": .string("Running"), "to": .string("NeedsAttention")])),
            event(2, type: "acp_notification", truncated: true)
        ], taskID: "21", language: .da)
        XCTAssertTrue(entries[0].needsAttention)
        XCTAssertTrue(entries[0].text.contains(JarvisFactoryLocalization.string(.needsAttention, language: .da)))
        XCTAssertEqual(entries[1].text, JarvisFactoryLocalization.string(.notifications, language: .da))
        XCTAssertTrue(entries[1].events[0].payloadTruncated)
        XCTAssertTrue(FactoryTaskTimeline.payloadUnavailable(event(3, payload: .object(["truncated": .bool(true)]))))
        XCTAssertTrue(FactoryTaskTimeline.preview([]).isEmpty)
    }

    private func message(_ text: String) -> [String: FactoryJSONValue] {
        ["sessionUpdate": .string("agent_message_chunk"), "content": .object(["type": .string("text"), "text": .string(text)])]
    }

    private func notification(
        _ id: Int, update: [String: FactoryJSONValue],
        invocation: String = "fixture-1", session: String = "fixture-session"
    ) -> FactoryTaskEvent {
        event(id, type: "acp_notification", summary: "acp notification", payload: .object([
            "invocationId": .string(invocation),
            "data": .object(["method": .string("session/update"), "params": .object([
                "sessionId": .string(session), "update": .object(update)
            ])])
        ]))
    }

    private func event(
        _ id: Int, taskID: String? = nil, type: String = "state_changed", summary: String? = nil,
        payload: FactoryJSONValue = .null, truncated: Bool = false
    ) -> FactoryTaskEvent {
        FactoryTaskEvent(
            id: String(id), taskId: taskID, type: type, summary: summary, payload: payload,
            payloadTruncated: truncated, source: .runner, at: "2026-11-10T10:00:00Z"
        )
    }
}

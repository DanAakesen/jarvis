import XCTest
@testable import JarvisCore

final class ChatToolKindTests: XCTestCase {
    func testIconKindComesFromTheToolIdentifier() {
        let expected: [String: ChatToolKind] = [
            "read_html_view": .read, "calendar_list_events": .read, "pr_diff": .read,
            "file_write": .edit, "issue_update": .edit, "calendar_create_event": .edit,
            "pc_act": .command, "open_app": .command,
            "open_url": .web, "pc_browser_act": .web, "web_research": .web,
            "get_settings": .configuration, "proactive_preferences": .configuration,
            "get_deployment_status": .deployment, "manage_model_deployment": .deployment,
            "pr_review": .generic, "cancel_job": .generic
        ]
        for (name, kind) in expected { XCTAssertEqual(ChatToolKind(toolName: name), kind, name) }
    }

    func testRowStatusFollowsRealOutcomesOnly() {
        XCTAssertEqual(ChatToolStatus(outcome: nil), .running)
        XCTAssertEqual(ChatToolStatus(outcome: .ok), .succeeded)
        XCTAssertEqual(ChatToolStatus(outcome: .error), .failed)
        XCTAssertEqual(ChatToolStatus(outcome: .refused), .refused)
    }

    func testGroupStatusKeepsRunningAndFailureVisibleAmongCompletedChildren() {
        func group(_ outcomes: [ChatToolOutcome?]) -> ChatToolActivityGroup {
            ChatToolActivityGroup.grouping(outcomes.enumerated().map {
                ChatHistoryToolCall(id: "call-\($0.offset)", tool: "file_write", outcome: $0.element ?? .ok,
                                    taskId: nil, artifactId: nil)
            }).first!
        }
        XCTAssertEqual(group([.ok, .ok]).status, .succeeded)
        XCTAssertEqual(group([.ok, .error]).status, .failed)
        XCTAssertEqual(group([.ok, .refused]).status, .refused)
        XCTAssertEqual(group([.error, .refused]).status, .failed)
    }

    func testStartedEventWithoutOutcomeKeepsTheGroupRunning() throws {
        func event(_ id: String, outcome: String?) throws -> ChatToolActivity {
            let finished = outcome.map { ",\"outcome\":\"\($0)\"" } ?? ""
            let json = """
            {"type":"\(outcome == nil ? "tool-call-started" : "tool-call-finished")","source":"chat",
            "activityId":"\(id)","messageId":"1","toolName":"file_write"\(finished)}
            """
            return try JSONDecoder().decode(ChatToolActivity.self, from: Data(json.utf8))
        }
        let done = try event("00000000-0000-4000-8000-000000000001", outcome: "ok")
        let running = try event("00000000-0000-4000-8000-000000000002", outcome: nil)
        let group = try XCTUnwrap(ChatToolActivityGroup.grouping([done, running]).first)
        XCTAssertEqual(group.status, .running)
        XCTAssertEqual(group.calls.map(\.status), [.succeeded, .running])
    }

    func testSuccessfulVoiceMemoryWriteIsSafeToUseForCacheInvalidation() throws {
        let json = """
        {"type":"tool-call-finished","source":"voice",
         "activityId":"00000000-0000-4000-8000-000000000101","messageId":"42",
         "toolName":"memory_remember","outcome":"ok"}
        """
        let activity = try JSONDecoder().decode(ChatToolActivity.self, from: Data(json.utf8))
        XCTAssertEqual(activity.source, "voice")
        XCTAssertTrue(activity.changesPersonalMemory)
    }
}

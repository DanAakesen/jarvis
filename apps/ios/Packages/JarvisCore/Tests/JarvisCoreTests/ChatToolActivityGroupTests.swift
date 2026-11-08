import Foundation
import XCTest
@testable import JarvisCore

final class ChatToolActivityGroupTests: XCTestCase {
    func testTenDistinctConsecutiveCallsCollapseWithoutLosingAttemptsOrFailures() {
        let calls = (1...10).map { history($0, outcome: $0 == 3 ? .refused : ($0 == 5 ? .error : .ok)) }
        let groups = ChatToolActivityGroup.grouping(calls)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].id, "1")
        XCTAssertEqual(groups[0].toolName, "repo_list")
        XCTAssertEqual(groups[0].calls.map(\.id), calls.map(\.id))
        XCTAssertEqual(groups[0].calls.map(\.outcome), calls.map(\.outcome))
    }

    func testNonAdjacentToolsPreserveChronologyRatherThanMergingAcrossOtherWork() {
        let groups = ChatToolActivityGroup.grouping([
            history(1), history(2), history(3, tool: "vault_write", outcome: .refused),
            history(4, tool: "vault_write"), history(5),
        ])
        XCTAssertEqual(groups.map(\.toolName), ["repo_list", "vault_write", "repo_list"])
        XCTAssertEqual(groups.map { $0.calls.count }, [2, 2, 1])
        XCTAssertEqual(groups.flatMap(\.calls).map(\.id), ["1", "2", "3", "4", "5"])
    }

    func testLiveReplayMergesByIDWithoutRegressingCompletionOrCountingStartTwice() throws {
        let started = try activity(1, outcome: nil)
        let completed = try activity(1, outcome: .refused)
        let running = try activity(2, outcome: nil)
        let groups = ChatToolActivityGroup.grouping([started, running, completed, completed, started])
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].id, started.id)
        XCTAssertEqual(groups[0].calls.map(\.outcome), [.refused, nil])
        let finished = ChatToolActivityGroup.grouping([completed, running, try activity(2, outcome: .ok)])
        XCTAssertEqual(finished[0].id, groups[0].id)
        XCTAssertEqual(finished[0].calls.map(\.outcome), [.refused, .ok])
    }

    func testHistoryReplayDoesNotInflateCountsAndEmptyInputHasNoGroups() {
        let call = history(1)
        XCTAssertEqual(ChatToolActivityGroup.grouping([call, call])[0].calls.count, 1)
        XCTAssertTrue(ChatToolActivityGroup.grouping([ChatHistoryToolCall]()).isEmpty)
        XCTAssertTrue(ChatToolActivityGroup.grouping([ChatToolActivity]()).isEmpty)
    }

    private func history(_ id: Int, tool: String = "repo_list", outcome: ChatToolOutcome = .ok) -> ChatHistoryToolCall {
        ChatHistoryToolCall(id: "\(id)", tool: tool, outcome: outcome, taskId: nil, artifactId: nil)
    }

    private func activity(_ id: Int, outcome: ChatToolOutcome?) throws -> ChatToolActivity {
        var value = ["type": outcome == nil ? "tool-call-started" : "tool-call-finished", "source": "chat",
                     "activityId": String(format: "00000000-0000-4000-8000-%012d", id),
                     "messageId": "1", "toolName": "repo_list"]
        value["outcome"] = outcome?.rawValue
        return try JSONDecoder().decode(ChatToolActivity.self, from: JSONSerialization.data(withJSONObject: value))
    }
}

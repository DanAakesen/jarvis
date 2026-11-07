import XCTest
@testable import JarvisCore

final class ChatToolPlacementTests: XCTestCase {
    private let tool = ChatHistoryToolCall(id: "t1", tool: "repo_read", outcome: .error, taskId: nil, artifactId: nil)

    func testRequestToolsMoveToTheirReplyWithoutCrossingVoiceOrRuntimeSessions() {
        let placement = ChatToolPlacement(messages: [
            .init(id: "1", sessionID: "chat", channel: .chat, role: .dan, tools: [tool]),
            .init(id: "2", sessionID: "voice", channel: .voice, role: .jarvis, tools: []),
            .init(id: "3", sessionID: "test", channel: .chat, role: .jarvis, tools: []),
            .init(id: "4", sessionID: "chat", channel: .chat, role: .jarvis, tools: []),
        ])
        XCTAssertEqual(placement.replies, ["4": [tool]])
        XCTAssertTrue(placement.unanswered.isEmpty)
    }

    func testSteeringAndUnansweredRequestsKeepAllDistinctCallsAndFailureOutcomes() {
        let second = ChatHistoryToolCall(id: "t2", tool: "repo_read", outcome: .refused, taskId: nil, artifactId: nil)
        let input: [ChatToolPlacement.Message] = [
            .init(id: "1", sessionID: "chat", channel: .chat, role: .dan, tools: [tool]),
            .init(id: "2", sessionID: "chat", channel: .chat, role: .dan, tools: [second]),
        ]
        XCTAssertEqual(ChatToolPlacement(messages: input).unanswered, ["2": [tool, second]])
        let finished = ChatToolPlacement(messages: input + [
            .init(id: "partial", sessionID: "chat", channel: .chat, role: .jarvis, tools: [], interrupted: true),
            .init(id: "3", sessionID: "chat", channel: .chat, role: .jarvis, tools: [second]),
        ])
        XCTAssertEqual(finished.replies, ["3": [tool, second]])
        XCTAssertTrue(finished.unanswered.isEmpty)
    }
}

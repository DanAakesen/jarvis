import XCTest
@testable import JarvisCore

final class ChatTranscriptTests: XCTestCase {
    private struct Row: Equatable {
        let id: String
        let text: String
        let order: ChatTranscript.Order

        init(_ id: String, _ text: String = "Voice row", at: String = "2026-11-22T18:00:00Z") {
            self.id = id
            self.text = text
            order = .init(id: id, at: at)
        }
    }

    func testLivePageUpdatesAnExistingReplyAndAppendsInServerOrderBeforeTheLocalMessage() throws {
        let local = Row("local-pending", "Typed draft")
        let earlier = [Row("9", "First question"), Row("10", "Partial reply"), local]
        let answer = Row("10", "Completed reply")
        let next = Row("11", "Next question")
        let merged = try XCTUnwrap(ChatTranscript.merging([answer, next], into: earlier, by: \.order))
        XCTAssertEqual(merged, [earlier[0], answer, next, local])
        XCTAssertNil(ChatTranscript.merging([answer, next], into: merged, by: \.order))
    }

    func testLivePagePreservesLoadedOlderHistoryAndDoesNotRepublishOnRepeatedRefresh() throws {
        let loaded = (1...600).map { Row(String($0)) }
        let tail = Array(loaded.suffix(50))
        XCTAssertNil(ChatTranscript.merging(tail, into: loaded, by: \.order))
        let merged = try XCTUnwrap(ChatTranscript.merging([Row("601")], into: loaded, by: \.order))
        XCTAssertEqual(merged, loaded + [Row("601")])
        let older = try XCTUnwrap(ChatTranscript.merging([Row("599"), Row("598")], into: [Row("600")], by: \.order))
        XCTAssertEqual(older.map(\.id), ["598", "599", "600"])
    }

    func testOnlyNormalHistoryRefreshCanShowAHistoryFailureNotice() {
        let notice = "Could not load the conversation."
        XCTAssertNil(ChatTranscript.Refresh.liveUpdate.failureNotice(notice))
        XCTAssertNil(ChatTranscript.Refresh.afterTurn.failureNotice(notice))
        XCTAssertEqual(ChatTranscript.Refresh.normal.failureNotice(notice), notice)
    }
}

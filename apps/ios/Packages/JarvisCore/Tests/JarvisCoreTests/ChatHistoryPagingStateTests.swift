import XCTest
@testable import JarvisCore

final class ChatHistoryPagingStateTests: XCTestCase {
    func testLatestRefreshAdvancesCursorUntilOlderHistoryIsLoaded() {
        var state = ChatHistoryPagingState()
        state.replaceHistory(nextCursor: "first")
        state.refreshLatestPage(nextCursor: "newer")
        XCTAssertEqual(state.nextCursor, "newer")

        state.appendOlderPage(nextCursor: "oldest")
        state.refreshLatestPage(nextCursor: "latest")
        XCTAssertEqual(state.nextCursor, "oldest")
    }

    func testReplacingHistoryResetsOlderPageCursorOwnership() {
        var state = ChatHistoryPagingState()
        state.replaceHistory(nextCursor: "first")
        state.appendOlderPage(nextCursor: nil)
        state.replaceHistory(nextCursor: "replacement")
        state.refreshLatestPage(nextCursor: "refreshed")

        XCTAssertEqual(state.nextCursor, "refreshed")
    }
}

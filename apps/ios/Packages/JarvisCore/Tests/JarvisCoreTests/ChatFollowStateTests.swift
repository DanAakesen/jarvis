import XCTest
@testable import JarvisCore

final class ChatFollowStateTests: XCTestCase {
    func testManualScrollPausesFollowingUntilUserSendsOrJumpsToLatest() {
        var state = ChatFollowState()
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 120)

        XCTAssertFalse(state.shouldFollow)
        state.messageArrived()
        XCTAssertTrue(state.shouldShowJumpToLatest)

        state.messageSent()
        XCTAssertTrue(state.shouldFollow)
        XCTAssertFalse(state.shouldShowJumpToLatest)

        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 120)
        state.messageArrived()
        state.jumpedToLatest()
        XCTAssertTrue(state.shouldFollow)
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }

    func testReachingLatestClearsNewMessageIndicator() {
        var state = ChatFollowState()
        state.messageArrived()
        XCTAssertFalse(state.shouldShowJumpToLatest)

        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 120)
        state.messageArrived()
        XCTAssertTrue(state.shouldShowJumpToLatest)

        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 20)
        XCTAssertTrue(state.shouldFollow)
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }

    func testSendingResumesFollowingDuringTextSelection() {
        var state = ChatFollowState()
        state.selectionChanged(messageID: "message", isSelected: true)
        XCTAssertFalse(state.shouldFollow)

        state.messageSent()

        XCTAssertTrue(state.shouldFollow)
    }
}

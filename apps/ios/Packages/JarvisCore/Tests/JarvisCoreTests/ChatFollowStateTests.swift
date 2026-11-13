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

    func testContentUpdatesDuringScrollKeepJumpIndicatorAfterPausing() {
        var state = ChatFollowState()
        state.interactionBegan()
        state.contentChanged(from: ["sent"], to: ["sent"], hasOtherChanges: true)
        state.interactionEnded(distanceFromBottom: 120)

        XCTAssertFalse(state.shouldFollow)
        XCTAssertTrue(state.shouldShowJumpToLatest)

        state.contentChanged(from: ["sent"], to: ["sent"], hasOtherChanges: true)
        state.contentChanged(from: ["sent"], to: ["sent", "reply"], hasOtherChanges: false)
        XCTAssertFalse(state.shouldFollow)
        XCTAssertTrue(state.shouldShowJumpToLatest)
    }

    func testSendingResumesImmediatelyAndKeepsFollowingAcrossContentUpdates() {
        var state = ChatFollowState()
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 120)
        state.messageArrived()

        state.messageSent()
        XCTAssertTrue(state.shouldFollow)
        XCTAssertFalse(state.shouldShowJumpToLatest)

        for _ in 0..<5 {
            state.contentChanged(from: ["sent"], to: ["sent"], hasOtherChanges: true)
            XCTAssertTrue(state.shouldFollow)
            XCTAssertFalse(state.shouldShowJumpToLatest)
        }
    }

    func testOlderHistoryDoesNotShowJumpIndicatorButNewOrEditedContentDoes() {
        var state = ChatFollowState()
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 120)

        state.contentChanged(from: ["latest"], to: ["older", "latest"], hasOtherChanges: false)
        XCTAssertFalse(state.shouldShowJumpToLatest)
        XCTAssertFalse(state.shouldFollow)

        state.contentChanged(from: ["older", "latest"], to: ["older", "latest", "reply"], hasOtherChanges: false)
        XCTAssertTrue(state.shouldShowJumpToLatest)
        XCTAssertFalse(state.shouldFollow)

        state.jumpedToLatest()
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 120)
        state.contentChanged(from: ["reply"], to: ["updated reply"], hasOtherChanges: false)
        XCTAssertTrue(state.shouldShowJumpToLatest)
        XCTAssertFalse(state.shouldFollow)
    }

    func testActiveTurnUpdateStillShowsJumpIndicatorWhenHistoryIsPrepended() {
        var state = ChatFollowState()
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 120)

        state.contentChanged(from: ["latest"], to: ["older", "latest"], hasOtherChanges: true)

        XCTAssertTrue(state.shouldShowJumpToLatest)
        XCTAssertFalse(state.shouldFollow)
    }
}

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

    func testOpeningTheKeyboardResumesFollowingEvenAfterScrollingUp() {
        var state = ChatFollowState()
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 400)
        state.selectionChanged(messageID: "m1", isSelected: true)
        XCTAssertFalse(state.shouldFollow)

        state.keyboardOpened()
        XCTAssertTrue(state.shouldFollow)
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }

    func testNotificationOpeningKeepsExactMessageInViewAndOffersLatest() {
        var state = ChatFollowState()

        state.notificationMessageOpened()

        XCTAssertFalse(state.shouldFollow)
        XCTAssertTrue(state.shouldShowJumpToLatest)
        state.jumpedToLatest()
        XCTAssertTrue(state.shouldFollow)
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
        state.messageArrived()
        XCTAssertFalse(state.interactionEnded(distanceFromBottom: 120))

        XCTAssertFalse(state.shouldFollow)
        XCTAssertTrue(state.shouldShowJumpToLatest)

        state.messageArrived()
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
            state.messageArrived()
            XCTAssertTrue(state.shouldFollow)
            XCTAssertFalse(state.shouldShowJumpToLatest)
        }
    }

    func testNewVoiceRowsFollowUntilUserMovesAwayAndJumpResumesFollowing() {
        var state = ChatFollowState()
        state.messageArrived()
        XCTAssertTrue(state.shouldFollow)
        XCTAssertFalse(state.shouldShowJumpToLatest)

        state.interactionBegan()
        XCTAssertFalse(state.interactionEnded(distanceFromBottom: 120))
        state.messageArrived()
        XCTAssertFalse(state.shouldFollow)
        XCTAssertTrue(state.shouldShowJumpToLatest)

        state.jumpedToLatest()
        state.messageArrived()
        XCTAssertTrue(state.shouldFollow)
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }

    func testRowArrivingUnderATouchFollowsAfterReleaseIfTheUserDidNotScroll() {
        var state = ChatFollowState()
        state.interactionBegan()
        state.messageArrived()
        XCTAssertFalse(state.shouldFollow)
        XCTAssertTrue(state.shouldShowJumpToLatest)
        XCTAssertTrue(state.interactionEnded(distanceFromBottom: nil))
        XCTAssertFalse(state.shouldShowJumpToLatest)
        XCTAssertFalse(state.interactionEnded(distanceFromBottom: 0))
    }

    func testEndingSelectionAtTheLatestRowClearsThePendingJump() {
        var state = ChatFollowState()
        state.selectionChanged(messageID: "reply", isSelected: true)
        state.messageArrived()
        XCTAssertTrue(state.shouldShowJumpToLatest)

        state.selectionChanged(messageID: "reply", isSelected: false)
        state.interactionBegan()
        XCTAssertFalse(state.interactionEnded(distanceFromBottom: 120))
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }
}

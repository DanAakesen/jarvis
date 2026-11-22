import XCTest
@testable import JarvisCore

final class ChatFollowStateTests: XCTestCase {
    private let latest = ChatFollowState.Viewport(offset: 300, top: 0, bottom: 300)
    private let older = ChatFollowState.Viewport(offset: 180, top: 0, bottom: 300)

    func testVoiceAppendFollowsBeforeAndAfterLayoutEvenIfProgrammaticScrollReportsOffsets() {
        var state = ChatFollowState()
        XCTAssertTrue(state.messageArrived())
        XCTAssertFalse(state.scrollPhaseChanged(.programmatic))
        XCTAssertFalse(state.viewportChanged(from: latest, to: older))
        XCTAssertFalse(state.scrollPhaseChanged(.idle))
        XCTAssertTrue(state.viewportChanged(from: latest, to: .init(offset: 300, top: 0, bottom: 480)))
        XCTAssertTrue(state.messageArrived())
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }

    func testGestureKeepsOlderRowsInPlaceWhenVoiceAppendsAndJumpResumesFollowing() {
        var state = ChatFollowState()
        state.scrollPhaseChanged(.tracking)
        state.scrollPhaseChanged(.dragging)
        XCTAssertFalse(state.messageArrived())
        XCTAssertFalse(state.shouldShowJumpToLatest)
        state.scrollPhaseChanged(.coasting)
        XCTAssertFalse(state.viewportChanged(from: latest, to: older))
        XCTAssertFalse(state.scrollPhaseChanged(.idle))
        XCTAssertFalse(state.messageArrived())
        XCTAssertTrue(state.shouldShowJumpToLatest)

        // A layout shrink or programmatic adjustment is not a swipe back to the bottom.
        XCTAssertFalse(state.viewportChanged(from: older, to: .init(offset: 180, top: 0, bottom: 180)))
        state.scrollPhaseChanged(.programmatic)
        XCTAssertFalse(state.viewportChanged(from: older, to: latest))
        XCTAssertFalse(state.scrollPhaseChanged(.idle))
        XCTAssertTrue(state.shouldShowJumpToLatest)

        state.jumpedToLatest()
        XCTAssertTrue(state.messageArrived())
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }

    func testTouchAndLayoutChangesAloneNeverPauseFollowingAfterRelease() {
        var state = ChatFollowState()
        state.scrollPhaseChanged(.tracking)
        XCTAssertFalse(state.messageArrived())
        XCTAssertFalse(state.viewportChanged(from: latest, to: .init(offset: 300, top: 0, bottom: 500)))
        XCTAssertFalse(state.shouldShowJumpToLatest)
        XCTAssertTrue(state.scrollPhaseChanged(.idle))
        XCTAssertTrue(state.messageArrived())
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }

    func testGrowingReplyDoesNotCountAsScrollingAwayEvenDuringADrag() {
        var state = ChatFollowState()
        state.scrollPhaseChanged(.dragging)
        XCTAssertFalse(state.messageArrived())
        XCTAssertFalse(state.viewportChanged(from: latest, to: .init(offset: 300, top: 0, bottom: 500)))
        XCTAssertTrue(state.scrollPhaseChanged(.idle))
        XCTAssertTrue(state.shouldFollow)
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }

    func testManualReturnNearBottomResumesFollowing() {
        var state = ChatFollowState()
        state.scrollPhaseChanged(.dragging)
        _ = state.viewportChanged(from: latest, to: older)
        XCTAssertFalse(state.messageArrived())
        XCTAssertTrue(state.shouldShowJumpToLatest)
        XCTAssertFalse(state.scrollPhaseChanged(.idle))
        state.scrollPhaseChanged(.dragging)
        _ = state.viewportChanged(from: older, to: .init(offset: 280, top: 0, bottom: 300))
        XCTAssertTrue(state.scrollPhaseChanged(.idle))
        XCTAssertFalse(state.shouldShowJumpToLatest)
        XCTAssertTrue(state.messageArrived())
    }

    func testSendAndKeyboardResumeAfterUserScrollAndSelection() {
        var state = ChatFollowState()
        state.scrollPhaseChanged(.dragging)
        _ = state.viewportChanged(from: latest, to: older)
        state.scrollPhaseChanged(.idle)
        state.selectionChanged(messageID: "message", isSelected: true)
        XCTAssertFalse(state.messageArrived())
        state.keyboardOpened()
        XCTAssertTrue(state.messageArrived())
        state.selectionChanged(messageID: "message", isSelected: true)
        XCTAssertFalse(state.messageArrived())
        state.messageSent()
        XCTAssertTrue(state.messageArrived())
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }

    func testNotificationOpeningKeepsExactMessageInViewAndOffersLatest() {
        var state = ChatFollowState()
        state.notificationMessageOpened()
        XCTAssertFalse(state.messageArrived())
        XCTAssertTrue(state.shouldShowJumpToLatest)
        state.jumpedToLatest()
        XCTAssertTrue(state.shouldFollow)
    }

    func testEndingSelectionAtTheLatestRowClearsThePendingJump() {
        var state = ChatFollowState()
        state.selectionChanged(messageID: "reply", isSelected: true)
        state.messageArrived()
        XCTAssertTrue(state.shouldShowJumpToLatest)

        state.selectionChanged(messageID: "reply", isSelected: false)
        XCTAssertTrue(state.shouldFollow)
        XCTAssertFalse(state.shouldShowJumpToLatest)
    }
}

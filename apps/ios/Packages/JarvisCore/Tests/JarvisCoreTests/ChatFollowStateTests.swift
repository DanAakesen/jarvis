import XCTest
@testable import JarvisCore

final class ChatFollowStateTests: XCTestCase {
    func testFollowingSurvivesContentAndViewportGrowth() {
        var state = ChatFollowState()
        XCTAssertTrue(state.shouldFollow)
        state.interactionBegan()
        XCTAssertFalse(state.shouldFollow, "Even a touch at the bottom must suspend following")
        state.interactionEnded(distanceFromBottom: 0)
        XCTAssertTrue(state.shouldFollow)
        // Layout changes must not reclassify a follower as an older-history reader.
        XCTAssertTrue(state.isFollowing)
    }

    func testReadingHistoryStaysPausedUntilUserReturnsToLatest() {
        var state = ChatFollowState()
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 500)
        XCTAssertFalse(state.shouldFollow)
        state.selectionChanged(messageID: "old", isSelected: true)
        state.selectionChanged(messageID: "old", isSelected: false)
        XCTAssertFalse(state.shouldFollow)
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 44)
        XCTAssertTrue(state.shouldFollow)
    }

    func testNearLatestThresholdAndBottomOverscroll() {
        for (distance, expected) in [(44.1, false), (44.0, true), (0.0, true), (-30.0, true)] {
            var state = ChatFollowState()
            state.interactionBegan()
            state.interactionEnded(distanceFromBottom: distance)
            XCTAssertEqual(state.shouldFollow, expected)
        }
    }

    func testTouchWithoutScrollingKeepsFollowIntentWhenContentGrows() {
        var state = ChatFollowState()
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: nil)
        XCTAssertTrue(state.shouldFollow)
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 500)
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: nil)
        XCTAssertFalse(state.shouldFollow)
    }

    func testNonUserIdleCannotChangeFollowIntent() {
        var state = ChatFollowState()
        state.interactionEnded(distanceFromBottom: 500)
        XCTAssertTrue(state.shouldFollow)
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 500)
        state.interactionEnded(distanceFromBottom: 0)
        XCTAssertFalse(state.shouldFollow)
    }

    func testSelectionSuspendsFollowingWithoutLosingScrollIntent() {
        var state = ChatFollowState()
        state.selectionChanged(messageID: "one", isSelected: true)
        state.selectionChanged(messageID: "two", isSelected: true)
        state.interactionBegan()
        state.interactionEnded(distanceFromBottom: 0)
        XCTAssertFalse(state.shouldFollow)
        state.selectionChanged(messageID: "one", isSelected: false)
        XCTAssertFalse(state.shouldFollow)
        state.selectionChanged(messageID: "two", isSelected: false)
        XCTAssertTrue(state.shouldFollow)
    }
}

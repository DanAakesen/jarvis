import XCTest
@testable import JarvisCore

final class WatchChatLayoutTests: XCTestCase {
    func testClearanceCoversComposerSafeAreaAndGap() {
        XCTAssertEqual(WatchChatLayout.endClearance(composerHeight: 52, safeAreaBottom: 8), 68)
        // With a status row the composer is taller and the newest message must still clear it.
        XCTAssertGreaterThan(WatchChatLayout.endClearance(composerHeight: 100, safeAreaBottom: 8),
                             WatchChatLayout.endClearance(composerHeight: 52, safeAreaBottom: 8))
        XCTAssertEqual(WatchChatLayout.endClearance(composerHeight: .nan, safeAreaBottom: 8), WatchChatLayout.endGap)
        XCTAssertEqual(WatchChatLayout.endClearance(composerHeight: -5, safeAreaBottom: -5), WatchChatLayout.endGap)
    }

    func testScrolledToTheEndIsNeverReadingEvenInsideTheClearance() {
        for distance in [0.0, 30, 68] {
            XCTAssertFalse(WatchChatLayout.isReading(distanceFromEnd: distance, wasReading: false, clearance: 68))
            XCTAssertFalse(WatchChatLayout.isReading(distanceFromEnd: distance, wasReading: true, clearance: 68))
        }
    }

    func testReadingHasHysteresis() {
        let clearance = 68.0
        XCTAssertFalse(WatchChatLayout.isReading(distanceFromEnd: clearance + 79, wasReading: false, clearance: clearance))
        XCTAssertTrue(WatchChatLayout.isReading(distanceFromEnd: clearance + 81, wasReading: false, clearance: clearance))
        XCTAssertTrue(WatchChatLayout.isReading(distanceFromEnd: clearance + 40, wasReading: true, clearance: clearance))
        XCTAssertFalse(WatchChatLayout.isReading(distanceFromEnd: clearance + 20, wasReading: true, clearance: clearance))
    }
}

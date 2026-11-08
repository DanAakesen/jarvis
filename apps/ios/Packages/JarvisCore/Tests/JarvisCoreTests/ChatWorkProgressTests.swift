import Foundation
import XCTest
@testable import JarvisCore

final class ChatWorkProgressTests: XCTestCase {
    func testElapsedClockHasNoTurnCutoffAndClampsFutureServerDates() {
        let start = Date(timeIntervalSince1970: 100)
        for (seconds, expected) in [(0, "0s"), (58, "58s"), (61, "1m 1s"),
                                    (1201, "20m 1s"), (3662, "1h 1m 2s"), (-5, "0s")] {
            XCTAssertEqual(ChatWorkProgress.elapsed(from: start, to: start.addingTimeInterval(Double(seconds))), expected)
        }
        XCTAssertEqual(ChatWorkProgress.startDate("2026-11-08T12:00:00.000Z"),
                       ChatWorkProgress.startDate("2026-11-08T12:00:00Z"))
    }

    func testInterimBoundaryKeepsSubsequentTextAndDoesNotEraseUnmatchedOutput() {
        XCTAssertEqual(ChatWorkProgress.removingUpdate("Checked the repo.", from: "\n\nChecked the repo.Next result"), "Next result")
        XCTAssertEqual(ChatWorkProgress.removingUpdate("Different update", from: "Still visible"), "Still visible")
    }
}

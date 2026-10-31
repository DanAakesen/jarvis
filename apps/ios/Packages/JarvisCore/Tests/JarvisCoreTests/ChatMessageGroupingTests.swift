import XCTest
@testable import JarvisCore

final class ChatMessageGroupingTests: XCTestCase {
    func testHidesTimestampForSameSenderWithinSameMinute() {
        XCTAssertFalse(ChatMessageGrouping.showsTimestamp(
            role: .jarvis,
            at: "2026-10-30T10:12:59Z",
            previousRole: .jarvis,
            previousAt: "2026-10-30T10:12:01Z"
        ))
    }

    func testShowsTimestampForDifferentSenderOrMinute() {
        XCTAssertTrue(ChatMessageGrouping.showsTimestamp(
            role: .dan,
            at: "2026-10-30T10:12:59Z",
            previousRole: .jarvis,
            previousAt: "2026-10-30T10:12:01Z"
        ))
        XCTAssertTrue(ChatMessageGrouping.showsTimestamp(
            role: .jarvis,
            at: "2026-10-30T10:13:00Z",
            previousRole: .jarvis,
            previousAt: "2026-10-30T10:12:59Z"
        ))
    }
}

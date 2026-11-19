import XCTest
@testable import JarvisCore

final class WatchCaptureGenerationTests: XCTestCase {
    func testAStoppedCaptureIsNoLongerCurrent() {
        var generation = WatchCaptureGeneration()
        let token = generation.begin()
        XCTAssertTrue(generation.isCurrent(token))
        generation.end()
        XCTAssertFalse(generation.isCurrent(token))
    }

    func testRapidStopAndRestartInvalidatesTheOldDelayedCheck() {
        var generation = WatchCaptureGeneration()
        let first = generation.begin()
        generation.end()
        let second = generation.begin()
        // The first capture's 2.5 s closure fires while the second capture is live: it must not touch it.
        XCTAssertFalse(generation.isCurrent(first))
        XCTAssertTrue(generation.isCurrent(second))
    }

    func testRestartWithoutAnExplicitStopStillInvalidatesTheOldToken() {
        var generation = WatchCaptureGeneration()
        let first = generation.begin()
        let second = generation.begin()
        XCTAssertFalse(generation.isCurrent(first))
        XCTAssertTrue(generation.isCurrent(second))
    }
}

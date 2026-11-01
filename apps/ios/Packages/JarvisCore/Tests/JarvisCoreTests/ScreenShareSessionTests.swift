import Foundation
import XCTest
@testable import JarvisCore

final class ScreenShareSessionTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_000)

    func testStartMovesFromStartingToLiveWhenBroadcastHeartbeatAppears() {
        var session = ScreenShareSession()
        XCTAssertTrue(session.requestStart(extensionInstalled: true, now: start))
        XCTAssertEqual(session.state, .starting)
        session.observe(isSharing: false, now: start.addingTimeInterval(3))
        XCTAssertEqual(session.state, .starting)
        session.observe(isSharing: true, now: start.addingTimeInterval(4))
        XCTAssertEqual(session.state, .live)
    }

    func testMissingExtensionReportsPlainStateWithoutPresentingPicker() {
        var session = ScreenShareSession()
        XCTAssertFalse(session.requestStart(extensionInstalled: false, now: start))
        XCTAssertEqual(session.state, .extensionMissing)
    }

    func testStartTimesOutAsFailedAndCanBeRetried() {
        var session = ScreenShareSession()
        _ = session.requestStart(extensionInstalled: true, now: start)
        session.observe(isSharing: false, now: start.addingTimeInterval(ScreenShareSession.startTimeout + 1))
        XCTAssertEqual(session.state, .failed)
        XCTAssertTrue(session.requestStart(extensionInstalled: true, now: start.addingTimeInterval(30)))
        XCTAssertEqual(session.state, .starting)
    }

    func testLiveBecomesStoppedWhenHeartbeatEndsOrStopIsRequested() {
        var session = ScreenShareSession()
        _ = session.requestStart(extensionInstalled: true, now: start)
        session.observe(isSharing: true, now: start)
        session.observe(isSharing: false, now: start.addingTimeInterval(10))
        XCTAssertEqual(session.state, .stopped)

        _ = session.requestStart(extensionInstalled: true, now: start)
        session.observe(isSharing: true, now: start)
        session.requestStop()
        XCTAssertEqual(session.state, .stopped)
    }

    func testBusySessionIgnoresSecondStart() {
        var session = ScreenShareSession()
        XCTAssertTrue(session.requestStart(extensionInstalled: true, now: start))
        XCTAssertFalse(session.requestStart(extensionInstalled: true, now: start))
    }

    func testBroadcastStartedFromControlCenterIsReportedLive() {
        var session = ScreenShareSession()
        session.observe(isSharing: true, now: start)
        XCTAssertEqual(session.state, .live)
    }

    func testStopDoesNotFlipBackToLiveWhileExtensionHeartbeatIsStillFresh() {
        var session = ScreenShareSession()
        _ = session.requestStart(extensionInstalled: true, now: start)
        session.observe(isSharing: true, now: start)
        session.requestStop()
        session.observe(isSharing: true, now: start.addingTimeInterval(1))
        XCTAssertEqual(session.state, .stopped)
        session.observe(isSharing: false, now: start.addingTimeInterval(6))
        session.observe(isSharing: true, now: start.addingTimeInterval(8))
        XCTAssertEqual(session.state, .live)
    }
}

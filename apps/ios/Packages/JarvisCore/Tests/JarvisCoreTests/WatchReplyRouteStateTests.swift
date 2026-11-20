import XCTest
@testable import JarvisCore

final class WatchReplyRouteStateTests: XCTestCase {
    private let target = JarvisReplyNotificationTarget(sessionID: "41", messageID: "42")!

    func testTapRemainsPendingThroughVoiceThenOpensWhenIdle() {
        var state = WatchReplyRouteState()
        state.receive(target)

        XCTAssertNil(state.takeWhenAvailable(
            reachable: true, busy: false, startingVoice: false, voiceActive: true, dictating: false
        ))
        XCTAssertEqual(state.pending, target)

        XCTAssertEqual(state.takeWhenAvailable(
            reachable: true, busy: false, startingVoice: false, voiceActive: false, dictating: false
        ), target)
        state.opened(target)
        XCTAssertNil(state.pending)
    }

    func testTapRemainsPendingAcrossBusyDictationAndConnectionLoss() {
        var state = WatchReplyRouteState()
        state.receive(target)

        for unavailable in [
            (false, false, false, false, false),
            (true, true, false, false, false),
            (true, false, true, false, false),
            (true, false, false, false, true),
        ] {
            XCTAssertNil(state.takeWhenAvailable(
                reachable: unavailable.0,
                busy: unavailable.1,
                startingVoice: unavailable.2,
                voiceActive: unavailable.3,
                dictating: unavailable.4
            ))
            XCTAssertEqual(state.pending, target)
        }
    }

    func testFailedOpenCanRetryWithoutLosingExactTarget() {
        var state = WatchReplyRouteState()
        state.receive(target)
        XCTAssertEqual(state.takeWhenAvailable(
            reachable: true, busy: false, startingVoice: false, voiceActive: false, dictating: false
        ), target)
        state.failed(target)
        XCTAssertEqual(state.pending, target)
        XCTAssertEqual(state.takeWhenAvailable(
            reachable: true, busy: false, startingVoice: false, voiceActive: false, dictating: false
        ), target)
    }

    func testSignOutClearsPendingTarget() {
        var state = WatchReplyRouteState()
        state.receive(target)
        state.clear()
        XCTAssertNil(state.pending)
    }

    func testLatestTapWaitsBehindAnInFlightTargetWithoutBeingDiscarded() {
        let latest = JarvisReplyNotificationTarget(sessionID: "71", messageID: "72")!
        var state = WatchReplyRouteState()
        state.receive(target)
        XCTAssertEqual(state.takeWhenAvailable(
            reachable: true, busy: false, startingVoice: false, voiceActive: false, dictating: false
        ), target)

        state.receive(latest)
        XCTAssertNil(state.takeWhenAvailable(
            reachable: true, busy: false, startingVoice: false, voiceActive: false, dictating: false
        ))
        state.opened(target)
        XCTAssertEqual(state.takeWhenAvailable(
            reachable: true, busy: false, startingVoice: false, voiceActive: false, dictating: false
        ), latest)
        XCTAssertEqual(state.pending, latest)
    }
}

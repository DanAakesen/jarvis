import XCTest
@testable import JarvisCore

final class WatchConnectionRecoveryTests: XCTestCase {
    func testStartupAndIdleReachabilityDoNotInterruptAnUnsentDraft() {
        var composer = WatchComposer()
        composer.dictate("Keep this unsent")
        for _ in 0..<3 {
            XCTAssertFalse(composer.handleConnectionLoss(hasInFlightTurn: false, hasVoiceSession: false))
            XCTAssertEqual(composer.draft, "Keep this unsent")
            XCTAssertFalse(composer.sending)
        }
    }

    func testInterruptedUnacknowledgedSendPreservesTheDraftForManualRecovery() {
        var composer = WatchComposer()
        composer.dictate("My request")
        XCTAssertEqual(composer.beginSend(), "My request")
        XCTAssertTrue(composer.sending)
        XCTAssertTrue(composer.handleConnectionLoss(hasInFlightTurn: true, hasVoiceSession: false))
        XCTAssertFalse(composer.sending)
        XCTAssertEqual(composer.draft, "My request")
    }

    func testAcknowledgedTurnStillReportsAnInterruptedReplyWithoutRecreatingTheDraft() {
        var composer = WatchComposer()
        composer.dictate("Already accepted")
        XCTAssertEqual(composer.beginSend(), "Already accepted")
        composer.finishSend(success: true)
        XCTAssertTrue(composer.handleConnectionLoss(hasInFlightTurn: true, hasVoiceSession: false))
        XCTAssertEqual(composer.draft, "")
        XCTAssertNil(composer.beginSend(), "A disconnect must not recreate or resend an accepted request")
    }

    func testActiveVoiceInterruptionRequestsFeedbackAndPreservesAnyUnsentText() {
        var composer = WatchComposer()
        composer.dictate("Saved for later")
        XCTAssertTrue(composer.handleConnectionLoss(hasInFlightTurn: false, hasVoiceSession: true))
        XCTAssertEqual(composer.draft, "Saved for later")
        XCTAssertFalse(composer.sending)
    }
}

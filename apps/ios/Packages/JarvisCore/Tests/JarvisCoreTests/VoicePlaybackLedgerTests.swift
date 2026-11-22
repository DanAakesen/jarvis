import XCTest
@testable import JarvisCore

final class VoicePlaybackLedgerTests: XCTestCase {
    func testAFinishedResponseIsReportedOnceWhenItsLastBufferHasPlayed() {
        var ledger = VoicePlaybackLedger()
        ledger.bufferScheduled(responseID: "a")
        ledger.bufferScheduled(responseID: "a")

        XCTAssertNil(ledger.responseFinished(responseID: "a"))
        XCTAssertNil(ledger.bufferPlayed(responseID: "a"))
        XCTAssertEqual(ledger.bufferPlayed(responseID: "a"), .init(responseID: "a", audible: true))
        XCTAssertNil(ledger.bufferPlayed(responseID: "a"))
    }

    func testAFinishedResponseWithoutAudioIsReportedAsSilent() {
        var ledger = VoicePlaybackLedger()

        XCTAssertEqual(ledger.responseFinished(responseID: "a"), .init(responseID: "a", audible: false))
    }

    func testStoppingPlaybackReportsEveryResponseItHeldExactlyOnce() {
        var ledger = VoicePlaybackLedger()
        ledger.bufferScheduled(responseID: "a")
        XCTAssertNil(ledger.responseFinished(responseID: "a"))
        ledger.bufferScheduled(responseID: "b")

        XCTAssertEqual(ledger.playbackStopped(), [
            .init(responseID: "a", audible: true),
            .init(responseID: "b", audible: true),
        ])
        XCTAssertNil(ledger.bufferPlayed(responseID: "a"))
        XCTAssertEqual(ledger.playbackStopped(), [])
    }

    /// Dan speaks over a new response while an earlier one has been received in full but is still playing out. The
    /// backend cancels the new one and the screen stops the player; the earlier one must not keep the session on
    /// Speaking, whatever order the later events arrive in.
    func testStoppingThePlayerUnderAFinishedResponseDoesNotLeaveTheSessionSpeaking() {
        var machine = VoiceSessionStateMachine()
        var ledger = VoicePlaybackLedger()
        for event in [VoiceSessionEvent.start, .connected, .sessionReady] { machine.apply(event) }

        machine.apply(.responseCreated(id: "a"))
        machine.apply(.audioDelta(responseID: "a"))
        ledger.bufferScheduled(responseID: "a")
        machine.apply(.responseFinished(responseID: "a"))
        XCTAssertNil(ledger.responseFinished(responseID: "a"))
        XCTAssertEqual(machine.state, .speaking)

        machine.apply(.responseCreated(id: "b"))
        machine.apply(.responseCancelled(responseID: "b"))
        for receipt in ledger.playbackStopped() {
            machine.apply(.playbackFinished(responseID: receipt.responseID))
        }
        machine.apply(.activity(.listening))
        XCTAssertEqual(machine.state, .listening)

        // The second report for "a" that its late completion produces changes nothing.
        machine.apply(.responseFinished(responseID: "a"))
        if let receipt = ledger.responseFinished(responseID: "a") {
            machine.apply(.playbackFinished(responseID: receipt.responseID))
        }
        XCTAssertEqual(machine.state, .listening)
    }
}

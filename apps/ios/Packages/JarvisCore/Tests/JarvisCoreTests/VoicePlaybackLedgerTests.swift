import XCTest
@testable import JarvisCore

final class VoicePlaybackLedgerTests: XCTestCase {
    func testAFinishedResponseIsReportedOnceWhenItsLastBufferHasPlayed() {
        var ledger = VoicePlaybackLedger()
        let first = ledger.bufferScheduled(responseID: "a")
        let last = ledger.bufferScheduled(responseID: "a")

        XCTAssertNil(ledger.responseFinished(responseID: "a"))
        XCTAssertEqual(ledger.bufferPlayed(first), [])
        XCTAssertEqual(ledger.bufferPlayed(last), [.init(responseID: "a", audible: true)])
        XCTAssertEqual(ledger.bufferPlayed(last), [])
    }

    func testLaterPlaybackReleasesSpeakingWhenAnEarlierCallbackIsMissing() {
        var machine = VoiceSessionStateMachine()
        var ledger = VoicePlaybackLedger()
        machine.apply(.start)
        machine.apply(.sessionReady)
        var last = 0
        for id in ["first", "second"] {
            machine.apply(.responseCreated(id: id))
            machine.apply(.audioDelta(responseID: id))
            last = ledger.bufferScheduled(responseID: id)
            machine.apply(.responseFinished(responseID: id))
            XCTAssertNil(ledger.responseFinished(responseID: id))
        }
        machine.apply(.activity(.listening))
        XCTAssertEqual(machine.state, .speaking)
        let receipts = ledger.bufferPlayed(last)
        XCTAssertEqual(receipts.map(\.responseID), ["first", "second"])
        for receipt in receipts { machine.apply(.playbackFinished(responseID: receipt.responseID)) }
        XCTAssertEqual(machine.state, .listening)
        XCTAssertTrue(ledger.bufferPlayed(last - 1).isEmpty)
    }

    func testAFinishedResponseWithoutAudioIsReportedAsSilent() {
        var ledger = VoicePlaybackLedger()

        XCTAssertEqual(ledger.responseFinished(responseID: "a"), .init(responseID: "a", audible: false))
    }

    func testStoppingPlaybackReportsEveryResponseItHeldExactlyOnce() {
        var ledger = VoicePlaybackLedger()
        let first = ledger.bufferScheduled(responseID: "a")
        XCTAssertNil(ledger.responseFinished(responseID: "a"))
        ledger.bufferScheduled(responseID: "b")

        XCTAssertEqual(ledger.playbackStopped(), [
            .init(responseID: "a", audible: true),
            .init(responseID: "b", audible: true),
        ])
        XCTAssertTrue(ledger.bufferPlayed(first).isEmpty)
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

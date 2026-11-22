import XCTest
@testable import JarvisCore

final class ChatTurnEndingTests: XCTestCase {
    func testDanStoppingAReplyIsNotAFailureWhateverTheConnectionReportsOnItsWayOut() {
        let stopped = JarvisChatClientError.serverEvent(code: nil, message: "Stopped.")
        XCTAssertEqual(ChatTurnEnding.after(error: stopped, stoppedByUser: true, taskCancelled: false), .stopped)
        XCTAssertEqual(
            ChatTurnEnding.after(error: JarvisClientError.networkFailure, stoppedByUser: true, taskCancelled: false),
            .stopped
        )
    }

    func testATurnCancelledOnThisDeviceIsNotAFailure() {
        XCTAssertEqual(
            ChatTurnEnding.after(error: JarvisClientError.networkFailure, stoppedByUser: false, taskCancelled: true),
            .stopped
        )
        XCTAssertEqual(
            ChatTurnEnding.after(error: CancellationError(), stoppedByUser: false, taskCancelled: false),
            .stopped
        )
    }

    func testARealFailureStaysAFailure() {
        let failed = JarvisChatClientError.serverEvent(code: "pi_failed", message: "I couldn't finish that reply.")
        XCTAssertEqual(ChatTurnEnding.after(error: failed, stoppedByUser: false, taskCancelled: false), .failed)
        XCTAssertEqual(
            ChatTurnEnding.after(error: JarvisClientError.timedOut, stoppedByUser: false, taskCancelled: false),
            .failed
        )
    }
}

final class ChatFailureWordsTests: XCTestCase {
    func testFailureWordsArePlainAndNameNothingInternal() {
        let keys: [JarvisChatLocalizationKey] = [
            .errTurn, .errTurnNotFound, .errReattach, .errGeneric, .errOffline, .errTimedOut,
            .errUnavailable, .errRateLimited, .toolError, .toolRefused,
        ]
        for key in keys {
            let text = JarvisChatLocalization.string(key, language: .en)
            XCTAssertNotEqual(text, key.rawValue, "\(key) has no text")
            XCTAssertNil(
                text.range(of: #"\b(PI|Foundry|gateway|harness|MCP|HTTP)\b|\bturn\b"#, options: [.regularExpression, .caseInsensitive]),
                text
            )
        }
    }

    func testOnlyAFailedTurnSaysFailed() {
        // A tool that did not work is not a failed turn: the reply can still be fine, so the row describes the call.
        XCTAssertEqual(JarvisChatLocalization.string(.toolError, language: .en), "Didn't work")
        XCTAssertEqual(JarvisChatLocalization.string(.toolRefused, language: .en), "Not done")
    }
}

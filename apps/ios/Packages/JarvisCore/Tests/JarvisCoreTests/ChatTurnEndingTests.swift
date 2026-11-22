import Foundation
import XCTest
@testable import JarvisCore

final class ChatTurnEndingTests: XCTestCase {
    func testOnlyTheServerCanConfirmAStop() {
        let stopped = JarvisChatClientError.serverEvent(code: "stopped", message: "Reply stopped.")
        XCTAssertEqual(ChatTurnEnding.after(error: stopped, taskCancelled: false, accepted: true), .stopped)
        XCTAssertEqual(
            ChatTurnEnding.after(error: JarvisClientError.networkFailure, taskCancelled: false, accepted: true),
            .unconfirmed
        )
    }

    func testATurnCancelledOnThisDeviceIsNotAFailure() {
        XCTAssertEqual(
            ChatTurnEnding.after(error: JarvisClientError.networkFailure, taskCancelled: true, accepted: true),
            .detached
        )
        XCTAssertEqual(
            ChatTurnEnding.after(error: CancellationError(), taskCancelled: false, accepted: true),
            .detached
        )
    }

    func testARealFailureStaysAFailure() {
        let failed = JarvisChatClientError.serverEvent(code: nil, message: "I couldn't finish that reply.")
        XCTAssertEqual(ChatTurnEnding.after(error: failed, taskCancelled: false, accepted: true), .failed)
        XCTAssertEqual(failed.serverFailure?.message, "I couldn't finish that reply.")
        XCTAssertEqual(
            ChatTurnEnding.after(error: JarvisClientError.serviceUnavailable, taskCancelled: false, accepted: false),
            .failed
        )
    }

    func testLosingTheReplyCannotEstablishFailureEvenBeforeTheRequestWasAcknowledged() {
        XCTAssertEqual(
            ChatTurnEnding.after(error: JarvisChatClientError.turnNotFound, taskCancelled: false, accepted: true),
            .unconfirmed
        )
        XCTAssertEqual(
            ChatTurnEnding.after(error: JarvisClientError.timedOut, taskCancelled: false, accepted: false),
            .unconfirmed
        )
    }

    func testTestHistoryOnlyConfirmsTheMatchingFinishedReply() throws {
        let request = row("10", role: "dan")
        let fragment = row("11", role: "jarvis", interrupted: true)
        let answer = row("12", role: "jarvis")
        let otherSession = row("13", role: "jarvis", sessionID: "8")
        let nextRequest = row("14", role: "dan")
        let nextAnswer = row("15", role: "jarvis")
        func confirms(_ rows: [[String: Any]]) throws -> Bool {
            let data = try JSONSerialization.data(withJSONObject: ["messages": rows])
            let page = try JSONDecoder().decode(ChatHistoryPage.self, from: data)
            return page.confirmsTestReply(to: "10", sessionID: "7")
        }
        XCTAssertTrue(try confirms([answer, request, fragment, nextRequest, nextAnswer]))
        XCTAssertFalse(try confirms([request, fragment, otherSession, nextRequest, nextAnswer]))
        XCTAssertFalse(try confirms([answer]))
    }

    private func row(_ id: String, role: String, sessionID: String = "7", interrupted: Bool = false) -> [String: Any] {
        ["id": id, "sessionId": sessionID, "channel": "chat", "language": "en", "role": role, "text": "Fixture",
         "at": "2026-11-22T12:00:00Z", "interrupted": interrupted, "toolCalls": [], "attachments": []]
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

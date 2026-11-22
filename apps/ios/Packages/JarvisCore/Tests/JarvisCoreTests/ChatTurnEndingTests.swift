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

    func testLosingTheReplyIsUnconfirmedOnlyAfterTheRequestWasAcknowledged() {
        XCTAssertEqual(
            ChatTurnEnding.after(error: JarvisChatClientError.turnNotFound, taskCancelled: false, accepted: true),
            .unconfirmed
        )
        let lostConnection: [any Error] = [
            JarvisClientError.networkFailure, JarvisClientError.timedOut, JarvisChatClientError.streamEnded,
        ]
        for error in lostConnection {
            XCTAssertEqual(ChatTurnEnding.after(error: error, taskCancelled: false, accepted: true), .unconfirmed)
            XCTAssertEqual(ChatTurnEnding.after(error: error, taskCancelled: false, accepted: false), .failed)
        }
    }

    func testOnlyALinkedCompleteReplyClearsAnUnconfirmedTurnInNormalHistory() throws {
        let request = row("10", role: "dan")
        let proactive = row("11", role: "jarvis")
        let fragment = row("12", role: "jarvis", interrupted: true, replyToTurnID: "10")
        let otherReply = row("13", role: "jarvis", replyToTurnID: "9")
        let reply = row("14", role: "jarvis", replyToTurnID: "10")
        XCTAssertFalse(try history([request, proactive, fragment, otherReply]).confirmsReply(toTurn: "10"))
        // The originating request may no longer be in the latest page.
        XCTAssertTrue(try history([reply]).confirmsReply(toTurn: "10"))
    }

    func testTestHistoryOnlyConfirmsTheMatchingFinishedReply() throws {
        let request = row("10", role: "dan")
        let fragment = row("11", role: "jarvis", interrupted: true)
        let answer = row("12", role: "jarvis")
        let otherSession = row("13", role: "jarvis", sessionID: "8")
        let nextRequest = row("14", role: "dan")
        let nextAnswer = row("15", role: "jarvis")
        func confirms(_ rows: [[String: Any]]) throws -> Bool {
            try history(rows).confirmsTestReply(to: "10", sessionID: "7")
        }
        XCTAssertTrue(try confirms([answer, request, fragment, nextRequest, nextAnswer]))
        XCTAssertFalse(try confirms([request, fragment, otherSession, nextRequest, nextAnswer]))
        XCTAssertFalse(try confirms([answer]))
    }

    private func history(_ rows: [[String: Any]]) throws -> ChatHistoryPage {
        let data = try JSONSerialization.data(withJSONObject: ["messages": rows])
        return try JSONDecoder().decode(ChatHistoryPage.self, from: data)
    }

    private func row(_ id: String, role: String, sessionID: String = "7", interrupted: Bool = false, replyToTurnID: String? = nil) -> [String: Any] {
        var row: [String: Any] = [
            "id": id, "sessionId": sessionID, "channel": "chat", "language": "en", "role": role, "text": "Fixture",
            "at": "2026-11-22T12:00:00Z", "interrupted": interrupted, "toolCalls": [], "attachments": [],
        ]
        row["replyToTurnId"] = replyToTurnID
        return row
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

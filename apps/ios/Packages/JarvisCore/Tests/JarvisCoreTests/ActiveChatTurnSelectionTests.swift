import XCTest
@testable import JarvisCore

final class ActiveChatTurnSelectionTests: XCTestCase {
    func testPrefersActiveTurnForDisplayedSession() {
        let turns = [
            ActiveChatTurn(sessionId: "12", messageId: "40", language: .en),
            ActiveChatTurn(sessionId: "13", messageId: "41", language: .da),
        ]

        XCTAssertEqual(
            ActiveChatTurnSelection.select(turns: turns, forSessionID: "13"),
            turns[1]
        )
    }

    func testFallsBackToFirstTurnWhenDisplayedSessionHasNone() {
        let turns = [
            ActiveChatTurn(sessionId: "12", messageId: "40", language: .en),
            ActiveChatTurn(sessionId: "13", messageId: "41", language: .da),
        ]

        XCTAssertEqual(
            ActiveChatTurnSelection.select(turns: turns, forSessionID: "14"),
            turns[0]
        )
        XCTAssertNil(ActiveChatTurnSelection.select(turns: [], forSessionID: nil))
    }
}

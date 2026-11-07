import XCTest
@testable import JarvisCore

final class DictationSessionTests: XCTestCase {
    func testLateRecognitionCannotRestoreSentDraft() {
        var session = DictationSession()
        let id = session.start(base: "")
        XCTAssertEqual(session.update("Send this", sessionID: id), "Send this")
        session.stop()
        XCTAssertNil(session.update("Send this again", sessionID: id))
        XCTAssertFalse(session.isActive(id))
    }

    func testOldFinalCallbackCannotChangeOrStopNewDictation() {
        var session = DictationSession()
        let old = session.start(base: "Old draft")
        session.stop()
        let current = session.start(base: "Next draft")
        XCTAssertFalse(session.isActive(old))
        XCTAssertNil(session.update("old result", sessionID: old))
        XCTAssertTrue(session.isActive(current))
        XCTAssertEqual(session.update("new words", sessionID: current), "Next draft new words")
    }
}

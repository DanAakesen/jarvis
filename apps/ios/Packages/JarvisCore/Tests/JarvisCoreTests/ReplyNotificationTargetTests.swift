import Foundation
import XCTest
@testable import JarvisCore

final class ReplyNotificationTargetTests: XCTestCase {
    func testDecodesExactNotificationIdentity() throws {
        let target = try XCTUnwrap(JarvisReplyNotificationTarget(userInfo: [
            "sessionID": "41",
            "messageID": "42",
            "kind": "reply",
        ]))

        XCTAssertEqual(target.sessionID, "41")
        XCTAssertEqual(target.messageID, "42")
    }

    func testRejectsMalformedOrMissingIdentity() {
        XCTAssertNil(JarvisReplyNotificationTarget(userInfo: [
            "sessionID": "41",
            "messageID": "0",
        ]))
        XCTAssertNil(JarvisReplyNotificationTarget(userInfo: [
            "proactiveItemID": "9a400b82-bb18-45a6-bb35-e6da757a3d27",
        ]))
        XCTAssertNil(JarvisReplyNotificationTarget(sessionID: "41", messageID: "not-a-message"))
    }

    func testPersistsLatestExactTargetOnly() throws {
        let suiteName = "ReplyNotificationTargetTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let first = try XCTUnwrap(JarvisReplyNotificationTarget(sessionID: "41", messageID: "42"))
        let second = try XCTUnwrap(JarvisReplyNotificationTarget(sessionID: "71", messageID: "72"))

        first.store(in: defaults)
        second.store(in: defaults)

        XCTAssertEqual(JarvisReplyNotificationTarget.pending(in: defaults), second)
        first.clear(in: defaults)
        XCTAssertEqual(JarvisReplyNotificationTarget.pending(in: defaults), second)
        second.clear(in: defaults)
        XCTAssertNil(JarvisReplyNotificationTarget.pending(in: defaults))
    }

    func testMovesOpenedTargetFromPendingToActiveWithoutLosingExactIdentity() throws {
        let suiteName = "ReplyNotificationTargetTests.active.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let target = try XCTUnwrap(JarvisReplyNotificationTarget(sessionID: "41", messageID: "42"))

        target.store(in: defaults)
        target.activate(in: defaults)

        XCTAssertNil(JarvisReplyNotificationTarget.pending(in: defaults))
        XCTAssertEqual(JarvisReplyNotificationTarget.active(in: defaults), target)
        target.clearActive(in: defaults)
        XCTAssertNil(JarvisReplyNotificationTarget.active(in: defaults))
    }
}

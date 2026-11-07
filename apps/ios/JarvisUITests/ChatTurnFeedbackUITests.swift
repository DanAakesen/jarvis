import XCTest
import Darwin

final class ChatTurnFeedbackUITests: XCTestCase {
    func testSteeringClearsComposerOnceKeepsNextDraftAndShowsProgressUntilReply() {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-chat-fixture", "--ui-test-chat-feedback",
                               "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark"]
        app.launch()
        defer { app.terminate() }
        let input = app.descendants(matching: .any)["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Check the synthetic project")
        app.buttons["chat.send"].tap()
        let status = app.descendants(matching: .any)["chat.turn.status"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertTrue(status.isHittable)
        XCTAssertNotEqual(input.value as? String, "Check the synthetic project")
        XCTAssertTrue(app.descendants(matching: .any)["chat.tools.live"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["I’ll check the synthetic project."].exists)
        attach(app, "chat-acknowledgment-live-tools-and-working-state")
        input.tap()
        input.typeText("?")
        app.buttons["chat.send"].tap()
        let question = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ AND label == %@", "chat.message.user", "You: ?"))
        XCTAssertTrue(question.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(question.count, 1)
        XCTAssertLessThan(question.firstMatch.frame.width, 120, "Short bubbles should fit their text")
        XCTAssertNotEqual(input.value as? String, "?")
        XCTAssertTrue(status.exists, "An interrupted round must retain the active turn status")
        input.tap()
        input.typeText("Keep my next draft")
        XCTAssertTrue(status.exists)
        attach(app, "chat-interrupted-turn-still-working-with-next-draft")
        XCTAssertEqual(notify_post("com.jarvis.uitests.finish-chat-feedback"), 0)
        XCTAssertTrue(app.textViews["chat.reply.45"].waitForExistence(timeout: 10))
        XCTAssertEqual(input.value as? String, "Keep my next draft")
        XCTAssertEqual(question.count, 1, "Refreshing persisted history must not duplicate a sent follow-up")
        XCTAssertFalse(status.exists)
        XCTAssertFalse(app.descendants(matching: .any)["chat.tools.live"].exists)
        XCTAssertTrue(app.buttons["chat.tools.45"].exists)
        XCTAssertFalse(app.buttons["chat.tools.42"].exists)
        attach(app, "chat-single-follow-up-compact-bubble-final-tools-and-next-draft")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}

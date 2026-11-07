import XCTest
import CoreFoundation

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
        assertEmpty(input)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Sending keeps the editor focused for a follow-up")
        assertSingleProgress(app)
        XCTAssertFalse(app.textViews["chat.reply.streaming"].exists)
        attach(app, "build79-single-progress-before-acknowledgment-empty-composer")
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(rawValue: "com.jarvis.uitests.acknowledge-chat-feedback" as CFString),
            nil, nil, true
        )
        XCTAssertTrue(app.descendants(matching: .any)["chat.tools.live"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["I’ll check the synthetic project."].exists)
        attach(app, "chat-acknowledgment-live-tools-and-working-state")
        input.tap()
        input.typeText("?")
        let keyboardSend = app.keyboards.buttons.matching(NSPredicate(format: "label == 'Send' OR label == 'send'")).firstMatch
        XCTAssertTrue(keyboardSend.waitForExistence(timeout: 3))
        keyboardSend.tap()
        let question = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ AND label == %@", "chat.message.user", "You: ?"))
        XCTAssertTrue(question.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(question.count, 1)
        XCTAssertLessThan(question.firstMatch.frame.width, 120, "Short bubbles should fit their text")
        assertEmpty(input)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Sending keeps the editor focused for a follow-up")
        assertSingleProgress(app)
        XCTAssertTrue(status.exists, "An interrupted round must retain the active turn status")
        input.tap()
        input.typeText("Keep my next draft")
        XCTAssertTrue(status.exists)
        attach(app, "chat-interrupted-turn-still-working-with-next-draft")
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(rawValue: "com.jarvis.uitests.finish-chat-feedback" as CFString),
            nil, nil, true
        )
        XCTAssertTrue(app.textViews["chat.reply.45"].waitForExistence(timeout: 10))
        XCTAssertEqual(input.value as? String, "Keep my next draft")
        XCTAssertEqual(question.count, 1, "Refreshing persisted history must not duplicate a sent follow-up")
        XCTAssertFalse(status.exists)
        XCTAssertFalse(app.descendants(matching: .any)["chat.tools.live"].exists)
        XCTAssertTrue(app.buttons["chat.tools.45"].exists)
        XCTAssertFalse(app.buttons["chat.tools.42"].exists)
        attach(app, "chat-single-follow-up-compact-bubble-final-tools-and-next-draft")
    }

    private func assertEmpty(_ input: XCUIElement) {
        let empty = NSPredicate(format: "value == '' OR value == 'Ask Jarvis'")
        expectation(for: empty, evaluatedWith: input)
        waitForExpectations(timeout: 3)
    }

    private func assertSingleProgress(_ app: XCUIApplication) {
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "chat.turn.status").count, 1)
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}

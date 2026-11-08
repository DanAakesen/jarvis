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
        assertEmpty(app)
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
        assertEmpty(app)
        attach(app, "chat-keyboard-send-empty-editor-single-follow-up")
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

    func testElapsedHeaderAndOngoingUpdatesFollowTheActiveTurn() {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-chat-fixture", "--ui-test-chat-feedback",
                               "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark"]
        app.launch()
        defer { app.terminate() }
        let input = app.textViews["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Check the project")
        app.buttons["chat.send"].tap()
        let timer = app.staticTexts["chat.turn.elapsed"]
        XCTAssertTrue(timer.waitForExistence(timeout: 5))
        XCTAssertTrue(timer.label.hasPrefix("Working for "))
        let originalTime = timer.label
        let userTime = app.staticTexts["chat.timestamp.42"]
        XCTAssertFalse(userTime.exists)
        app.descendants(matching: .any).matching(identifier: "chat.message.user").firstMatch.tap()
        XCTAssertTrue(userTime.waitForExistence(timeout: 3))
        for name in ["acknowledge-chat-feedback", "progress-chat-feedback"] {
            CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
                CFNotificationName(rawValue: "com.jarvis.uitests.\(name)" as CFString), nil, nil, true)
        }
        let update = app.textViews["chat.reply.update-0"]
        XCTAssertTrue(update.waitForExistence(timeout: 5))
        XCTAssertTrue((update.value as? String ?? "").contains("checking the build setup"))
        XCTAssertNotEqual(timer.label, originalTime, "Elapsed time advances during tool work")
        let status = app.buttons["chat.turn.status"]
        XCTAssertLessThan(timer.frame.minY, update.frame.minY)
        XCTAssertGreaterThan(status.frame.minY, update.frame.minY)
        assertSingleProgress(app)
        attach(app, "chat-working-timer-progress-updates-tools")
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(rawValue: "com.jarvis.uitests.finish-chat-feedback" as CFString), nil, nil, true)
        XCTAssertTrue(app.textViews["chat.reply.45"].waitForExistence(timeout: 8))
        XCTAssertFalse(timer.exists)
        XCTAssertFalse(app.descendants(matching: .any)["chat.tools.live"].exists)
        XCTAssertTrue(app.buttons["chat.tools.45"].exists)
    }

    private func assertEmpty(_ app: XCUIApplication) {
        // Match the native editor and its value in one accessibility query. Three
        // remote reads per predicate poll can exhaust the 3s deadline on the hosted
        // Simulator even when the editor is already empty. Missing views cannot match.
        let emptyInput = app.textViews.matching(NSPredicate(
            format: "identifier == %@ AND (value == nil OR value == '' OR value == %@)",
            "chat.input", "Ask Jarvis"
        )).firstMatch
        XCTAssertTrue(emptyInput.waitForExistence(timeout: 3),
                      "The native composer must be empty after submission")
        XCTAssertTrue(emptyInput.isHittable, "The empty native composer must remain visible")
        let input = app.textViews["chat.input"]
        let evidence = XCTAttachment(string: "exists=\(input.exists); hittable=\(input.isHittable); value=\(String(describing: input.value))")
        evidence.name = "native-composer-empty-state"
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    private func assertSingleProgress(_ app: XCUIApplication) {
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "chat.turn.status").count, 1)
        let transcript = app.scrollViews["chat.transcript"]
        XCTAssertTrue(transcript.exists)
        XCTAssertEqual(transcript.descendants(matching: .any).matching(identifier: "chat.turn.status").count, 1,
                       "Turn progress belongs to the scrolling conversation, not the Now/composer dock")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}

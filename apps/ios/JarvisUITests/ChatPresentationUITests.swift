import XCTest

final class ChatPresentationUITests: XCTestCase {
    private let confirmationID = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

    func testLegacyApprovalDoesNotBlockChatOrAppearInNotifications() {
        for language in ["da", "en"] {
            let app = calendarChangeApp(language: language, appearance: "light", openSheet: true)
            app.launch()
            XCTAssertTrue(app.descendants(matching: .any)["notifications.hero"].waitForExistence(timeout: 10))
            XCTAssertFalse(app.staticTexts["confirmation-section-heading"].exists)
            XCTAssertFalse(app.buttons["confirmation-approve-\(confirmationID)"].exists)
            app.buttons["chat.notifications.done"].tap()
            XCTAssertTrue(app.buttons["chat.notifications"].waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["now-confirmation-approve-\(confirmationID)"].exists)
            XCTAssertFalse(app.buttons["now-confirmation-decline-\(confirmationID)"].exists)
            app.terminate()
        }
    }

    func testCompletedJobsHideNowBarAndAwayModeInBothLanguages() {
        for language in ["en", "da"] {
            let app = XCUIApplication()
            app.launchArguments = ["--screenshot-chat-fixture", "--screenshot-activity-state=empty", "-jarvis.appLanguage", language,
                                   "-jarvis.appTheme", language == "en" ? "dark" : "light"]
            app.launch()
            let hero = app.descendants(matching: .any)["notifications.hero"]
            XCTAssertTrue(hero.waitForExistence(timeout: 10))
            XCTAssertTrue(hero.isHittable, "The empty Notifications view must be visible above the gate")
            XCTAssertFalse(app.staticTexts["Away mode"].exists)
            XCTAssertFalse(app.staticTexts["Fraværstilstand"].exists)
            let empty = XCTAttachment(screenshot: app.screenshot())
            empty.name = "notifications-empty-\(language)"
            empty.lifetime = .keepAlways
            add(empty)
            app.buttons["chat.notifications.done"].tap()
            XCTAssertTrue(app.buttons["chat.notifications"].waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["chat.now"].exists, "Finished jobs and Away mode must not create an empty bar")
            let chat = XCTAttachment(screenshot: app.screenshot())
            chat.name = "chat-without-empty-now-bar-\(language)"
            chat.lifetime = .keepAlways
            add(chat)
            app.terminate()
        }
    }

    private func calendarChangeApp(language: String, appearance: String, openSheet: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        // Foundation launch overrides use the argument domain, not persisted preferences.
        app.launchArguments = [
            "--screenshot-calendar-change-fixture",
            "-jarvis.appLanguage", language,
            "-jarvis.appTheme", appearance,
        ]
        if openSheet { app.launchArguments.append("--screenshot-notifications-open") }
        return app
    }

    func testCalendarReplyAndToolStatusShareTheJarvisLeadingEdge() {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-chat-fixture", "-jarvis.appTheme", "dark"]
        app.launch()

        let reply = app.textViews["chat.reply.413"]
        XCTAssertTrue(reply.waitForExistence(timeout: 10))
        let text = reply.value as? String ?? reply.label
        for expected in ["Calendar for the next 30 days", "You have 3 important events:",
                         "Monday, 2 November · 09:00–09:30", "Product review",
                         "Wednesday, 11 November · 14:00–15:00", "Dentist appointment",
                         "Friday, 20 November · 10:00–11:00", "Quarterly planning"] {
            XCTAssertTrue(text.contains(expected), "Missing formatted reply content: \(expected)")
        }
        XCTAssertTrue(text.contains("\n"), "Markdown paragraphs remain separate in one selectable reply")
        XCTAssertFalse(text.contains("**"))
        let timestamp = app.staticTexts["chat.timestamp.413"]
        XCTAssertFalse(timestamp.exists, "Timestamps stay hidden until the message is tapped")
        reply.tap()
        XCTAssertTrue(timestamp.waitForExistence(timeout: 3))
        reply.tap()
        XCTAssertFalse(timestamp.exists)
        let tools = app.buttons["chat.tools.413"]
        XCTAssertTrue(tools.exists)
        XCTAssertEqual(tools.frame.minX, reply.frame.minX, accuracy: 2)
        XCTAssertGreaterThan(tools.frame.minY, reply.frame.maxY)
        XCTAssertFalse(app.staticTexts["get calendar events"].exists)
        tools.tap()
        XCTAssertTrue(app.staticTexts["get calendar events"].waitForExistence(timeout: 3))
        tools.tap()
        XCTAssertFalse(app.staticTexts["get calendar events"].exists)
        let layout = XCTAttachment(screenshot: app.screenshot())
        layout.name = "chat-reply-time-and-tools-spacing"
        layout.lifetime = .keepAlways
        add(layout)
        // The whole-view center lands after the short "Product review" line.
        // Press a word in the first heading, as an owner selecting text would.
        reply.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0))
            .withOffset(CGVector(dx: 0, dy: 12)).press(forDuration: 1.2)
        XCTAssertFalse(timestamp.exists, "A selection gesture must not reveal the timestamp")
        XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5), "Native text selection must expose Copy")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "chat-native-reply-selection-and-collapsed-tools"
        capture.lifetime = .keepAlways
        add(capture)
        app.terminate()
    }

}

import XCTest

final class ChatPresentationUITests: XCTestCase {
    private let confirmationID = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

    func testCalendarChangeSheetShowsFullReviewAndLocalizedControls() {
        for language in ["da", "en"] {
            for appearance in ["light", "dark"] {
                let app = calendarChangeApp(language: language, appearance: appearance, openSheet: true)
                app.launch()

                let review = app.staticTexts["confirmation-review-\(confirmationID)"]
                XCTAssertTrue(review.waitForExistence(timeout: 10))
                let expectedReview = language == "da"
                    ? "Syntetisk eksempel — ingen kalenderændringer.\nFlyt mødet:\n• Titel: Produktgennemgang\n• Fra: 2. november 2026, 09:00–09:30\n• Til: 2. november 2026, 10:00–10:30\n• Tidszone: Europe/Copenhagen"
                    : "Synthetic preview — no calendar writes.\nReschedule the meeting:\n• Title: Product review\n• From: 2 November 2026, 09:00–09:30\n• To: 2 November 2026, 10:00–10:30\n• Time zone: Europe/Copenhagen"
                XCTAssertEqual(review.label, expectedReview)
                XCTAssertTrue(review.isHittable)
                XCTAssertEqual(app.staticTexts["confirmation-section-heading"].label,
                               language == "da" ? "Afventer godkendelse" : "Pending confirmations")
                XCTAssertEqual(app.staticTexts["confirmation-kind-\(confirmationID)"].label,
                               language == "da" ? "Kalenderændring" : "Calendar change")
                XCTAssertTrue(app.staticTexts["confirmation-expiry-\(confirmationID)"].label
                    .hasPrefix(language == "da" ? "Udløber kl." : "Expires at"))
                let fixtureReason = app.staticTexts["confirmation-fixture-reason"]
                XCTAssertEqual(fixtureReason.label, language == "da"
                    ? "Godkendelse er deaktiveret med eksempeldata."
                    : "Approval actions are disabled with fixture data.")
                XCTAssertTrue(fixtureReason.isHittable)

                let decline = app.buttons["confirmation-decline-\(confirmationID)"]
                let approve = app.buttons["confirmation-approve-\(confirmationID)"]
                assertLocalizedControls(decline: decline, approve: approve, language: language)
                for element in [review, decline, approve, fixtureReason] {
                    XCTAssertFalse(element.frame.isEmpty)
                    XCTAssertTrue(app.windows.firstMatch.frame.contains(element.frame),
                                  "The full review and both controls must fit on screen.")
                }
                XCTAssertGreaterThan(decline.frame.minY, review.frame.maxY)
                XCTAssertGreaterThan(approve.frame.minY, review.frame.maxY)

                let screenshot = XCTAttachment(screenshot: app.screenshot())
                screenshot.name = "calendar-change-confirmation-\(language)-\(appearance).png"
                screenshot.lifetime = .keepAlways
                add(screenshot)
                app.terminate()
            }
        }
    }

    func testCalendarChangeNowBarUsesLocalizedControls() {
        for language in ["da", "en"] {
            let app = calendarChangeApp(language: language, appearance: "light", openSheet: false)
            app.launch()
            let decline = app.buttons["now-confirmation-decline-\(confirmationID)"]
            let approve = app.buttons["now-confirmation-approve-\(confirmationID)"]
            XCTAssertTrue(approve.waitForExistence(timeout: 10))
            assertLocalizedControls(decline: decline, approve: approve, language: language)
            XCTAssertTrue(app.buttons["chat.now"].exists, "Pending approvals keep the activity bar visible")
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

    private func assertLocalizedControls(decline: XCUIElement, approve: XCUIElement, language: String) {
        XCTAssertTrue(decline.exists)
        XCTAssertTrue(approve.exists)
        XCTAssertEqual(decline.label, language == "da" ? "Afvis" : "Decline")
        XCTAssertEqual(approve.label, language == "da" ? "Godkend" : "Approve")
        XCTAssertFalse(decline.isEnabled, "Synthetic fixtures must not execute calendar writes.")
        XCTAssertFalse(approve.isEnabled, "Synthetic fixtures must not execute calendar writes.")
        for button in [decline, approve] {
            XCTAssertGreaterThanOrEqual(button.frame.width, 44)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44)
        }
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
        reply.press(forDuration: 1.2)
        XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5), "Native text selection must expose Copy")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "chat-native-reply-selection-and-collapsed-tools"
        capture.lifetime = .keepAlways
        add(capture)
        app.terminate()
    }

}

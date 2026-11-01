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
        app.launchArguments = ["--screenshot-chat-fixture"]
        app.launch()

        let heading = markdownBlock(in: app, messageID: "413", index: 0)
        let introduction = markdownBlock(in: app, messageID: "413", index: 1)
        let productReview = markdownBlock(in: app, messageID: "413", index: 2)
        let dentistAppointment = markdownBlock(in: app, messageID: "413", index: 3)
        let quarterlyPlanning = markdownBlock(in: app, messageID: "413", index: 4)

        XCTAssertTrue(heading.waitForExistence(timeout: 10))
        XCTAssertEqual(heading.label, "Calendar for the next 30 days")
        XCTAssertEqual(introduction.label, "You have 3 important events:")
        XCTAssertEqual(productReview.label, "Monday, 2 November · 09:00–09:30 — Product review")
        XCTAssertEqual(dentistAppointment.label, "Wednesday, 11 November · 14:00–15:00 — Dentist appointment")
        XCTAssertEqual(quarterlyPlanning.label, "Friday, 20 November · 10:00–11:00 — Quarterly planning")

        let blocks = [heading, introduction, productReview, dentistAppointment, quarterlyPlanning]
        for (previous, next) in zip(blocks, blocks.dropFirst()) {
            XCTAssertGreaterThan(
                next.frame.minY,
                previous.frame.maxY + 4,
                "Markdown blocks should have visible vertical separation."
            )
        }

        let toolStatus = app.descendants(matching: .any)
            .matching(NSPredicate(
                format: "label CONTAINS[c] %@ AND label CONTAINS[c] %@",
                "get calendar events",
                "ok"
            ))
            .firstMatch
        XCTAssertTrue(toolStatus.exists)
        XCTAssertEqual(toolStatus.frame.minX, heading.frame.minX, accuracy: 2)
    }

    private func markdownBlock(in app: XCUIApplication, messageID: String, index: Int) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(identifier: "chat-markdown-block-\(messageID)-\(index)")
            .firstMatch
    }
}

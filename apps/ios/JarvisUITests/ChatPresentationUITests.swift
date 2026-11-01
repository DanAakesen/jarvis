import XCTest

final class ChatPresentationUITests: XCTestCase {
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

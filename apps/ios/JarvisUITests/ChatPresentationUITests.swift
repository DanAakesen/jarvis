import XCTest

final class ChatPresentationUITests: XCTestCase {
    func testCalendarReplyAndToolStatusShareTheJarvisLeadingEdge() {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-chat-fixture"]
        app.launch()

        let reply = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "Calendar for the next 30 days"))
            .firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 10))

        let event = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "Quarterly planning"))
            .firstMatch
        XCTAssertTrue(event.exists)

        let toolStatus = app.descendants(matching: .any)
            .matching(NSPredicate(
                format: "label CONTAINS[c] %@ AND label CONTAINS[c] %@",
                "get calendar events",
                "ok"
            ))
            .firstMatch
        XCTAssertTrue(toolStatus.exists)
        XCTAssertEqual(toolStatus.frame.minX, reply.frame.minX, accuracy: 2)
    }
}

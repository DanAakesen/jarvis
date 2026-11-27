import XCTest

final class DrawerProof: XCTestCase {
    func testOpenFromHomeAndNotesBySwiping() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-navigation", "--ui-test-today"]
        app.launch()
        let notes = app.buttons["navigation.notes"]
        let home = app.buttons["navigation.today"]
        func openDrawer() {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.50))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.27, dy: 0.51))
            start.press(forDuration: 0.08, thenDragTo: end)
        }
        XCTAssertTrue(app.staticTexts["Home"].firstMatch.waitForExistence(timeout: 25))
        XCTAssertFalse(notes.exists)
        openDrawer()
        XCTAssertTrue(notes.waitForExistence(timeout: 8))
        notes.tap()
        XCTAssertTrue(app.staticTexts["Notes"].firstMatch.waitForExistence(timeout: 8))
        XCTAssertFalse(home.exists)
        openDrawer()
        XCTAssertTrue(home.waitForExistence(timeout: 8))
        home.tap()
        XCTAssertTrue(app.staticTexts["Home"].firstMatch.waitForExistence(timeout: 8))
    }
}

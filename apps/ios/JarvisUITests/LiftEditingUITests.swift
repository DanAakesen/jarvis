import XCTest

final class LiftEditingUITests: XCTestCase {
    func testTapEditAndProgressiveIconSwipePersistChanges() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-navigation", "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.tap()
        app.buttons["navigation.health"].tap()
        let id = "health.lift.00000000-0000-4000-8000-000000000000"
        let row = app.buttons[id]
        for _ in 0..<8 {
            if row.isHittable && row.frame.maxY < app.frame.maxY - 180 { break }
            app.swipeUp(velocity: .slow)
        }
        XCTAssertTrue(row.isHittable)
        row.tap()
        let weight = app.textFields["health.lift.edit.weight"]
        XCTAssertTrue(weight.waitForExistence(timeout: 5))
        XCTAssertEqual(weight.value as? String, "80")
        // Trailing-aligned values need an end-of-text tap, as in SettingsFieldUITests.
        // A center tap put the cursor before 80 and the previous attempt entered 82.580.
        weight.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5))
            .withOffset(CGVector(dx: -1, dy: 0)).tap()
        weight.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2) + "82.5")
        XCTAssertEqual(weight.value as? String, "82.5")
        capture(app, "lift-populated-editor")
        app.buttons["sheet.confirm"].tap()
        // Disabled fields can disappear from AX while Save is still running.
        XCTAssertTrue(app.staticTexts["Edit lift"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let updated = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in row.label.contains("82.5") }, object: row
        )
        XCTAssertEqual(XCTWaiter.wait(for: [updated], timeout: 5), .completed,
                       "Updated value must come back from the fixture store")
        row.tap()
        XCTAssertTrue(weight.waitForExistence(timeout: 5))
        XCTAssertEqual(weight.value as? String, "82.5", "Reopening must load the saved lift")
        app.buttons["sheet.cancel"].tap()
        XCTAssertTrue(app.staticTexts["Edit lift"].waitForNonExistence(timeout: 5))
        // First detent exposes only Edit; a second short drag exposes Delete.
        drag(row, distance: 65)
        let edit = app.buttons[id + ".edit"]
        let delete = app.buttons[id + ".delete"]
        XCTAssertTrue(edit.isHittable)
        XCTAssertFalse(delete.isHittable)
        capture(app, "lift-short-swipe-edit")
        drag(row, distance: 65)
        XCTAssertTrue(delete.isHittable)
        XCTAssertTrue(row.exists, "Revealing Delete must not perform deletion")
        capture(app, "lift-long-swipe-edit-delete")
        delete.tap()
        XCTAssertTrue(row.waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.buttons["health.lift.00000000-0000-4000-8000-000000000001"].exists)
        capture(app, "lift-deleted")
    }

    private func drag(_ row: XCUIElement, distance: CGFloat) {
        let start = row.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: -distance, dy: 0)), withVelocity: .slow, thenHoldForDuration: 0.2)
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }
}

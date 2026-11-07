import XCTest

final class SettingsFieldUITests: XCTestCase {
    func testPersistentTargetLabelsDarkEnglish() { targets(language: "en", large: false) }
    func testPersistentTargetLabelsLightDanish() { targets(language: "da", large: false) }
    func testPersistentTargetLabelsAccessibility() { targets(language: "en", large: true) }

    private func targets(language: String, large: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-settings-fixture", "-jarvis.appLanguage", language,
            "-jarvis.appTheme", language == "en" ? "dark" : "light"] +
            (large ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["settings.section.health"].waitForExistence(timeout: 10))
        app.buttons["settings.section.health"].tap()
        app.descendants(matching: .any)["settings.row.training"].tap()
        for key in ["gymSessionsPerWeek", "runSessionsPerWeek", "dailySteps"] {
            let label = app.staticTexts["settings.target.\(key).label"]
            let input = app.textFields["settings.target.\(key)"]
            XCTAssertTrue(label.waitForExistence(timeout: 10))
            if !label.isHittable { app.swipeUp() }
            XCTAssertTrue(label.isHittable)
            XCTAssertFalse(label.label.isEmpty)
            XCTAssertFalse(label.frame.intersects(input.frame), "Label and value must have distinct space")
            XCTAssertLessThanOrEqual(label.frame.maxX, app.windows.firstMatch.frame.maxX - 12)
        }
        attach(app, "settings-labelled-targets-\(language)-large-\(large)")
        guard !large else { return }
        let field = app.textFields["settings.target.gymSessionsPerWeek"]
        field.tap()
        field.typeText(XCUIKeyboardKey.delete.rawValue + "99")
        XCTAssertTrue(app.staticTexts["settings.target.gymSessionsPerWeek.label"].isHittable)
        let save = app.buttons["sheet.confirm"]
        XCTAssertFalse(save.isEnabled, "Existing target bounds must still reject 99 sessions")
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2) + "5")
        XCTAssertTrue(save.isEnabled)
        save.tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == false"), object: save)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 5), .completed)
        XCTAssertEqual(field.value as? String, "5")
    }

    func testGenericNumericAndMultilineSettingsKeepVisibleLabels() {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-settings-fixture", "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark"]
        app.launch()
        defer { app.terminate() }
        let identity = app.descendants(matching: .any)["settings.row.identity"]
        XCTAssertTrue(identity.waitForExistence(timeout: 10))
        if !identity.isHittable { app.swipeUp() }
        identity.tap()
        XCTAssertTrue(app.staticTexts["settings.field.identity.description.label"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["settings.field.identity.description"].exists)
        attach(app, "settings-labelled-identity")
        app.navigationBars.buttons.firstMatch.tap()
        let research = app.descendants(matching: .any)["settings.row.research"]
        if !research.isHittable { app.swipeUp() }
        research.tap()
        let label = app.staticTexts["settings.field.research.maxSources.label"]
        XCTAssertTrue(label.waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["settings.field.research.maxSources"].value as? String, "5")
        XCTAssertTrue(label.isHittable)
        attach(app, "settings-labelled-research")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}

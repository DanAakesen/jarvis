import XCTest

final class SettingsFieldUITests: XCTestCase {
    func testPersistentTargetLabelsDarkEnglish() { targets(language: "en", large: false) }
    func testPersistentTargetLabelsLightDanish() { targets(language: "da", large: false) }
    func testPersistentTargetLabelsAccessibility() { targets(language: "en", large: true) }

    private func targets(language: String, large: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-navigation", "--screenshot-settings-fixture", "-jarvis.appLanguage", language,
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
        replaceValue(in: field, with: "99")
        XCTAssertEqual(field.value as? String, "99")
        XCTAssertTrue(app.staticTexts["settings.target.gymSessionsPerWeek.label"].isHittable)
        let save = app.buttons["sheet.confirm"]
        XCTAssertFalse(save.isEnabled, "Existing target bounds must still reject 99 sessions")
        replaceValue(in: field, with: "5")
        XCTAssertEqual(field.value as? String, "5")
        XCTAssertTrue(save.isEnabled)
        save.tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == false"), object: save)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 5), .completed)
        XCTAssertEqual(field.value as? String, "5")
    }

    func testGenericNumericAndMultilineSettingsKeepVisibleLabels() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-navigation", "--screenshot-settings-fixture", "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark"]
        app.launch()
        defer { app.terminate() }
        let identity = app.descendants(matching: .any)["settings.row.instructions"]
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

    func testStaticSettingsStructureAndLocalLanguageBeforeDataArrives() {
        let app = loadingFixture(arguments: ["--settings-fixture-slow"])
        defer { app.terminate() }
        let language = app.descendants(matching: .any)["settings.row.language"]
        XCTAssertTrue(language.waitForExistence(timeout: 2))
        XCTAssertTrue(app.buttons["settings.section.general"].exists)
        XCTAssertTrue(app.buttons["settings.section.health"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["settings.row.appearance"].exists)
        XCTAssertTrue(app.textFields["settings.search"].exists)
        language.tap()
        XCTAssertTrue(app.staticTexts["English"].waitForExistence(timeout: 2))
        attach(app, "settings-local-language-during-first-load")
    }

    func testTargetLabelsRemainVisibleDuringFirstLoadAndFailureThenRetry() {
        let app = loadingFixture(arguments: ["--settings-fixture-slow", "--settings-fixture-first-read-fails"])
        defer { app.terminate() }
        let health = app.buttons["settings.section.health"]
        XCTAssertTrue(health.waitForExistence(timeout: 2))
        health.tap()
        app.descendants(matching: .any)["settings.row.training"].tap()
        let field = app.textFields["settings.target.gymSessionsPerWeek"]
        XCTAssertTrue(field.waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["settings.target.gymSessionsPerWeek.label"].exists)
        XCTAssertFalse(field.isEnabled)
        XCTAssertFalse(app.buttons["sheet.confirm"].isEnabled)
        attach(app, "settings-target-first-load")
        let retry = app.buttons["Retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["settings.target.gymSessionsPerWeek.label"].exists)
        retry.tap()
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '4'"), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 8), .completed)
        XCTAssertTrue(field.isEnabled)
        attach(app, "settings-target-recovered")
    }

    func testFailedRootRefreshRetainsRowsAndOffersRetry() {
        let app = loadingFixture(arguments: ["--settings-fixture-refresh-fails"])
        defer { app.terminate() }
        let appearance = app.descendants(matching: .any)["settings.row.appearance"]
        XCTAssertTrue(appearance.waitForExistence(timeout: 5))
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: appearance)
        XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 5), .completed)
        let list = app.collectionViews.firstMatch
        list.swipeDown()
        XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 8))
        XCTAssertTrue(appearance.exists)
        XCTAssertTrue(appearance.isEnabled)
        XCTAssertTrue(app.buttons["settings.section.models"].exists)
        attach(app, "settings-retained-after-refresh-failure")
    }

    func testMemorySearchHidesPreviousContextBeforeNewResultsArrive() {
        let app = loadingFixture(arguments: ["--settings-fixture-slow", "--settings-fixture-memory"])
        defer { app.terminate() }
        let memory = app.descendants(matching: .any)["settings.row.memory"]
        XCTAssertTrue(app.buttons["settings.section.general"].waitForExistence(timeout: 5))
        if !memory.exists { app.swipeUp() }
        XCTAssertTrue(memory.waitForExistence(timeout: 5))
        if !memory.isHittable { app.swipeUp() }
        memory.tap()
        XCTAssertTrue(app.staticTexts["Fixture memory"].waitForExistence(timeout: 8))
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        search.tap()
        search.typeText("missing")
        XCTAssertFalse(app.staticTexts["Fixture memory"].exists)
        XCTAssertTrue(app.staticTexts["No memories"].waitForExistence(timeout: 8))
        attach(app, "settings-memory-empty-query-context")
    }

    private func loadingFixture(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-navigation", "--screenshot-settings-fixture",
                               "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark"] + arguments
        app.launch()
        return app
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }

    private func replaceValue(in field: XCUIElement, with value: String) {
        let current = field.value as? String ?? ""
        // Values are trailing-aligned. Tap beyond the final digit so deletion
        // starts at the end instead of inserting before the existing number.
        field.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5))
            .withOffset(CGVector(dx: -1, dy: 0)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count) + value)
    }
}

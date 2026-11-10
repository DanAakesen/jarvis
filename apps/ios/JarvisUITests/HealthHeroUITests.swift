import XCTest

/// The Health hero carousel runs on the deterministic fixture transport (`--ui-test-navigation`).
final class HealthHeroUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func openHealth(language: String, arguments: [String] = []) {
        app.launchArguments = [
            "--ui-test-navigation",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ] + arguments
        app.launch()
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 8))
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let item = app.buttons["navigation.health"]
        XCTAssertTrue(item.waitForExistence(timeout: 3))
        item.tap()
    }

    private func attach(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testTrainingHeroIsTheFirstPage() {
        openHealth(language: "en")
        defer { app.terminate() }
        XCTAssertTrue(element("health.hero.training").waitForExistence(timeout: 8))
        XCTAssertTrue(element("health.hero.dots").exists)
        attach("health-hero-training")
    }

    func testSleepHeroShowsStagesAndAChartWithTapToSelect() {
        openHealth(language: "en")
        defer { app.terminate() }
        XCTAssertTrue(element("health.hero.training").waitForExistence(timeout: 8))
        let chart = element("health.chart.sleep")
        for _ in 0..<2 where !chart.exists { app.swipeLeft() }
        XCTAssertTrue(chart.waitForExistence(timeout: 4))
        XCTAssertTrue(element("health.chart.sleep.target").exists)
        let headline = element("health.chart.sleep.headline")
        let average = headline.label
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7)).tap()
        let changed = NSPredicate { _, _ in headline.label != average }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: changed, object: nil)], timeout: 4), .completed)
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7)).tap()
        let restored = NSPredicate { _, _ in headline.label == average }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: restored, object: nil)], timeout: 4), .completed)
        attach("health-hero-sleep")
    }

    func testNutritionHeroShowsProteinChartInDanish() {
        openHealth(language: "da")
        defer { app.terminate() }
        XCTAssertTrue(element("health.hero.training").waitForExistence(timeout: 8))
        let chart = element("health.chart.protein")
        for _ in 0..<3 where !chart.exists { app.swipeLeft() }
        XCTAssertTrue(chart.waitForExistence(timeout: 4))
        XCTAssertTrue(element("health.chart.protein.target").exists)
        attach("health-hero-nutrition")
    }

    func testStaticStructureAndControlsPrecedeSlowHealthSources() {
        openHealth(language: "en", arguments: ["--ui-test-health-loading"])
        defer { app.terminate() }
        XCTAssertTrue(element("health.hero.training").waitForExistence(timeout: 2))
        XCTAssertTrue(element("health.mode.0").exists)
        XCTAssertTrue(element("health.mode.1").exists)
        XCTAssertTrue(element("health.search").exists)
        XCTAssertTrue(element("health.plus").exists)
        XCTAssertTrue(element("health.chart.steps").exists)
        XCTAssertEqual(element("health.training.donut").value as? String, "Unavailable")
        attach("health-loading-static-structure")

        let trainingReady = NSPredicate { _, _ in
            let value = self.element("health.training.donut").value as? String
            return value != nil && value != "Unavailable"
        }
        XCTAssertEqual(XCTWaiter.wait(for: [
            XCTNSPredicateExpectation(predicate: trainingReady, object: nil),
        ], timeout: 7), .completed)
        XCTAssertFalse(element("health.chart.steps.target").exists)
        XCTAssertTrue(element("health.hero.dots").exists)
        attach("health-independent-training-before-sleep-and-targets")
    }

    func testFailedRefreshRetainsHeroAndCanRetry() {
        openHealth(language: "en", arguments: ["--ui-test-health-refresh-failure"])
        defer { app.terminate() }
        let donut = element("health.training.donut")
        XCTAssertTrue(donut.waitForExistence(timeout: 8))
        let loaded = NSPredicate { _, _ in
            let value = donut.value as? String
            return value != nil && value != "Unavailable"
        }
        XCTAssertEqual(XCTWaiter.wait(for: [
            XCTNSPredicateExpectation(predicate: loaded, object: nil),
        ], timeout: 8), .completed)
        let original = donut.value as? String
        app.scrollViews.firstMatch.swipeDown()
        let failure = app.descendants(matching: .any).matching(identifier: "health.failure").firstMatch
        XCTAssertTrue(failure.waitForExistence(timeout: 8))
        XCTAssertEqual(donut.value as? String, original)
        XCTAssertTrue(element("health.search").exists)
        attach("health-failed-refresh-retains-training")
        let retry = app.buttons["Try again"].firstMatch
        XCTAssertTrue(retry.waitForExistence(timeout: 4))
        let retryEnabled = NSPredicate { _, _ in retry.isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [
            XCTNSPredicateExpectation(predicate: retryEnabled, object: nil),
        ], timeout: 8), .completed)
        retry.tap()
        XCTAssertEqual(donut.value as? String, original)
        let recovered = NSPredicate { _, _ in !failure.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [
            XCTNSPredicateExpectation(predicate: recovered, object: nil),
        ], timeout: 8), .completed)
    }

    func testTrackWorkoutSectionsExistBeforeCapabilitiesLoad() {
        openHealth(language: "en", arguments: ["--ui-test-health-loading"])
        defer { app.terminate() }
        let track = element("health.mode.1")
        XCTAssertTrue(track.waitForExistence(timeout: 2))
        track.tap()
        XCTAssertTrue(app.staticTexts["Exercises"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["History"].exists)
        XCTAssertTrue(element("health.search").exists)
        XCTAssertFalse(app.staticTexts["No lifts logged"].exists)
        XCTAssertFalse(app.staticTexts["No results"].exists)
        XCTAssertFalse(app.staticTexts["Health data could not be loaded"].exists)
        attach("health-track-loading-static-structure")

        let row = app.buttons["health.lift.exercise.00000000-0000-4000-8000-000000000000"]
        XCTAssertTrue(row.waitForExistence(timeout: 8))
        let search = app.textFields["health.search"]
        search.tap()
        search.typeText("No matching exercise")
        XCTAssertTrue(app.staticTexts["No results"].firstMatch.waitForExistence(timeout: 3))
        XCTAssertFalse(row.exists)
        XCTAssertFalse(app.staticTexts["No lifts logged"].exists)
        XCTAssertFalse(app.staticTexts["Health data could not be loaded"].exists)
        XCTAssertTrue(app.staticTexts["Exercises"].exists)
        XCTAssertTrue(app.staticTexts["History"].exists)
        attach("health-track-no-search-results")
    }
}

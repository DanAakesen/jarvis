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

    private func openHealth(language: String) {
        app.launchArguments = [
            "--ui-test-navigation",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
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
}

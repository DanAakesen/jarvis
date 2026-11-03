import XCTest

/// Usage, Status and Proactive run on the deterministic fixture transport (`--ui-test-navigation`); nothing polls.
final class InsightsPagesTests: XCTestCase {
    private let app = XCUIApplication()
    private let firstItem = "6f1c0d5a-0b0e-4d6b-9d0e-000000000001"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// A tab of the shared tab strip: its identifier starts with the strip's prefix and its label is the tab title.
    private func tab(_ prefix: String, _ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@", prefix + ".", label)).firstMatch
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func open(_ destination: String, language: String = "en", extra: [String] = []) {
        app.launchArguments = [
            "--ui-test-navigation",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ] + extra
        app.launch()
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 8))
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let item = app.buttons["navigation.\(destination)"]
        XCTAssertTrue(item.waitForExistence(timeout: 3))
        item.tap()
    }

    func testUsageOpensFromSidebarAndSwitchesRange() {
        open("usage")
        defer { app.terminate() }
        let total = element("usage.total")
        XCTAssertTrue(total.waitForExistence(timeout: 8))
        let thirtyDays = total.label
        let range = tab("usage.range", "7 d")
        XCTAssertTrue(range.waitForExistence(timeout: 3))
        range.tap()
        let changed = NSPredicate { _, _ in self.element("usage.total").label != thirtyDays }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: changed, object: nil)], timeout: 6),
            .completed,
            "Switching the period must reload the report"
        )
        XCTAssertTrue(element("usage.topTasks").exists)
    }

    func testUsageShowsErrorWithRetry() {
        open("usage", extra: ["--ui-test-insights=error"])
        defer { app.terminate() }
        XCTAssertTrue(element("usage.error").waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["usage.error.retry"].exists)
    }

    func testStatusFilterAndExpand() {
        open("status")
        defer { app.terminate() }
        let database = element("status.row.database")
        XCTAssertTrue(database.waitForExistence(timeout: 8))
        let filter = tab("status.filter", "Issues")
        XCTAssertTrue(filter.exists)
        filter.tap()
        let hidden = NSPredicate { _, _ in !self.element("status.row.database").exists }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: hidden, object: nil)], timeout: 6),
            .completed,
            "The Issues filter must hide healthy checks"
        )
        let google = element("status.row.google")
        XCTAssertTrue(google.exists)
        XCTAssertFalse(element("status.reason.google").exists)
        google.tap()
        XCTAssertTrue(element("status.reason.google").waitForExistence(timeout: 3))
    }

    func testStatusOpensInDanish() {
        open("status", language: "da")
        defer { app.terminate() }
        XCTAssertTrue(element("status.row.database").waitForExistence(timeout: 8))
        XCTAssertTrue(tab("status.filter", "Problemer").exists)
    }

    func testProactiveTabsSwitchBetweenOpenAndEarlier() {
        open("proactive")
        defer { app.terminate() }
        XCTAssertTrue(element("proactive.item.\(firstItem)").waitForExistence(timeout: 8))
        let earlier = tab("proactive.tabs", "Earlier")
        XCTAssertTrue(earlier.exists)
        earlier.tap()
        let gone = NSPredicate { _, _ in !self.element("proactive.item.\(self.firstItem)").exists }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: gone, object: nil)], timeout: 6),
            .completed,
            "The Earlier tab must hide open suggestions"
        )
        tab("proactive.tabs", "Open").tap()
        XCTAssertTrue(element("proactive.item.\(firstItem)").waitForExistence(timeout: 6))
    }

    func testSettingsEditorSavesBudgetAndUpdatesTheBudgetCard() {
        open("proactive")
        defer { app.terminate() }
        XCTAssertTrue(element("proactive.budget").waitForExistence(timeout: 8))
        let before = element("proactive.budget").label
        app.buttons["proactive.settings"].tap()
        let budget = app.textFields["proactive.edit.budget"]
        XCTAssertTrue(budget.waitForExistence(timeout: 4))
        budget.tap()
        budget.clearText()
        budget.typeText("80")
        app.buttons["sheet.confirm"].tap()
        let closed = NSPredicate { _, _ in !self.element("proactive.edit.sheet").exists }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: closed, object: nil)], timeout: 8),
            .completed,
            "A saved editor must close"
        )
        let updated = NSPredicate { _, _ in self.element("proactive.budget").label != before }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: updated, object: nil)], timeout: 8),
            .completed,
            "The Budget card must show the saved limit"
        )
    }

    func testSettingsEditorDiscardKeepsTheBudget() {
        open("proactive")
        defer { app.terminate() }
        XCTAssertTrue(element("proactive.budget").waitForExistence(timeout: 8))
        let before = element("proactive.budget").label
        app.buttons["proactive.settings"].tap()
        let budget = app.textFields["proactive.edit.budget"]
        XCTAssertTrue(budget.waitForExistence(timeout: 4))
        budget.tap()
        budget.clearText()
        budget.typeText("90")
        app.buttons["sheet.cancel"].tap()
        let closed = NSPredicate { _, _ in !self.element("proactive.edit.sheet").exists }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: closed, object: nil)], timeout: 6),
            .completed
        )
        XCTAssertEqual(element("proactive.budget").label, before)
    }

    func testFailedSaveKeepsTheEditsAndOffersRetry() {
        open("proactive", extra: ["--ui-test-insights-save-fails-once"])
        defer { app.terminate() }
        XCTAssertTrue(element("proactive.budget").waitForExistence(timeout: 8))
        app.buttons["proactive.settings"].tap()
        let budget = app.textFields["proactive.edit.budget"]
        XCTAssertTrue(budget.waitForExistence(timeout: 4))
        budget.tap()
        budget.clearText()
        budget.typeText("70")
        app.buttons["sheet.confirm"].tap()
        let retry = app.buttons["proactive.edit.retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 6), "A failed save must offer retry")
        XCTAssertEqual(app.textFields["proactive.edit.budget"].value as? String, "70")
        retry.tap()
        let closed = NSPredicate { _, _ in !self.element("proactive.edit.sheet").exists }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: closed, object: nil)], timeout: 8),
            .completed
        )
    }
}

private extension XCUIElement {
    func clearText() {
        guard let current = value as? String, !current.isEmpty else { return }
        typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
    }
}

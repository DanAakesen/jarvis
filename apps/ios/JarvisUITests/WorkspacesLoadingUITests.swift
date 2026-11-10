import XCTest

final class WorkspacesLoadingUITests: XCTestCase {
    private let app = XCUIApplication()

    func testStaticStructurePrecedesDataAndRefreshRetainsRows() {
        launch()
        defer { app.terminate() }
        XCTAssertTrue(app.textFields["workspaces.search"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["workspaces.filters"].exists)
        XCTAssertTrue(app.staticTexts["Overview"].exists)
        capture("workspaces-first-load")
        let row = app.staticTexts["Weekly status — synthetic"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        app.collectionViews.firstMatch.swipeDown()
        XCTAssertTrue(row.exists, "Refresh must retain usable rows")
        capture("workspaces-refresh-retained")
        navigate("chat")
        navigate("workspaces")
        XCTAssertTrue(row.waitForExistence(timeout: 2), "Revisit should use the existing scoped cache")
        XCTAssertFalse(app.descendants(matching: .any)["workspaces.loading"].exists)
    }

    func testFailedRefreshKeepsRowsAndOffersRetry() {
        launch(extra: ["--ui-test-workspaces-refresh-fails"])
        defer { app.terminate() }
        let row = app.staticTexts["Weekly status — synthetic"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        app.collectionViews.firstMatch.swipeDown()
        XCTAssertTrue(row.exists)
        XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 15))
        XCTAssertTrue(row.exists)
        capture("workspaces-refresh-failed")
    }

    func testKnownEmptyResultRemainsZeroAfterFailedRefresh() {
        launch(extra: ["--ui-test-workspaces-empty", "--ui-test-workspaces-refresh-fails"])
        defer { app.terminate() }
        XCTAssertTrue(app.staticTexts["No saved items"].waitForExistence(timeout: 10))
        let zero = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Reports, 0'")).firstMatch
        XCTAssertTrue(zero.exists, "A loaded empty result is a real zero")
        app.collectionViews.firstMatch.swipeDown()
        XCTAssertTrue(zero.exists)
        XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 15))
        XCTAssertTrue(zero.exists, "Refresh failure must not turn a known zero into unknown/loading")
        capture("workspaces-empty-refresh-failed")
    }

    private func launch(extra: [String] = []) {
        app.launchArguments = [
            "--ui-test-navigation", "--ui-test-workspaces-loading",
            "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US"
        ] + extra
        app.launch()
        navigate("workspaces")
        XCTAssertTrue(app.descendants(matching: .any)["workspaces.loading"].waitForExistence(timeout: 5))
    }

    private func navigate(_ destination: String) {
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.tap()
        let target = app.buttons["navigation.\(destination)"]
        XCTAssertTrue(target.waitForExistence(timeout: 5))
        target.tap()
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

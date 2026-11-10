import XCTest

final class FactoryLoadingUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws { continueAfterFailure = false }

    func testLoadingKeepsNavigationSearchAndStaticSections() {
        launch(state: "loading")
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["factory.segment.board"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.buttons["factory.segment.releases"].isHittable)
        XCTAssertTrue(app.buttons["factory.filters"].exists)
        XCTAssertTrue(app.buttons["factory.plus"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["factory.search"].exists)
        XCTAssertTrue(app.staticTexts["Pipeline"].exists)
        capture("factory-static-structure-loading")
        app.buttons["factory.segment.releases"].tap()
        XCTAssertTrue(app.buttons["factory.segment.releases"].isSelected)
        XCTAssertTrue(app.staticTexts["Releases"].exists)
    }

    func testFirstLoadFailureKeepsStaticStructureAndRetry() {
        launch(state: "error")
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["factory.segment.board"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.buttons["factory.retry"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Pipeline"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["factory.filters"].exists)
        XCTAssertTrue(app.buttons["factory.plus"].exists)
        capture("factory-static-structure-first-load-error")
    }

    func testFailedRefreshRetainsBoardAndExpandedColumn() {
        launch(state: "board")
        defer { app.terminate() }
        let column = app.buttons["factory.column.needs_dan"]
        XCTAssertTrue(column.waitForExistence(timeout: 8))
        column.tap()
        let card = app.staticTexts["Synthetic decision"]
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        app.scrollViews["factory.board"].swipeDown()
        let retry = app.buttons.matching(identifier: "factory.retry").firstMatch
        XCTAssertTrue(retry.waitForExistence(timeout: 8), "The single-use fixture fails subsequent reads")
        XCTAssertTrue(card.exists, "The board must remain visible after refresh failure")
        XCTAssertEqual(column.value as? String, "Expanded")
        XCTAssertTrue(app.buttons["factory.segment.board"].isSelected)
        capture("factory-retained-board-refresh-failure")
    }

    private func launch(state: String) {
        app.launchArguments = ["--ui-test-navigation", "--screenshot-factory-fixture",
                               "--screenshot-factory-state=\(state)", "--screenshot-factory-language=en",
                               "-jarvis.appLanguage", "en", "-AppleLanguages", "(en)"]
        app.launch()
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

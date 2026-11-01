import XCTest

final class SidebarNavigationTests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testPhysicalMenuTapOpensSidebarWithinTwoSecondsInDanish() {
        assertPhysicalMenuTap(language: "da")
    }

    func testPhysicalMenuTapOpensSidebarWithinTwoSecondsInEnglish() {
        assertPhysicalMenuTap(language: "en", startupDelay: 5)
    }

    private func assertPhysicalMenuTap(language: String, startupDelay: TimeInterval = 0) {
        app.launchArguments = [
            "--ui-test-navigation",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        app.launch()
        defer { app.terminate() }
        if startupDelay > 0 { Thread.sleep(forTimeInterval: startupDelay) }

        let menu = app.buttons["navigation.openSidebar"]
        let ready = NSPredicate { _, _ in
            menu.exists && menu.isEnabled && menu.isHittable && !menu.frame.isEmpty
                && self.app.frame.contains(menu.frame)
        }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: menu)], timeout: 10),
            .completed
        )
        XCTAssertEqual(menu.label, language == "da" ? "Åbn sidemenu" : "Open sidebar")
        XCTAssertGreaterThan(menu.frame.midX, app.frame.midX)
        XCTAssertLessThan(menu.frame.midY, app.frame.minY + app.frame.height * 0.2)
        // Frames are floating point, so 44pt can read back as 43.99999999999999.
        XCTAssertGreaterThanOrEqual(menu.frame.width, 43.5)
        XCTAssertGreaterThanOrEqual(menu.frame.height, 43.5)
        let bell = app.buttons["chat.notifications"]
        XCTAssertTrue(bell.exists)
        XCTAssertTrue(bell.isHittable)
        XCTAssertEqual(menu.frame.midY, bell.frame.midY, accuracy: 5)
        XCTAssertGreaterThan(menu.frame.minX, bell.frame.maxX,
                             "The sidebar launcher must be separate and farther right than the bell")

        let sidebar = app.otherElements.matching(identifier: "navigation.sidebar").element
        XCTAssertFalse(sidebar.exists)
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let opened = NSPredicate { _, _ in
            sidebar.exists && sidebar.isHittable && !sidebar.frame.isEmpty
                && self.app.frame.contains(sidebar.frame)
                && self.app.buttons["navigation.chat"].isHittable
        }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: opened, object: sidebar)], timeout: 2),
            .completed,
            "A physical menu tap must expose a visible, interactive drawer within two seconds"
        )
        XCTAssertTrue(sidebar.exists)
        XCTAssertTrue(sidebar.isHittable)
        XCTAssertTrue(app.buttons["navigation.chat"].isHittable)
    }

    func testSidebarItemNavigatesToSoftwareFactoryInDanish() {
        assertSidebarItemNavigates(language: "da")
    }

    func testSidebarItemNavigatesToSoftwareFactoryInEnglish() {
        assertSidebarItemNavigates(language: "en")
    }

    private func assertSidebarItemNavigates(language: String) {
        app.launchArguments = [
            "--ui-test-navigation",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        app.launch()
        defer { app.terminate() }
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 8))
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let item = app.buttons["navigation.softwareFactory"]
        XCTAssertTrue(item.waitForExistence(timeout: 2))
        XCTAssertTrue(item.isHittable)
        item.tap()
        let trace = app.staticTexts["debug.navigation.trace"]
        let factoryScreen = app.buttons["factory.segment.board"]
        XCTAssertTrue(
            factoryScreen.waitForExistence(timeout: 3),
            "Tapping a sidebar item must show its screen. Navigation trace: \(trace.exists ? trace.label : "unavailable")"
        )
        XCTAssertTrue(factoryScreen.isHittable, "The Software Factory screen must be visible, not offset away")
        XCTAssertFalse(app.buttons["chat.notifications"].isHittable, "The Chat screen must have been left")
        XCTAssertFalse(app.buttons["navigation.chat"].exists, "Tapping a sidebar item must close the drawer")
    }
}

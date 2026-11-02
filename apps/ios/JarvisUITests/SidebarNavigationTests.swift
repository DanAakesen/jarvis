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

        let sidebar = app.descendants(matching: .any).matching(identifier: "navigation.sidebar").firstMatch
        XCTAssertFalse(sidebar.exists)
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        // Two seconds for the drawer to appear. Geometry checks follow with their own allowance, because each
        // XCUITest snapshot can take about a second on a loaded simulator.
        XCTAssertTrue(
            sidebar.waitForExistence(timeout: 2),
            "A physical menu tap must expose a visible, interactive drawer within two seconds. Navigation trace: \(navigationTrace)"
        )
        let opened = NSPredicate { _, _ in
            sidebar.exists && !sidebar.frame.isEmpty
                && self.app.frame.contains(sidebar.frame)
                && self.app.buttons["navigation.chat"].isHittable
        }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: opened, object: sidebar)], timeout: 6),
            .completed,
            "The drawer must be on screen with tappable rows. Navigation trace: \(navigationTrace)"
        )
        XCTAssertTrue(sidebar.exists)
        XCTAssertTrue(app.buttons["navigation.chat"].isHittable)
    }

    /// The temporary on-screen trace is a label-only accessibility element, so query it without a type.
    private var navigationTrace: String {
        let trace = app.descendants(matching: .any).matching(identifier: "debug.navigation.trace").firstMatch
        return trace.exists ? trace.label : "unavailable"
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
        let factoryScreen = app.buttons["factory.segment.board"]
        XCTAssertTrue(
            factoryScreen.waitForExistence(timeout: 3),
            "Tapping a sidebar item must show its screen. Navigation trace: \(navigationTrace)"
        )
        XCTAssertTrue(factoryScreen.isHittable, "The Software Factory screen must be visible, not offset away")
        XCTAssertFalse(app.buttons["chat.notifications"].isHittable, "The Chat screen must have been left")
        XCTAssertFalse(app.buttons["navigation.chat"].exists, "Tapping a sidebar item must close the drawer")
    }
}

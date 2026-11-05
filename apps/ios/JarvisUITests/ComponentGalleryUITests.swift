import XCTest

/// Opens the debug-only component gallery and attaches a screenshot so reviewers can compare it with the design board.
final class ComponentGalleryUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launchGallery() {
        app.launchArguments = ["--component-gallery", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
    }

    /// First match by identifier or, as a fallback, by accessibility label: a container identifier must never hide a control.
    private func element(_ identifier: String, label: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@ OR label == %@", identifier, label))
            .firstMatch
    }

    private func attach(_ screenshot: XCUIScreenshot, named name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testGalleryShowsEverySharedComponentAndAttachesAScreenshot() {
        launchGallery()
        defer { app.terminate() }
        let marker = app.descendants(matching: .any).matching(identifier: "screen.componentGallery").firstMatch
        if !marker.waitForExistence(timeout: 30) {
            XCTFail("The component gallery did not open. \(String(app.debugDescription.prefix(6000)))")
            return
        }
        for (id, label) in [
            ("gallery.header.refresh", "Refresh"), ("gallery.orbs", "Orb at three sizes"),
            ("navigation.openSidebar", "navigation.openSidebar"), ("gallery.icon", "Default"), ("gallery.menu", "Menu"),
            ("gallery.label", "Label"),
        ] {
            XCTAssertTrue(element(id, label: label).waitForExistence(timeout: 10), id)
        }
        attach(app.screenshot(), named: "Component gallery")
    }

    /// Two screenshots of the live orb taken apart in time must differ: the orb flows, it is not a still image.
    func testOrbAnimatesBetweenTwoFrames() {
        launchGallery()
        defer { app.terminate() }
        let orbs = element("gallery.orbs", label: "Orb at three sizes")
        if !orbs.waitForExistence(timeout: 30) {
            XCTFail("The orb row did not appear. \(String(app.debugDescription.prefix(6000)))")
            return
        }
        let first = orbs.screenshot()
        Thread.sleep(forTimeInterval: 0.8)
        let second = orbs.screenshot()
        attach(first, named: "Orb frame 1")
        attach(second, named: "Orb frame 2 (0.8 s later)")
        XCTAssertNotEqual(first.pngRepresentation, second.pngRepresentation, "The orb must animate")
    }

    /// Every icon and menu button is one 48 pt circle: the frame is square, with or without a badge.
    func testIconButtonsAreSquareAndTheBellKeepsItsSizeWithABadge() {
        launchGallery()
        defer { app.terminate() }
        let marker = app.descendants(matching: .any).matching(identifier: "screen.componentGallery").firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 30), "The component gallery did not open.")
        // Covers only the simple icon button component (JarvisIconButton/JarvisMenuButton); add new icon buttons to this list by hand, never sweep all buttons.
        let ids = [
            "gallery.icon", "gallery.icon.badge", "gallery.menu", "gallery.bell", "gallery.bell.badge",
            "gallery.bell.badge.large", "gallery.bell.menu", "navigation.openSidebar",
        ]
        for id in ids {
            let button = galleryElement(id)
            XCTAssertTrue(button.exists, "\(id) not found. Accessibility tree:\n\(app.debugDescription)")
            XCTAssertEqual(button.frame.width, button.frame.height, accuracy: 0.5, "\(id) must be square")
            XCTAssertEqual(button.frame.width, 48, accuracy: 0.5, "\(id) must be 48 pt")
        }
        attach(app.screenshot(), named: "Bell with and without a badge")
    }

    /// The tab strip never wraps a title and every tab is at least 44 pt tall.
    func testTabStripTabsAreSingleLineAndAtLeast44Points() {
        launchGallery()
        defer { app.terminate() }
        let marker = app.descendants(matching: .any).matching(identifier: "screen.componentGallery").firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 30), "The component gallery did not open.")
        for id in ["gallery.tabs.0", "gallery.tabs.1", "gallery.tabs.2", "gallery.tabs.3"] {
            let tab = galleryElement(id)
            XCTAssertTrue(tab.exists, "\(id) not found. Accessibility tree:\n\(app.debugDescription)")
            XCTAssertGreaterThanOrEqual(tab.frame.height, 44, "\(id) must be at least 44 pt tall")
            XCTAssertLessThan(tab.frame.height, 60, "\(id) must be one line")
        }
        attach(app.screenshot(), named: "Tab strip")
    }

    func testFactoryBoardKeepsNeedsDanWithOnlyTwoTabs() {
        captureFactory(state: "board", language: "en", theme: "dark")
    }

    func testLegacyNeedsDanEntryOpensAndRevealsTheBoardColumn() {
        captureFactory(state: "needs", language: "da", theme: "light")
    }

    private func captureFactory(state: String, language: String, theme: String) {
        app.launchArguments = [
            "--screenshot-factory-fixture", "--screenshot-factory-state=\(state)",
            "--screenshot-factory-language=\(language)",
            "-jarvis.appLanguage", language, "-jarvis.appTheme", theme,
            "-AppleLanguages", "(\(language))", "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        app.launch()
        defer { app.terminate() }
        let board = app.buttons["factory.segment.board"]
        let releases = app.buttons["factory.segment.releases"]
        XCTAssertTrue(board.waitForExistence(timeout: 15))
        XCTAssertTrue(board.isSelected)
        XCTAssertTrue(releases.exists)
        XCTAssertFalse(app.buttons["factory.segment.needsDan"].exists)
        XCTAssertEqual(board.frame.width, releases.frame.width, accuracy: 1)
        XCTAssertEqual(board.frame.maxX, releases.frame.minX, accuracy: 1, "Segments touch within one control")
        let needs = app.buttons["factory.column.needs_dan"]
        XCTAssertTrue(needs.waitForExistence(timeout: 10))
        let taskLink = app.links["factory.row.github.10"]
        if state == "board" {
            XCTAssertFalse(taskLink.exists, "Board columns start collapsed")
            needs.tap()
        }
        XCTAssertTrue(taskLink.waitForExistence(timeout: 5), "The Needs Dan task remains reachable on Board")
        XCTAssertTrue(needs.isHittable, "The old Needs Dan entry scrolls its column into view")
        attach(app.screenshot(), named: "P15-94-factory-\(state)-\(theme)-\(language)")
    }

    // Separate cases keep each three-page capture below the runner's per-test timeout.
    func testSharedPageOrderDarkEnglish() { captureSharedPages(language: "en", theme: "dark") }
    func testSharedPageOrderLightEnglish() { captureSharedPages(language: "en", theme: "light") }
    func testSharedPageOrderDarkDanish() { captureSharedPages(language: "da", theme: "dark") }
    func testSharedPageOrderLightDanish() { captureSharedPages(language: "da", theme: "light") }

    private func captureSharedPages(language: String, theme: String) {
        defer { app.terminate() }
        for destination in ["usage", "status", "proactive"] {
            openPage(destination, language: language, theme: theme, launch: destination == "usage")
            let hero = app.descendants(matching: .any)["\(destination).hero"]
            XCTAssertTrue(hero.waitForExistence(timeout: 10), "\(destination) hero")
            attach(app.screenshot(), named: "P15-92-\(destination)-\(theme)-\(language)")
            // The shared phrase exposes one accessibility element; SwiftUI may classify it as Other.
            let phrase = app.descendants(matching: .any).matching(identifier: "page.headline").firstMatch
            XCTAssertTrue(phrase.exists)
            XCTAssertGreaterThanOrEqual(hero.frame.minY, phrase.frame.maxY, "Phrase precedes hero")
            let prefix = destination == "usage" ? "usage.range." : destination == "status" ? "status.filter." : "proactive.tabs."
            let filter = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
            XCTAssertTrue(filter.exists)
            if destination == "usage" {
                XCTAssertGreaterThanOrEqual(filter.frame.minY, hero.frame.minY, "Usage period is inside hero")
                XCTAssertLessThanOrEqual(filter.frame.maxY, hero.frame.maxY)
            } else {
                XCTAssertGreaterThanOrEqual(filter.frame.minY, hero.frame.maxY, "Filters follow hero")
            }
            let geometry = [
                "screen": ["x": app.frame.minX, "y": app.frame.minY, "width": app.frame.width, "height": app.frame.height],
                "hero": ["x": hero.frame.minX, "y": hero.frame.minY, "width": hero.frame.width, "height": hero.frame.height],
                "phrase": ["x": phrase.frame.minX, "y": phrase.frame.minY, "width": phrase.frame.width, "height": phrase.frame.height],
                "filter": ["x": filter.frame.minX, "y": filter.frame.minY, "width": filter.frame.width, "height": filter.frame.height],
            ]
            if let data = try? JSONSerialization.data(withJSONObject: geometry, options: [.sortedKeys, .prettyPrinted]),
               let json = String(data: data, encoding: .utf8) {
                let bounds = XCTAttachment(string: json)
                bounds.name = "P15-92-\(destination)-\(theme)-\(language)-geometry"
                bounds.lifetime = .keepAlways
                add(bounds)
            }
        }
    }

    func testWorkspacesHeroPrecedesFiltersAndKeepsSearchReachable() {
        for (language, theme) in [("en", "dark"), ("da", "light")] {
            // Workspaces is opened by workspace commands, not a sidebar item.
            app.launchArguments = [
                "--ui-test-navigation", "--ui-test-workspaces",
                "-jarvis.appLanguage", language, "-jarvis.appTheme", theme,
                "-AppleLanguages", "(\(language))", "-AppleLocale", language == "da" ? "da_DK" : "en_US",
            ]
            app.launch()
            defer { app.terminate() }
            let hero = app.descendants(matching: .any)["workspaces.hero"]
            XCTAssertTrue(hero.waitForExistence(timeout: 10))
            attach(app.screenshot(), named: "P15-92-workspaces-\(theme)-\(language)")
            let filters = app.descendants(matching: .any)["workspaces.filters"]
            XCTAssertGreaterThanOrEqual(filters.frame.minY, hero.frame.maxY)
            XCTAssertTrue(app.textFields["workspaces.search"].isHittable)
            XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Weekly status")).firstMatch.exists)
        }
    }

    func testInitialLoadingHidesFiltersAndUsesOnePageSkeleton() {
        for destination in ["usage", "status", "proactive"] {
            openPage(destination, extra: ["--ui-test-insights=loading"])
            defer { app.terminate() }
            let loading = app.descendants(matching: .any)["\(destination).loading"]
            XCTAssertTrue(loading.waitForExistence(timeout: 8))
            XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "page.headline").firstMatch.exists,
                           "No invented phrase while loading")
            let prefix = destination == "usage" ? "usage.range." : destination == "status" ? "status.filter." : "proactive.tabs."
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).count, 0)
            XCTAssertTrue(app.buttons["navigation.openSidebar"].isHittable, "Navigation stays available")
            attach(app.screenshot(), named: "P15-92-\(destination)-loading")
        }
    }

    func testSheetConfirmIsOnLeftAndCancelOnRightInBothLanguages() {
        for language in ["en", "da"] {
            openPage("proactive", language: language)
            defer { app.terminate() }
            XCTAssertTrue(app.buttons["proactive.settings"].waitForExistence(timeout: 8))
            app.buttons["proactive.settings"].tap()
            let confirm = app.buttons["sheet.confirm"]
            let cancel = app.buttons["sheet.cancel"]
            XCTAssertTrue(confirm.waitForExistence(timeout: 5))
            XCTAssertTrue(cancel.exists)
            XCTAssertLessThan(confirm.frame.midX, app.frame.midX, "Confirm occupies the left side")
            XCTAssertGreaterThan(cancel.frame.midX, app.frame.midX, "Cancel occupies the right side")
            XCTAssertEqual(confirm.frame.midY, cancel.frame.midY, accuracy: 5)
            attach(app.screenshot(), named: "P15-92-sheet-actions-\(language)")
            cancel.tap()
            XCTAssertTrue(app.buttons["proactive.settings"].waitForExistence(timeout: 5))
        }
    }

    func testSectionActionWorksAndRowsHaveSeparateLinesAndSpacing() {
        launchGallery()
        defer { app.terminate() }
        let action = galleryElement("gallery.section.action")
        for _ in 0..<8 {
            if action.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(action.isHittable)
        action.tap()
        XCTAssertEqual(app.staticTexts["gallery.section.result"].label, "Actions: 1")
        let title = app.staticTexts["gallery.row.0.title"]
        let detail = app.staticTexts["gallery.row.0.detail"]
        let next = app.staticTexts["gallery.row.1.title"]
        XCTAssertGreaterThan(detail.frame.minY, title.frame.maxY, "Lines have breathing room")
        XCTAssertGreaterThanOrEqual(next.frame.minY - detail.frame.maxY, 19.5, "Rows are separated by 20 pt (allowing half-point rounding)")
        attach(app.screenshot(), named: "P15-92-shared-section-and-rows")
    }

    private func openPage(_ destination: String, language: String = "en", theme: String = "dark", extra: [String] = [], launch: Bool = true) {
        if launch {
            app.launchArguments = [
                "--ui-test-navigation", "-jarvis.appLanguage", language, "-jarvis.appTheme", theme,
                "-AppleLanguages", "(\(language))", "-AppleLocale", language == "da" ? "da_DK" : "en_US",
            ] + extra
            app.launch()
        }
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let destinationButton = app.buttons["navigation.\(destination)"]
        XCTAssertTrue(destinationButton.waitForExistence(timeout: 5))
        destinationButton.tap()
    }

    /// Finds a gallery element by identifier whatever its accessibility type, scrolling the page until it appears.
    private func galleryElement(_ id: String) -> XCUIElement {
        let element = app.descendants(matching: .any).matching(identifier: id).firstMatch
        var swipes = 0
        while !element.waitForExistence(timeout: 2) && swipes < 6 {
            app.swipeUp()
            swipes += 1
        }
        return element
    }
}

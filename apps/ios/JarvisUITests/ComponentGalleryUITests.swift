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
            "--ui-test-navigation",
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
        XCTAssertTrue(board.isHittable, "The fixture must be visible above the authentication gate")
        XCTAssertTrue(board.isSelected)
        XCTAssertTrue(releases.exists)
        XCTAssertFalse(app.buttons["factory.segment.needsDan"].exists)
        XCTAssertEqual(board.frame.width, releases.frame.width, accuracy: 1)
        XCTAssertEqual(board.frame.maxX, releases.frame.minX, accuracy: 1, "Segments touch within one control")
        let needs = app.buttons["factory.column.needs_dan"]
        XCTAssertTrue(needs.waitForExistence(timeout: 10))
        // SwiftUI Link is exposed as a Button on the pinned iOS Simulator.
        let taskLink = app.buttons["factory.row.github.10"]
        if state == "board" {
            XCTAssertFalse(taskLink.exists, "Board columns start collapsed")
            needs.tap()
        }
        XCTAssertTrue(taskLink.waitForExistence(timeout: 5), "The Needs Dan task remains reachable on Board")
        XCTAssertEqual(needs.value as? String, language == "da" ? "Udvidet" : "Expanded")
        XCTAssertTrue(taskLink.isHittable, "The task action must be visible in the expanded column")
        XCTAssertTrue(app.staticTexts["Synthetic decision"].exists)
        XCTAssertTrue(needs.isHittable, "The old Needs Dan entry scrolls its column into view")
        attach(app.screenshot(), named: "P15-94-factory-\(state)-\(theme)-\(language)")
    }

    func testHealthPeriodsDarkEnglish() { captureHealthHeroes(language: "en", theme: "dark") }
    func testHealthPeriodsLightDanish() { captureHealthHeroes(language: "da", theme: "light") }

    private func captureHealthHeroes(language: String, theme: String) {
        openPage("health", language: language, theme: theme, launch: true)
        let training = app.descendants(matching: .any)["health.hero.training"]
        XCTAssertTrue(training.waitForExistence(timeout: 15))
        let periodIDs = ["today", "sevenDays", "thirtyDays"].map { "health.period.\($0)" }
        for id in periodIDs { XCTAssertTrue(app.buttons[id].exists, id) }
        XCTAssertFalse(app.buttons["health.period.yesterday"].exists)
        let initial = app.buttons["health.period.today"].frame
        XCTAssertTrue(app.descendants(matching: .any)["health.training.donut"].exists)
        attach(app.screenshot(), named: "P15-95-health-training-\(theme)-\(language)")
        training.swipeLeft()
        let sleep = app.descendants(matching: .any)["health.hero.sleep"]
        XCTAssertTrue(sleep.waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["health.period.today"].frame.minY, initial.minY, accuracy: 1)
        attach(app.screenshot(), named: "P15-95-health-sleep-\(theme)-\(language)")
        sleep.swipeLeft()
        XCTAssertTrue(app.descendants(matching: .any)["health.hero.nutrition"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["health.period.today"].frame.minY, initial.minY, accuracy: 1)
        app.buttons["health.period.thirtyDays"].tap()
        XCTAssertTrue(app.buttons["health.period.thirtyDays"].isSelected)
        attach(app.screenshot(), named: "P15-95-health-nutrition-\(theme)-\(language)")
        let log = app.buttons["health.lifts.log"]
        XCTAssertTrue(log.waitForExistence(timeout: 5), "The section must preserve its Log button's identity")
        let scroll = app.scrollViews.firstMatch
        for _ in 0..<4 {
            if log.isHittable && log.frame.minY > app.staticTexts["page.title"].frame.maxY { break }
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(log.isHittable, "Last lifts must be reachable below the hero")
        attach(app.screenshot(), named: "P15-95-health-sections-\(theme)-\(language)")
        log.tap()
        XCTAssertTrue(app.textFields["today.lift.name"].waitForExistence(timeout: 5), "Last lifts opens Home's shared sheet")
        attach(app.screenshot(), named: "P15-95-health-log-lift-\(theme)-\(language)")
        app.buttons["sheet.cancel"].tap()
        XCTAssertTrue(log.waitForExistence(timeout: 5))
        for position in 1...3 {
            app.swipeUp()
            attach(app.screenshot(), named: "P15-95-health-lower-\(position)-\(theme)-\(language)")
        }
        app.terminate()
    }

    func testUsageCurrentContractAndEveryPeriodAndBreakdownControl() {
        openPage("usage")
        defer { app.terminate() }
        let total = app.descendants(matching: .any)["usage.total"]
        XCTAssertTrue(total.waitForExistence(timeout: 10))
        for period in ["7d", "30d", "90d", "all"] {
            let before = total.label
            app.buttons["usage.range.\(period)"].tap()
            let updated = NSPredicate { _, _ in total.exists && total.label != before }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: updated, object: nil)], timeout: 8), .completed)
            XCTAssertTrue(app.buttons["usage.range.\(period)"].isSelected)
        }
        attach(app.screenshot(), named: "P15-96-usage-all-dark-en")
        for group in ["agent", "source", "project"] {
            let control = app.buttons["usage.groupBy.\(group)"]
            for _ in 0..<3 { if control.isHittable { break }; app.swipeUp() }
            XCTAssertTrue(control.isHittable)
            control.tap()
            XCTAssertTrue(control.isSelected)
            let expected = group == "project" ? "p-web" : group == "source" ? "sandbox" : "codex"
            XCTAssertTrue(app.buttons["usage.slice.\(expected)"].waitForExistence(timeout: 3))
        }
        attach(app.screenshot(), named: "P15-96-usage-breakdown-dark-en")
    }

    func testNotificationsHasHeroAndKeepsApprovalActionsInBothLanguages() {
        for (language, theme) in [("en", "dark"), ("da", "light")] {
            app.launchArguments = ["--ui-test-navigation", "--screenshot-calendar-change-fixture", "--screenshot-notifications-open",
                "-jarvis.appLanguage", language, "-jarvis.appTheme", theme]
            app.launch()
            let hero = app.descendants(matching: .any)["notifications.hero"]
            XCTAssertTrue(hero.waitForExistence(timeout: 12))
            let phrase = app.descendants(matching: .any).matching(identifier: "page.headline").firstMatch
            XCTAssertTrue(phrase.exists)
            XCTAssertGreaterThanOrEqual(hero.frame.minY, phrase.frame.maxY)
            XCTAssertTrue(app.buttons["chat.notifications.done"].isHittable)
            let approval = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "confirmation-approve-")).firstMatch
            XCTAssertTrue(approval.exists)
            XCTAssertFalse(approval.isEnabled, "Synthetic approval must never execute a calendar change")
            attach(app.screenshot(), named: "P15-96-notifications-\(theme)-\(language)")
            app.terminate()
        }
    }

    // Separate cases keep each three-page capture below the runner's per-test timeout.
    func testSharedPageOrderDarkEnglish() { captureSharedPages(language: "en", theme: "dark") }
    func testSharedPageOrderLightEnglish() { captureSharedPages(language: "en", theme: "light") }
    func testSharedPageOrderDarkDanish() { captureSharedPages(language: "da", theme: "dark") }
    func testSharedPageOrderLightDanish() { captureSharedPages(language: "da", theme: "light") }

    func testSharedPagesAtAccessibilityTextSize() {
        captureSharedPages(language: "en", theme: "dark", largeText: true)
    }

    private func captureSharedPages(language: String, theme: String, largeText: Bool = false) {
        defer { app.terminate() }
        for destination in ["usage", "status", "proactive"] {
            openPage(destination, language: language, theme: theme,
                     extra: largeText ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [],
                     launch: destination == "usage")
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
            if largeText {
                app.swipeUp()
                attach(app.screenshot(), named: "P15-\(destination)-accessibility-text")
            }
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

    func testUsageErrorKeepsPeriodRecoveryAvailable() {
        openPage("usage", extra: ["--ui-test-insights=error"])
        defer { app.terminate() }
        XCTAssertTrue(app.descendants(matching: .any)["usage.error"].waitForExistence(timeout: 8))
        let week = app.buttons["usage.range.7d"]
        XCTAssertTrue(week.isHittable)
        week.tap()
        XCTAssertTrue(app.descendants(matching: .any)["usage.error"].waitForExistence(timeout: 8))
        XCTAssertTrue(week.isHittable)
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

    func testNotesRootFoldersCountsBackAndRecentlyOpened() {
        openPage("notes")
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["notes.tab.notes"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["notes.tab.list"].exists)
        notesReach("notes.note.welcome.md")
        XCTAssertEqual(app.staticTexts["notes.folder.count"].label, "1")
        attach(app.screenshot(), named: "P15-93-notes-root-dark-en")
        notesTap("notes.folder.Work", upward: false)
        notesTap("notes.folder.Work/Projects")
        notesReach("notes.note.Work/Projects/release.md")
        XCTAssertEqual(app.staticTexts["notes.folder.count"].label, "1")
        attach(app.screenshot(), named: "P15-93-notes-folder-dark-en")
        notesTap("notes.note.Work/Projects/release.md")
        XCTAssertTrue(app.buttons["note.back"].waitForExistence(timeout: 8))
        app.buttons["note.back"].tap()
        notesTap("notes.folder.back", upward: false)
        XCTAssertEqual(app.staticTexts["notes.folder.breadcrumb"].label, "Work")
        notesTap("notes.folder.back", upward: false)
        notesReach("notes.recent.Work/Projects/release.md", upward: false)
        attach(app.screenshot(), named: "P15-93-notes-recent-dark-en")
    }

    func testNewNoteCreatesFolderInsideTheOpenFolder() {
        openPage("notes")
        defer { app.terminate() }
        notesTap("notes.folder.Work")
        notesTap("notes.folder.Work/Projects")
        notesTap("notes.plus")
        notesTap("notes.newNote")
        let title = app.descendants(matching: .any).matching(identifier: "notes.create.title").firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText("Capture")
        notesTap("notes.create.folder")
        XCTAssertEqual(app.staticTexts["notes.create.folder.path"].label, "Work / Projects")
        notesTap("notes.create.folder.name")
        app.textFields["notes.create.folder.name"].typeText("Research")
        notesTap("notes.create.folder.add")
        XCTAssertEqual(app.staticTexts["notes.create.folder.path"].label, "Work / Projects / Research")
        app.buttons["sheet.confirm"].tap()
        XCTAssertTrue(app.buttons["notes.create.folder"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["notes.create.folder"].label, "Work / Projects / Research")
        attach(app.screenshot(), named: "P15-93-notes-new-folder-dark-en")
        app.buttons["sheet.confirm"].tap()
        XCTAssertTrue(app.buttons["note.back"].waitForExistence(timeout: 8))
        app.buttons["note.back"].tap()
        notesTap("notes.folder.Work/Projects/Research")
        notesReach("notes.note.Work/Projects/Research/capture.md")
        XCTAssertEqual(app.staticTexts["notes.folder.count"].label, "1")
        attach(app.screenshot(), named: "P15-93-notes-created-dark-en")
    }

    func testNewFolderPersistsAnEmptyChildOfTheSelectedParent() {
        openPage("notes")
        defer { app.terminate() }
        notesTap("notes.plus")
        notesTap("notes.newFolder")
        let name = app.textFields["notes.create.folder.title"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Research")
        notesTap("notes.create.folder")
        notesTap("notes.create.folder.Work")
        notesTap("notes.create.folder.Work/Projects")
        app.buttons["sheet.confirm"].tap()
        XCTAssertTrue(app.buttons["notes.create.folder"].waitForExistence(timeout: 5))
        attach(app.screenshot(), named: "P15-93-new-folder-sheet-dark-en")
        app.buttons["sheet.confirm"].tap()
        notesReach("notes.folder.breadcrumb")
        XCTAssertEqual(app.staticTexts["notes.folder.breadcrumb"].label, "Work / Projects / Research")
        XCTAssertEqual(app.staticTexts["notes.folder.count"].label, "0")
        notesTap("notes.folder.back", upward: false)
        notesReach("notes.folder.Work/Projects/Research")
        attach(app.screenshot(), named: "P15-93-new-empty-folder-dark-en")
    }

    func testNotesGraphSelectionAndTaskPriority() {
        openPage("notes")
        defer { app.terminate() }
        notesTap("notes.tab.graph")
        let nodeID = "notes.graph.node." + String(repeating: "0", count: 63) + "1"
        notesTap(nodeID)
        XCTAssertTrue(app.buttons["notes.graph.open"].waitForExistence(timeout: 5))
        attach(app.screenshot(), named: "P15-93-notes-graph-selected-dark-en")
        let search = app.textFields["notes.search"]
        XCTAssertTrue(search.isHittable)
        search.tap()
        search.typeText("Review")
        notesTap("notes.tab.tasks", upward: false)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Review release")).firstMatch.waitForExistence(timeout: 8))
        notesTap("notes.search.clear")
        notesTap("notes.plus")
        notesTap("notes.newTask")
        let title = app.descendants(matching: .any).matching(identifier: "notes.create.title").firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText("Priority capture")
        notesTap("notes.create.scope.0")
        notesTap("notes.create.priority.2")
        attach(app.screenshot(), named: "P15-93-notes-new-task-dark-en")
        app.buttons["sheet.confirm"].tap()
        let created = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Priority capture")).firstMatch
        for _ in 0..<5 {
            if created.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(created.waitForExistence(timeout: 8))
        created.tap()
        XCTAssertTrue(app.staticTexts["High"].waitForExistence(timeout: 5))
        attach(app.screenshot(), named: "P15-93-notes-task-priority-dark-en")
    }

    func testTaskBoardRowsDarkEnglish() {
        exerciseTaskBoard(language: "en", theme: "dark")
    }

    func testTaskBoardRowsLightDanish() {
        exerciseTaskBoard(language: "da", theme: "light")
    }

    func testTaskBoardRowsAtAccessibilityTextSize() {
        exerciseTaskBoard(language: "en", theme: "dark", largeText: true)
    }

    private func exerciseTaskBoard(language: String, theme: String, largeText: Bool = false) {
        let extra = ["--ui-test-task-list-board"] + (largeText
            ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
        openPage("notes", language: language, theme: theme, extra: extra)
        defer { app.terminate() }
        notesTap("notes.tab.tasks")
        let firstID = "notes.task.row." + String(repeating: "0", count: 63) + "1"
        notesReach(firstID)
        let first = app.descendants(matching: .any).matching(identifier: firstID).firstMatch
        let completion = first.buttons["notes.task.complete"]
        XCTAssertTrue(completion.isHittable)
        XCTAssertGreaterThanOrEqual(completion.frame.width, 44)
        XCTAssertGreaterThanOrEqual(completion.frame.height, 44)
        XCTAssertGreaterThan(first.frame.minX, 20, "Task groups must be inset from the screen edge")
        attach(app.screenshot(), named: "P15-task-board-\(language)-\(theme)-large-\(largeText)")

        if !largeText {
            app.swipeUp()
            attach(app.screenshot(), named: "P15-task-board-groups-\(language)-\(theme)")
            notesReach(firstID, upward: false)
            completion.tap()
            XCTAssertTrue(first.waitForNonExistence(timeout: 8), "A confirmed completion removes only that task")
            let title = "4. Review the sample agreement · synthetic deadline"
            let open = app.buttons.matching(NSPredicate(format: "identifier == %@ AND label == %@", "notes.task.open", title)).firstMatch
            XCTAssertTrue(open.waitForExistence(timeout: 8), "Markdown emphasis must be rendered without raw markers")
            XCTAssertTrue(open.isHittable, "The next task remains available after completion")
            open.tap()
            let fullTitle = app.staticTexts[title]
            XCTAssertTrue(fullTitle.waitForExistence(timeout: 5), "Details retain the full task title")
            attach(app.screenshot(), named: "P15-task-board-detail-\(language)-\(theme)")
        } else {
            let lastID = "notes.task.row." + String(repeating: "0", count: 63) + "9"
            let last = app.descendants(matching: .any).matching(identifier: lastID).firstMatch
            let lastOpen = last.buttons["notes.task.open"]
            let search = app.textFields["notes.search"]
            for _ in 0..<12 {
                if lastOpen.exists, lastOpen.isHittable, lastOpen.frame.maxY <= search.frame.minY { break }
                app.swipeUp()
            }
            XCTAssertTrue(lastOpen.isHittable)
            XCTAssertTrue(search.isHittable)
            XCTAssertLessThanOrEqual(lastOpen.frame.maxY, search.frame.minY, "The final task must scroll clear of the search dock")
            attach(app.screenshot(), named: "P15-task-board-bottom-accessibility")
        }
    }

    private func notesReach(_ identifier: String, upward: Bool = true) {
        let target = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        for _ in 0..<5 {
            if target.waitForExistence(timeout: 1), target.isHittable { return }
            if upward { app.swipeUp() } else { app.swipeDown() }
        }
        XCTAssertTrue(target.isHittable, "\(identifier) must be reachable")
    }

    private func notesTap(_ identifier: String, upward: Bool = true) {
        notesReach(identifier, upward: upward)
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch.tap()
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
    func testSettingsSectionsSearchAndDetailsDarkEnglish() {
        exerciseSettings(language: "en", theme: "dark")
    }

    func testSettingsSectionsSearchAndDetailsLightDanish() {
        exerciseSettings(language: "da", theme: "light")
    }

    func testSettingsAccessibilityTextKeepsSectionsAndRowsReachable() {
        exerciseSettings(language: "da", theme: "dark", largeText: true)
    }

    private func exerciseSettings(language: String, theme: String, largeText: Bool = false) {
        app.launchArguments = [
            "--ui-test-navigation", "--screenshot-settings-fixture",
            "-jarvis.appLanguage", language, "-jarvis.appTheme", theme,
            "-AppleLanguages", "(\(language))", "-AppleLocale", language == "da" ? "da_DK" : "en_US",
            "-AppleInterfaceStyle", theme == "dark" ? "Dark" : "Light",
        ] + (largeText ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] : [])
        app.launch()
        defer { app.terminate() }
        let general = app.buttons["settings.section.general"]
        XCTAssertTrue(general.waitForExistence(timeout: 15))
        XCTAssertTrue(general.isSelected)
        let languageRow = app.descendants(matching: .any).matching(identifier: "settings.row.language").firstMatch
        XCTAssertTrue(languageRow.isHittable)
        XCTAssertGreaterThanOrEqual(languageRow.frame.height, 44)
        attach(app.screenshot(), named: "P15-settings-general-\(language)-\(theme)-large-\(largeText)")
        for section in ["models", "health", "account"] {
            let segment = app.buttons["settings.section.\(section)"]
            if !segment.isHittable {
                app.scrollViews.containing(.button, identifier: "settings.section.general").firstMatch.swipeLeft()
            }
            XCTAssertTrue(segment.isHittable)
            segment.tap()
            XCTAssertTrue(segment.isSelected)
            let firstRow = ["models": "jarvis", "health": "training", "account": "owner"][section]!
            XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "settings.row.\(firstRow)").firstMatch.waitForExistence(timeout: 5))
            XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "settings.row.language").firstMatch.exists)
            attach(app.screenshot(), named: "P15-settings-\(section)-\(language)-\(theme)-large-\(largeText)")
        }
        let search = app.textFields["settings.search"]
        search.tap()
        search.typeText(language == "da" ? "Stemme" : "Voice")
        let voice = app.descendants(matching: .any).matching(identifier: "settings.row.voice").firstMatch
        XCTAssertTrue(voice.waitForExistence(timeout: 5), "Search reaches General while Account is selected")
        XCTAssertTrue(voice.isHittable)
        voice.tap()
        XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 5), "Search keeps the existing detail navigation")
        attach(app.screenshot(), named: "P15-settings-search-detail-\(language)-\(theme)-large-\(largeText)")
    }

}

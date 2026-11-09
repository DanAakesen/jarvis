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

    func testMediumWidgetsDarkEnglish() { captureMediumWidgetLayouts(language: "en") }
    func testMediumWidgetsLightDanish() { captureMediumWidgetLayouts(language: "da") }
    func testMediumWidgetsLightEnglish() { captureMediumWidgetLayouts(language: "en-light") }

    /// Each language has its own unchanged per-test deadline and uses actual extension views.
    private func captureMediumWidgetLayouts(language: String) {
        app.launchArguments = ["--widget-layout-gallery", "--widget-language=\(language)"]
        app.launch()
        defer { app.terminate() }
        let firstCard = app.descendants(matching: .any)["widget.preview.workouts"]
        XCTAssertTrue(firstCard.waitForExistence(timeout: 10))
        attach(app.screenshot(), named: "P15-widgets-medium-\(language)")
        do {
            // One settled accessibility snapshot checks every element without a round trip per assertion.
            let snapshot = try app.snapshot()
            for (kind, title) in [
                ("workouts", language == "da" ? "Træning" : "Workouts"),
                ("factory", "Factory"), ("notes", language == "da" ? "Opgaver" : "Tasks"),
            ] {
                let card = try widgetSnapshot("widget.preview.\(kind)", in: snapshot)
                let header = try widgetSnapshot("widget.header.title", in: card)
                XCTAssertEqual(header.label, title)
                let cardFrame = card.frame
                XCTAssertEqual(cardFrame.width, 329, accuracy: 0.5)
                XCTAssertEqual(cardFrame.height, 155, accuracy: 0.5)
                let inset = cardFrame.insetBy(dx: 16, dy: 16)
                let headerFrame = assertWidgetElement(header, within: inset)
                // The native Workouts symbol centers its text 1.17 pt below the header top.
                // Allow that optical offset; assertWidgetElement still rejects content outside the inset.
                XCTAssertLessThanOrEqual(headerFrame.minY - inset.minY, 2,
                                         "The title must remain within 2 pt of the top inset")
                XCTAssertLessThan(headerFrame.minX, inset.minX + 30, "The title follows its top-left symbol")
                if kind == "workouts" {
                    let metrics = try ["lift", "run", "kilometers", "calories"].map {
                        assertWidgetElement(try widgetSnapshot("widget.workouts.\($0)", in: card), within: inset)
                    }
                    // Combined AX frames bound the text, not the equal-width layout slots.
                    // Verify each column's origin and containment in its allocated half.
                    let columnGap: CGFloat = 12
                    let gridLeft = metrics[0].minX
                    let columnWidth = (inset.maxX - gridLeft - columnGap) / 2
                    XCTAssertGreaterThan(columnWidth, 0)
                    let rightColumn = gridLeft + columnWidth + columnGap
                    XCTAssertEqual(metrics[1].minX, rightColumn, accuracy: 1)
                    for index in [0, 2] {
                        XCTAssertLessThanOrEqual(metrics[index].maxX, gridLeft + columnWidth + 0.5)
                    }
                    for index in [1, 3] {
                        XCTAssertGreaterThanOrEqual(metrics[index].minX, rightColumn - 0.5)
                    }
                    XCTAssertEqual(metrics[0].minX, metrics[2].minX, accuracy: 1)
                    XCTAssertEqual(metrics[1].minX, metrics[3].minX, accuracy: 1)
                    XCTAssertEqual(metrics[0].minY, metrics[1].minY, accuracy: 1)
                    XCTAssertEqual(metrics[2].minY, metrics[3].minY, accuracy: 1)
                    XCTAssertGreaterThanOrEqual(metrics[2].minY - metrics[0].maxY, 5)
                } else if kind == "factory" {
                    for status in ["running", "awaiting", "review", "failed"] {
                        let count = try widgetSnapshot("widget.factory.count.\(status)", in: card)
                        let countFrame = assertWidgetElement(count, within: inset)
                        XCTAssertLessThanOrEqual(countFrame.height, 29, "Medium count cells must leave room for both task rows")
                    }
                    for id in ["c1", "t1"] {
                        assertWidgetElement(try widgetSnapshot("widget.factory.task.\(id)", in: card), within: inset)
                    }
                    let buttons = widgetDescendants(card).filter { $0.elementType == .button }
                    XCTAssertEqual(buttons.count, 2, "Both task actions retain their place")
                    for button in buttons {
                        assertWidgetElement(button, within: inset)
                        XCTAssertFalse(button.isEnabled, "Synthetic actions must never write")
                    }
                } else {
                    XCTAssertFalse(widgetDescendants(card).contains { $0.identifier == "widget.notes.summary" })
                    for id in ["k1", "k2", "k3"] {
                        assertWidgetElement(try widgetSnapshot("widget.tasks.row.\(id)", in: card), within: inset)
                    }
                    XCTAssertFalse(widgetDescendants(card).contains { $0.label == (language == "da" ? "Idéer til widgets" : "Widget ideas") })
                }
            }
        } catch {
            XCTFail("The widget layout snapshot must include every required element: \(error)")
        }
    }

    private func widgetDescendants(_ snapshot: XCUIElementSnapshot) -> [XCUIElementSnapshot] {
        [snapshot] + snapshot.children.flatMap { widgetDescendants($0) }
    }

    private func widgetSnapshot(_ identifier: String, in snapshot: XCUIElementSnapshot) throws -> XCUIElementSnapshot {
        try XCTUnwrap(widgetDescendants(snapshot).first { $0.identifier == identifier }, identifier)
    }

    @discardableResult
    private func assertWidgetElement(_ snapshot: XCUIElementSnapshot, within bounds: CGRect) -> CGRect {
        let frame = snapshot.frame
        let identifier = snapshot.identifier
        XCTAssertFalse(frame.isEmpty, identifier)
        XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 0.5, identifier)
        XCTAssertGreaterThanOrEqual(frame.minY, bounds.minY - 0.5, identifier)
        XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 0.5, identifier)
        XCTAssertLessThanOrEqual(frame.maxY, bounds.maxY + 0.5, identifier)
        return frame
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
        captureReservedHeaderAfterScroll(named: "Home-refinement-factory-footer-\(theme)-\(language)")
        XCTAssertTrue(app.buttons["factory.plus"].isHittable, "The floating footer stays reachable after scrolling")
    }

    func testHealthPeriodsDarkEnglish() { captureHealthHeroes(language: "en", theme: "dark") }
    func testHealthPeriodsLightDanish() { captureHealthHeroes(language: "da", theme: "light") }

    private func assertHeroHeader(_ card: XCUIElement, lastPeriod: String) {
        let bounds = card.frame
        let title = card.staticTexts["hero.title"].frame
        XCTAssertEqual(title.minX - bounds.minX, title.minY - bounds.minY, accuracy: 2,
                       "Hero title keeps equal top and leading padding")
        XCTAssertEqual(app.buttons[lastPeriod].frame.maxX, bounds.maxX - 19, accuracy: 2,
                       "Periods align to the card's trailing inset, including the control's own inset")
    }

    private func captureHealthHeroes(language: String, theme: String) {
        openPage("health", language: language, theme: theme, launch: true)
        let training = app.descendants(matching: .any)["health.hero.training"]
        XCTAssertTrue(training.waitForExistence(timeout: 15))
        let periodIDs = ["today", "sevenDays", "thirtyDays"].map { "health.period.\($0)" }
        for id in periodIDs { XCTAssertTrue(app.buttons[id].exists, id) }
        XCTAssertFalse(app.buttons["health.period.yesterday"].exists)
        let initial = app.buttons["health.period.today"].frame
        assertHeroHeader(training, lastPeriod: "health.period.thirtyDays")
        XCTAssertTrue(app.descendants(matching: .any)["health.training.donut"].exists)
        attach(app.screenshot(), named: "P15-95-health-training-\(theme)-\(language)")
        training.swipeLeft()
        let sleep = app.descendants(matching: .any)["health.hero.sleep"]
        XCTAssertTrue(sleep.waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["health.period.today"].frame.minY, initial.minY, accuracy: 1)
        assertHeroHeader(sleep, lastPeriod: "health.period.thirtyDays")
        attach(app.screenshot(), named: "P15-95-health-sleep-\(theme)-\(language)")
        sleep.swipeLeft()
        XCTAssertTrue(app.descendants(matching: .any)["health.hero.nutrition"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["health.period.today"].frame.minY, initial.minY, accuracy: 1)
        assertHeroHeader(app.descendants(matching: .any)["health.hero.nutrition"], lastPeriod: "health.period.thirtyDays")
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
        captureBodyTrends(language: language, theme: theme)
        app.terminate()
    }

    private func captureBodyTrends(language: String, theme: String) {
        let weight = revealBodyChart("body_mass")
        let details = app.descendants(matching: .any)["health.body.body_mass.details"]
        let latest = details.label
        let latestChartValue = weight.value as? String
        XCTAssertTrue(latest.contains(language == "da" ? "72,4 kg" : "72.4 kg"),
                      "The selected reading retains the measurement's decimal precision")
        attach(app.screenshot(), named: "Build76-body-weight-latest-\(theme)-\(language)")
        // The fixture contains four unevenly spaced records. A point in the left quarter
        // of the full-width chart selects an earlier record, not the initial latest value.
        weight.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()
        let changed = NSPredicate { _, _ in
            details.exists && details.label != latest && (weight.value as? String) != latestChartValue
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: changed, object: nil)], timeout: 5), .completed,
                       "Tapping a historical point must update both the visible reading and accessible chart value")
        let selectedSummary = details.label
        attach(app.screenshot(), named: "Build76-body-weight-selected-\(theme)-\(language)")
        details.tap()
        let title = language == "da" ? "Vægt" : "Weight"
        let navigation = app.navigationBars[title]
        XCTAssertTrue(navigation.waitForExistence(timeout: 5), "The chart's header must open existing measurement details")
        XCTAssertTrue(app.staticTexts[language == "da" ? "Målinger" : "Measurements"].waitForExistence(timeout: 5),
                      "Details must finish loading the measurement records")
        attach(app.screenshot(), named: "Build76-body-weight-detail-\(theme)-\(language)")
        navigation.buttons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["page.title"].waitForExistence(timeout: 5))
        XCTAssertEqual(details.label, selectedSummary, "Back must retain the selected dashboard measurement")
        XCTAssertTrue(weight.isHittable, "Back must retain the dashboard's chart position")

        for metric in ["body_fat_percentage", "lean_body_mass"] {
            let chart = revealBodyChart(metric)
            XCTAssertFalse((chart.value as? String ?? "").isEmpty, "The chart must expose its recorded value and date")
            if metric == "lean_body_mass" {
                XCTAssertTrue(app.staticTexts[language == "da" ? "1 måling" : "1 measurement"].exists,
                              "A single reading must remain a single measurement")
            }
            attach(app.screenshot(), named: "Build76-body-\(metric)-\(theme)-\(language)")
        }
    }

    /// Keep the complete chart and its detail link between the reserved header and floating dock.
    /// Bidirectional, bounded drags also recover when an earlier full-screen swipe passed the target.
    @discardableResult
    private func revealBodyChart(_ metric: String, includeHeader: Bool = true) -> XCUIElement {
        let chart = app.descendants(matching: .any)["health.body.\(metric).chart"]
        let details = app.descendants(matching: .any)["health.body.\(metric).details"]
        let first = includeHeader ? details : chart
        for _ in 0..<9 {
            let top = max(app.staticTexts["page.title"].frame.maxY,
                          app.buttons["navigation.openSidebar"].frame.maxY) + 8
            let bottom = min(app.buttons["health.mode.0"].frame.minY,
                             app.textFields["health.search"].frame.minY) - 8
            if chart.exists, first.exists, chart.isHittable, first.isHittable,
               first.frame.minY >= top, chart.frame.maxY <= bottom { return chart }
            let passed = first.exists && first.frame.minY < top
            let upper = top + (bottom - top) * 0.15
            let lower = top + (bottom - top) * 0.85
            let needed = passed ? top - first.frame.minY + 12
                : chart.exists ? chart.frame.maxY - bottom + 12 : lower - upper
            let distance = min(max(needed, 24), lower - upper)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: app.frame.width * 0.8, dy: passed ? upper : lower))
            let end = origin.withOffset(CGVector(dx: app.frame.width * 0.8, dy: passed ? upper + distance : lower - distance))
            // Release at rest: fast drags coast past sparse charts and oscillate around
            // the valid position at AX sizes even though the complete plot fits.
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.5)
        }
        attach(app.screenshot(), named: "Body-chart-reachability-failure-\(metric)")
        XCTFail("The complete \(metric) chart and detail action must remain reachable above the dock")
        return chart
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

    func testProactiveNotificationOpensExistingChatWithoutSending() {
        verifyNotificationChat(id: "6f1c0d5a-0b0e-4d6b-9d0e-000000000001")
    }

    func testHistoricalProactiveNotificationOpensChatWithoutSending() {
        verifyNotificationChat(id: "6f1c0d5a-0b0e-4d6b-9d0e-000000000004")
    }

    private func verifyNotificationChat(id: String) {
        app.launchArguments = ["--ui-test-navigation", "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark",
                               "-jarvis.proactive.pendingItemID", id]
        app.launch()
        defer { app.terminate() }
        let input = app.descendants(matching: .any)["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 12))
        XCTAssertFalse(app.staticTexts["proactive.body.\(id)"].exists)
        XCTAssertFalse(app.buttons["chat.send"].isEnabled)
        XCTAssertFalse(app.staticTexts["Chat is open, but Jarvis has not loaded this notification's context. Open the notification again to retry."].exists)
        attach(app.screenshot(), named: "Notification-existing-chat-\(id)")
    }

    func testTransientProactiveNotificationFailureShowsChatRecovery() {
        app.launchArguments = ["--ui-test-navigation", "--ui-test-insights=error", "-jarvis.appLanguage", "en",
                               "-jarvis.proactive.pendingItemID", "11111111-1111-4111-8111-111111111111"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.descendants(matching: .any)["chat.input"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["Chat is open, but Jarvis has not loaded this notification's context. Open the notification again to retry."].waitForExistence(timeout: 12))
        XCTAssertFalse(app.buttons["chat.send"].isEnabled)
    }

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
            captureReservedHeaderAfterScroll(named: "Build76-\(destination)-scrolled-\(theme)-\(language)-large-\(largeText)")
            if let data = try? JSONSerialization.data(withJSONObject: geometry, options: [.sortedKeys, .prettyPrinted]),
               let json = String(data: data, encoding: .utf8) {
                let bounds = XCTAttachment(string: json)
                bounds.name = "P15-92-\(destination)-\(theme)-\(language)-geometry"
                bounds.lifetime = .keepAlways
                add(bounds)
            }
        }
        if largeText {
            // Reuse this AX launch for the Health dock/header instead of another simulator/app run.
            openPage("health", language: language, theme: theme, launch: false)
            XCTAssertTrue(app.descendants(matching: .any)["health.hero.training"].waitForExistence(timeout: 15))
            XCTAssertTrue(app.buttons["health.mode.0"].isHittable)
            XCTAssertTrue(app.textFields["health.search"].isHittable)
            attach(app.screenshot(), named: "Build76-health-header-dock-\(language)-\(theme)-accessibility")
            captureReservedHeaderAfterScroll(named: "Build76-health-scrolled-\(language)-\(theme)-accessibility")
            XCTAssertTrue(app.buttons["health.mode.0"].isHittable)
            XCTAssertTrue(app.textFields["health.search"].isHittable)
            let chart = revealBodyChart("body_mass", includeHeader: false)
            XCTAssertFalse((chart.value as? String ?? "").isEmpty)
            attach(app.screenshot(), named: "Build76-body-weight-\(language)-\(theme)-accessibility")
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
        attach(app.screenshot(), named: "P15-usage-error-period-recovery-before")
        week.tap()
        XCTAssertTrue(app.descendants(matching: .any)["usage.error"].waitForExistence(timeout: 8))
        XCTAssertTrue(week.isHittable)
        XCTAssertTrue(week.isSelected)
        attach(app.screenshot(), named: "P15-usage-error-period-recovery-after")
    }

    func testInitialLoadingHidesFiltersAndUsesOnePageSkeleton() {
        for destination in ["usage", "status", "proactive"] {
            let theme = destination == "status" ? "light" : "dark"
            let reduced = destination == "proactive"
            openPage(destination, theme: theme, extra: ["--ui-test-insights=loading"]
                     + (reduced ? ["--ui-test-loading-reduced-motion"] : []))
            defer { app.terminate() }
            let loading = app.descendants(matching: .any)["\(destination).loading"]
            XCTAssertTrue(loading.waitForExistence(timeout: 8))
            XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "page.headline").firstMatch.exists,
                           "No invented phrase while loading")
            let prefix = destination == "usage" ? "usage.range." : destination == "status" ? "status.filter." : "proactive.tabs."
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).count, 0)
            XCTAssertTrue(app.buttons["navigation.openSidebar"].isHittable, "Navigation stays available")
            attach(app.screenshot(), named: "P15-92-\(destination)-loading")
            let first = loading.screenshot()
            Thread.sleep(forTimeInterval: 0.6)
            let second = loading.screenshot()
            attach(first, named: "Build76-loading-\(theme)-reduced-\(reduced)-frame-1")
            attach(second, named: "Build76-loading-\(theme)-reduced-\(reduced)-frame-2")
            if reduced {
                XCTAssertEqual(first.pngRepresentation, second.pngRepresentation,
                               "Reduce Motion must keep placeholders still")
            } else {
                XCTAssertNotEqual(first.pngRepresentation, second.pngRepresentation,
                                  "Both appearances must retain quiet placeholder motion")
            }
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
        let firstMetadata = first.buttons["notes.task.open"].value as? String ?? ""
        XCTAssertFalse(firstMetadata.isEmpty, "Task context remains accessible")
        XCTAssertFalse(firstMetadata.contains("Tasks"), "Generic collection names are not useful task context")
        // AX frame subtraction can report 43.99999999999994 for an exact 44pt target.
        // Allow only sub-micropoint arithmetic error, never a visibly smaller target.
        XCTAssertLessThanOrEqual(max(0, 44 - completion.frame.width), 0.000_001)
        XCTAssertLessThanOrEqual(max(0, 44 - completion.frame.height), 0.000_001)
        XCTAssertGreaterThan(first.frame.minX, 20, "Task groups must be inset from the screen edge")
        if !largeText {
            XCTAssertLessThan(first.frame.height, 100, "Priority metadata must not inflate a compact task row")
        }
        attach(app.screenshot(), named: "P15-task-board-\(language)-\(theme)-large-\(largeText)")

        if !largeText {
            app.swipeUp()
            attach(app.screenshot(), named: "P15-task-board-groups-\(language)-\(theme)")
            assertTaskGroupHeadingsDoNotOverlapRows()
            revealTaskCompletion(firstID)
            app.descendants(matching: .any).matching(identifier: firstID).firstMatch
                .buttons["notes.task.complete"].tap()
            XCTAssertTrue(first.waitForNonExistence(timeout: 8), "A confirmed completion removes only that task")
            let title = "4. Review the sample agreement · synthetic deadline"
            let open = app.buttons.matching(NSPredicate(format: "identifier == %@ AND label == %@", "notes.task.open", title)).firstMatch
            XCTAssertTrue(open.waitForExistence(timeout: 8), "Markdown emphasis must be rendered without raw markers")
            XCTAssertTrue(open.isHittable, "The next task remains available after completion")
            open.tap()
            let fullTitle = app.staticTexts[title]
            XCTAssertTrue(fullTitle.waitForExistence(timeout: 5), "Details retain the full task title")
            let sourcePath = app.staticTexts["notes.task.source.path"]
            for _ in 0..<3 { if sourcePath.isHittable { break }; app.swipeUp() }
            XCTAssertTrue(sourcePath.isHittable, "Source provenance remains reachable in the scrolling detail")
            XCTAssertEqual(sourcePath.label, "Work/Synthetic.md")
            XCTAssertEqual(app.staticTexts["notes.task.source.heading"].label, "Project kickoff")
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

    private func assertTaskGroupHeadingsDoNotOverlapRows() {
        let list = app.descendants(matching: .any)["notes.tasks.list"]
        XCTAssertTrue(list.exists)
        let headers = list.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "notes.task.group."))
            .allElementsBoundByIndex.filter { !$0.frame.isEmpty && $0.frame.intersects(list.frame) }
        let rows = list.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "notes.task.row."))
            .allElementsBoundByIndex.filter { !$0.frame.isEmpty && $0.frame.intersects(list.frame) }
        XCTAssertFalse(headers.isEmpty, "The scrolled task group heading remains visible")
        XCTAssertFalse(rows.isEmpty, "The scrolled task rows remain visible")
        for header in headers {
            for row in rows {
                let overlap = header.frame.intersection(row.frame).intersection(list.frame)
                XCTAssertTrue(overlap.isNull || overlap.width <= 0.5 || overlap.height <= 0.5,
                              "A task heading must scroll with its group, never cover a task row")
            }
        }
    }

    private func revealTaskCompletion(_ rowID: String) {
        let title = app.staticTexts["page.title"]
        let menu = app.buttons["navigation.openSidebar"]
        let dock = app.buttons["notes.plus"]
        for _ in 0..<5 {
            // A native List can report a row as hittable beneath the fixed header.
            // Resolve the control again after scrolling and require its whole target
            // to clear both overlays before performing the real completion action.
            let control = app.descendants(matching: .any).matching(identifier: rowID)
                .firstMatch.buttons["notes.task.complete"]
            if control.exists, control.isHittable,
               control.frame.minY >= max(title.frame.maxY, menu.frame.maxY) + 16,
               control.frame.maxY <= dock.frame.minY - 16 {
                return
            }
            app.swipeDown()
        }
        XCTFail("Task completion must be fully visible between the header and search dock")
    }

    private func captureReservedHeaderAfterScroll(named name: String) {
        let title = app.staticTexts["page.title"]
        let frame = title.frame
        app.swipeUp()
        XCTAssertTrue(title.isHittable)
        XCTAssertEqual(title.frame.minY, frame.minY, accuracy: 1, "The header has reserved space above scrolling content")
        XCTAssertTrue(app.buttons["navigation.openSidebar"].isHittable)
        attach(app.screenshot(), named: name)
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
    func testInstructionsDestinationPreservesSavedScopes() {
        app.launchArguments = ["--ui-test-navigation", "--screenshot-settings-fixture",
                               "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark"]
        app.launch()
        defer { app.terminate() }
        let search = app.textFields["settings.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("Instructions")
        let row = app.descendants(matching: .any).matching(identifier: "settings.row.instructions").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        let identity = app.descendants(matching: .any).matching(identifier: "settings.field.identity.description").firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 5))
        XCTAssertEqual(identity.value as? String, "Synthetic assistant identity")
        let present = app.descendants(matching: .any).matching(identifier: "settings.field.personality.modeInstructions.present").firstMatch
        for _ in 0..<8 { if present.exists && present.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(present.exists)
        XCTAssertEqual(present.value as? String, "Synthetic present instruction")
        attach(app.screenshot(), named: "Home-instructions-saved-scopes-en")
        let lines = app.descendants(matching: .any).matching(identifier: "settings.field.homeBrief.maxVisibleLines").firstMatch
        for _ in 0..<8 { if lines.exists && lines.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(lines.exists)
        XCTAssertEqual(lines.value as? String, "3")
        attach(app.screenshot(), named: "Home-instructions-brief-preferences-en")
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
        captureReservedHeaderAfterScroll(named: "Build76-settings-scrolled-\(language)-\(theme)-large-\(largeText)")
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

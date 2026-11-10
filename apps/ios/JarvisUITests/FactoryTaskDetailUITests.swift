import XCTest

final class FactoryTaskDetailUITests: XCTestCase {
    private let app = XCUIApplication()
    private let privateSentinels = ["PRIVATE_THOUGHT_SENTINEL_1708", "LOW_LEVEL_SENTINEL_1708"]

    override func setUpWithError() throws { continueAfterFailure = false }

    func testEnglishBoardLongRequestAndHistory() {
        exerciseLongDetail(language: "en", notification: false)
    }

    func testDanishNotificationLongRequestAndHistoryAtAccessibilityXXXL() {
        exerciseLongDetail(
            language: "da", notification: true,
            contentSize: "UICTContentSizeCategoryAccessibilityXXXL"
        )
    }

    func testEnglishLongRequestAtAccessibilityMedium() {
        launch(language: "en", long: true, contentSize: "UICTContentSizeCategoryAccessibilityM")
        defer { app.terminate() }
        openBoardTask()
        assertRequestToggle(language: "en")
        assertPrivateContentHidden()
    }

    func testShortRequestHasNoExpansionControl() {
        launch(language: "en", long: false)
        defer { app.terminate() }
        openBoardTask()
        let request = reveal(app.staticTexts["factory.request.text"])
        XCTAssertEqual(request.label, "Review the synthetic release and report any blocking checks.")
        XCTAssertFalse(app.buttons["factory.request.toggle"].exists)
        capture("short-request")
    }

    private func exerciseLongDetail(language: String, notification: Bool, contentSize: String? = nil) {
        launch(language: language, long: true, contentSize: contentSize)
        defer { app.terminate() }
        if notification { openNotificationTask() } else { openBoardTask() }

        assertSectionOrder(language == "da"
            ? ["Handlinger", "Oplysninger", "Anmodning"]
            : ["Actions", "Details", "Request"])
        let original = assertRequestToggle(language: language)
        reveal(section(language == "da" ? "Tidslinje" : "Timeline"), forwardOnly: true)
        reveal(app.descendants(matching: .any)["factory.timeline.attention"])
        let earlierFailure = reveal(timelineEntry("2"))
        XCTAssertTrue(earlierFailure.label.contains("Synthetic earlier disk_low: workspace needs attention"))
        assertPrivateContentHidden()
        // The compact preview must not bury these sections behind 100 raw notifications.
        reveal(section(language == "da" ? "Forbrug" : "Usage"), maximumSwipes: 12, forwardOnly: true)
        reveal(app.staticTexts[language == "da" ? "Minutter" : "Minutes"].firstMatch, maximumSwipes: 4)
        XCTAssertTrue(app.staticTexts["12"].firstMatch.exists)
        XCTAssertTrue(app.staticTexts[language == "da" ? "Estimeret" : "Estimated"].firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'DKK'")).firstMatch.exists,
                       "The unreported sandbox price must not be invented")
        reveal(section(language == "da" ? "Artefakter" : "Artifacts"), maximumSwipes: 6, forwardOnly: true)
        XCTAssertTrue(app.staticTexts["Synthetic test report page 1"].firstMatch.exists)
        XCTAssertFalse(section("Disk").exists)

        reveal(app.buttons["factory.timeline.history"], searchBackward: true).tap()
        XCTAssertTrue(app.descendants(matching: .any)["factory.timeline.detail"].waitForExistence(timeout: 10))
        capture("history-\(language)")
        captureHierarchy("history-\(language)-hierarchy")
        let first = timelineEntry("1")
        reveal(first)
        let failure = reveal(timelineEntry("2"))
        if first.isHittable {
            XCTAssertGreaterThan(failure.frame.minY, first.frame.minY, "History remains oldest-first")
        }
        let publicMessage = reveal(timelineEntry("81"))
        XCTAssertTrue(publicMessage.label.contains("Synthetic public progress 1: reviewed the release."))
        XCTAssertTrue(publicMessage.label.contains("Checks and artifacts follow."), "Adjacent public chunks are joined")
        let checks = reveal(timelineEntry("93"))
        XCTAssertTrue(checks.label.contains("Synthetic checks passed 1"))
        reveal(timelineEntry("94"))
        reveal(timelineEntry("95"))
        assertPrivateContentHidden()

        let loadMore = reveal(app.buttons["factory.timeline.loadMore"], maximumSwipes: 12)
        loadMore.tap()
        XCTAssertTrue(timelineEntry("101").waitForExistence(timeout: 10), "The second 100-event page loads")
        reveal(timelineEntry("101"))
        reveal(timelineEntry("181"), maximumSwipes: 12)
        XCTAssertFalse(timelineEntry("201").exists, "Load more fetches one page, not the entire history")
        assertPrivateContentHidden()
        capture("history-loaded-\(language)")
        captureHierarchy("history-loaded-\(language)-hierarchy")

        let close = app.buttons["sheet.cancel"]
        XCTAssertTrue(close.exists)
        close.tap()
        XCTAssertFalse(app.descendants(matching: .any)["factory.timeline.detail"].exists)
        reveal(loadedEventCount(200, language: language), searchBackward: true)
        refreshDetail(language: language)
        let request = reveal(app.staticTexts["factory.request.text"])
        XCTAssertEqual(request.label, original, "Refresh and pagination must not rewrite the request")
        XCTAssertEqual(app.buttons["factory.request.toggle"].label, language == "da" ? "Vis mere" : "Show more")
        reveal(loadedEventCount(200, language: language))
        reveal(app.buttons["factory.timeline.history"]).tap()
        XCTAssertTrue(app.descendants(matching: .any)["factory.timeline.detail"].waitForExistence(timeout: 10))
        XCTAssertTrue(reveal(timelineEntry("2")).label.contains("Synthetic earlier disk_low: workspace needs attention"))
        reveal(timelineEntry("181"))
        XCTAssertEqual(
            app.descendants(matching: .any).matching(identifier: "factory.timeline.entry.181").count, 1,
            "Repeated fixture reads remain deterministic without duplicate rows"
        )
        reveal(app.buttons["factory.timeline.loadMore"]).tap()
        reveal(timelineEntry("281"))
        assertPrivateContentHidden()
    }

    @discardableResult
    private func assertRequestToggle(language: String) -> String {
        let request = reveal(app.staticTexts["factory.request.text"])
        let original = request.label
        XCTAssertTrue(original.contains("\n\n"))
        XCTAssertTrue(original.contains("æble, øvelse, and åbning"))
        XCTAssertTrue(original.hasSuffix("or retried."))
        let collapsedHeight = request.frame.height
        XCTAssertGreaterThan(collapsedHeight, 0)
        let toggle = reveal(app.buttons["factory.request.toggle"])
        XCTAssertEqual(toggle.label, language == "da" ? "Vis mere" : "Show more")
        capture("before-\(language)")
        toggle.tap()
        let expanded = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in request.exists && request.frame.height > collapsedHeight * 1.5 },
            object: request
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 5), .completed)
        XCTAssertGreaterThan(request.frame.height, collapsedHeight * 1.5)
        XCTAssertEqual(request.label, original)
        reveal(request, searchBackward: true)
        capture("expanded-\(language)")
        captureHierarchy("expanded-\(language)-hierarchy")
        reveal(toggle, maximumSwipes: 24)
        XCTAssertEqual(toggle.label, language == "da" ? "Vis mindre" : "Show less")
        toggle.tap()
        let collapsed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                request.exists && abs(request.frame.height - collapsedHeight) <= 2
            },
            object: request
        )
        XCTAssertEqual(XCTWaiter.wait(for: [collapsed], timeout: 5), .completed)
        reveal(request, maximumSwipes: 24)
        XCTAssertEqual(request.label, original)
        XCTAssertEqual(request.frame.height, collapsedHeight, accuracy: 2)
        XCTAssertEqual(toggle.label, language == "da" ? "Vis mere" : "Show more")
        return original
    }

    private func assertSectionOrder(_ titles: [String]) {
        // Each next heading must be reachable by scrolling forward, not by jumping back.
        var previous: XCUIElement?
        for title in titles {
            let heading = reveal(section(title), maximumSwipes: 16, forwardOnly: true)
            if let previous, previous.isHittable {
                XCTAssertGreaterThan(heading.frame.minY, previous.frame.minY)
            }
            previous = heading
            XCTAssertFalse(section("Disk").exists)
        }
    }

    private func launch(language: String, long: Bool, contentSize: String? = nil) {
        app.launchArguments = [
            "--ui-test-navigation", "--ui-test-notification-tasks",
            "-jarvis.appLanguage", language, "-jarvis.appTheme", "dark",
            "-AppleLanguages", "(\(language))", "-AppleLocale", language == "da" ? "da_DK" : "en_US"
        ]
        if long { app.launchArguments.append("--ui-test-factory-long-detail") }
        if let contentSize {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", contentSize]
        }
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["chat.input"].waitForExistence(timeout: 10))
    }

    private func openBoardTask() {
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let factory = app.buttons["navigation.softwareFactory"]
        XCTAssertTrue(factory.waitForExistence(timeout: 10))
        factory.tap()
        let column = app.buttons["factory.column.in_progress"]
        XCTAssertTrue(column.waitForExistence(timeout: 10))
        column.tap()
        let task = app.buttons["factory.row.open.9"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        task.tap()
        XCTAssertTrue(app.descendants(matching: .any)["factory.taskDetail"].waitForExistence(timeout: 10))
    }

    private func openNotificationTask() {
        let bell = app.buttons["chat.notifications"]
        XCTAssertTrue(bell.waitForExistence(timeout: 10))
        bell.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.scrollViews["activity.list"].waitForExistence(timeout: 10))
        reveal(app.buttons["activity.running.open.21"]).tap()
        XCTAssertTrue(app.descendants(matching: .any)["factory.taskDetail"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["chat.notifications.done"].exists)
    }

    private func refreshDetail(language: String) {
        scrollToTop()
        let list = scrollContainer()
        let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.5)
        reveal(section(language == "da" ? "Anmodning" : "Request"))
        capture("refreshed-\(language)")
    }

    private func timelineEntry(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)["factory.timeline.entry.\(id)"].firstMatch
    }

    private func section(_ title: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", title)).firstMatch
    }

    private func loadedEventCount(_ count: Int, language: String) -> XCUIElement {
        let prefix = "\(count) " + (language == "da" ? "indlæste hændelser" : "loaded events")
        return app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private func scrollContainer() -> XCUIElement {
        if app.scrollViews["activity.list"].exists { return app.scrollViews["activity.list"] }
        let history = app.descendants(matching: .any)["factory.timeline.detail"]
        if history.exists {
            if history.elementType == .scrollView { return history }
            if history.scrollViews.firstMatch.exists { return history.scrollViews.firstMatch }
            return app.scrollViews.firstMatch
        }
        if app.collectionViews.firstMatch.exists { return app.collectionViews.firstMatch }
        if app.tables.firstMatch.exists { return app.tables.firstMatch }
        return app.scrollViews.firstMatch
    }

    @discardableResult
    private func reveal(
        _ element: XCUIElement, maximumSwipes: Int = 20,
        forwardOnly: Bool = false, searchBackward: Bool = false
    ) -> XCUIElement {
        for attempt in 0...maximumSwipes {
            let list = scrollContainer()
            let title = app.staticTexts["page.title"].firstMatch
            let titleBottom = title.exists ? title.frame.maxY : list.frame.minY
            let top = max(list.frame.minY, titleBottom) + 8
            let bottom = list.frame.maxY - 8
            if element.exists {
                let frame = element.frame
                if frame.height > bottom - top {
                    // Long request text cannot fit in one viewport; reveal its leading edge.
                    if frame.minY >= top, frame.minY <= bottom - 44 { return element }
                } else if element.isHittable, frame.minY >= top, frame.maxY <= bottom {
                    return element
                }
            }
            if attempt == maximumSwipes { break }
            let down = !forwardOnly && (element.exists ? element.frame.minY < top : searchBackward)
            let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.35 : 0.78))
            let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.78 : 0.35))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
        }
        capture("unreachable-\(element.identifier)")
        captureHierarchy("unreachable-hierarchy")
        XCTFail("Element was not reachable within \(maximumSwipes) swipes: \(element)")
        return element
    }

    private func scrollToTop() {
        for _ in 0..<20 {
            if section("Actions").isHittable || section("Handlinger").isHittable { return }
            scrollContainer().swipeDown()
        }
        XCTFail("Task actions did not become reachable")
    }

    private func assertPrivateContentHidden() {
        for sentinel in privateSentinels {
            XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", sentinel)).firstMatch.exists)
            XCTAssertFalse(app.debugDescription.contains(sentinel))
        }
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func captureHierarchy(_ name: String) {
        let attachment = XCTAttachment(string: app.debugDescription)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

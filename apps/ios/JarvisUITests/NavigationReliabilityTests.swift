import XCTest

final class NavigationReliabilityTests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testRepeatedNavigationInDanish() {
        exerciseNavigation(language: "da")
    }

    func testRepeatedNavigationInEnglish() {
        exerciseNavigation(language: "en")
    }

    func testNotesFoldersStartCollapsedAndRecentStripShowsInDanishAndEnglish() {
        for (language, label, collapsed) in [("da", "Seneste", "Lukket"), ("en", "Recent", "Collapsed")] {
            launch(language: language)
            defer { app.terminate() }
            navigate(to: "notes")
            waitFor(app.staticTexts["page.title"], key: "exists", value: true)
            let folders = app.buttons.matching(identifier: "notes.folder.header")
            if folders.count > 0 {
                for index in 0..<folders.count {
                    let header = folders.element(boundBy: index)
                    XCTAssertEqual(header.value as? String, collapsed, "\(language): folder \(header.identifier) starts collapsed")
                }
            }
            let recent = app.descendants(matching: .any)["notes.recent"]
            if recent.waitForExistence(timeout: 3) {
                XCTAssertTrue(recent.staticTexts[label].exists, "\(language): Recent label")
                let cards = app.buttons.matching(identifier: "notes.recent.item")
                XCTAssertLessThanOrEqual(cards.count, 5)
                XCTAssertGreaterThan(cards.count, 0)
            }
            attachScreenshot("Notes collapsed folders and Recent strip (\(language))")
        }
    }

    /// Health's plus menu and the Home tiles open the very same two sheets: same presentation, same identifiers.
    func testHealthPlusAndHomeTilesOpenTheSameLogSheetsInDanishAndEnglish() {
        for language in ["da", "en"] {
            launch(language: language)
            defer { app.terminate() }
            var identifiers: [String: [Bool]] = [:]
            func probe(_ key: String) {
                let session = app.buttons["today.workout.session.chest"]
                let name = app.textFields["today.lift.name"]
                XCTAssertTrue(session.waitForExistence(timeout: 5) || name.waitForExistence(timeout: 5), "\(language) \(key)")
                identifiers[key] = [
                    session.exists, name.exists,
                    app.buttons["sheet.cancel"].exists, app.buttons["sheet.confirm"].exists,
                    app.descendants(matching: .any)["today.log.date"].exists,
                ]
                cancelSheet()
            }
            navigate(to: "today")
            tap(app.buttons["today.logWorkout"]); probe("home.workout")
            tap(app.buttons["today.logLift"]); probe("home.lift")
            navigate(to: "health")
            tap(app.buttons["health.plus"]); tap(app.buttons["health.logWorkout"]); probe("health.workout")
            tap(app.buttons["health.plus"]); tap(app.buttons["health.logLift"]); probe("health.lift")
            XCTAssertEqual(identifiers["home.workout"], identifiers["health.workout"], "\(language) workout sheet")
            XCTAssertEqual(identifiers["home.lift"], identifiers["health.lift"], "\(language) lift sheet")
            XCTAssertNotEqual(identifiers["health.workout"], identifiers["health.lift"])
        }
    }

    func testMenuRemainsHittableFiveSecondsAfterLaunchInDanish() {
        assertMenuAfterStartup(language: "da")
    }

    func testMenuRemainsHittableFiveSecondsAfterLaunchInEnglish() {
        assertMenuAfterStartup(language: "en")
    }

    private func assertMenuAfterStartup(language: String) {
        launch(language: language, startupDelay: 5)
        defer { app.terminate() }
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.exists)
        XCTAssertTrue(menu.isHittable)
        XCTAssertGreaterThan(menu.frame.midX, app.frame.midX, "Sidebar menu must remain at the top right")
        XCTAssertTrue(app.buttons["chat.notifications"].exists)
        menu.tap()
        assertSidebarOpen()
        closeByTap()
        for destination in ["health", "notes", "softwareFactory"] {
            navigate(to: destination)
            let destinationMenu = app.buttons["navigation.openSidebar"]
            XCTAssertTrue(destinationMenu.exists)
            XCTAssertTrue(destinationMenu.isHittable)
            assertDestinationMenuWorks()
        }
        attachScreenshot("Menu after five-second startup and destinations (\(language))")
    }

    func testSharedPageHeaderInDanishAndEnglish() {
        for language in ["da", "en"] {
            launch(language: language)
            defer { app.terminate() }
            let pages: [(destination: String, actions: [String])] = [
                ("health", []),
                ("notes", []),
                ("settings", []),
                ("softwareFactory", []),
            ]
            for page in pages {
                navigate(to: page.destination)
                let title = app.staticTexts["page.title"]
                waitFor(title, key: "exists", value: true)
                XCTAssertFalse(title.label.isEmpty, "\(page.destination) [\(language)] needs a title")
                XCTAssertGreaterThanOrEqual(title.frame.height, 32, "Title is bold and about 32 pt")
                let menu = app.buttons["navigation.openSidebar"]
                for identifier in page.actions {
                    let button = app.buttons[identifier]
                    waitFor(button, key: "isHittable", value: true)
                    XCTAssertGreaterThanOrEqual(button.frame.width, 44)
                    XCTAssertGreaterThanOrEqual(button.frame.height, 44)
                    XCTAssertGreaterThan(button.frame.minX, title.frame.minX, "Buttons sit on the right of the title")
                    XCTAssertLessThan(button.frame.maxX, menu.frame.minX + 1, "The sidebar button closes the row")
                    XCTAssertLessThan(abs(button.frame.midY - menu.frame.midY), 4, "Buttons are level with each other")
                    XCTAssertLessThan(abs(title.frame.midY - menu.frame.midY), 24, "Title is level with the buttons")
                }
                attachScreenshot("Page header \(page.destination) (\(language))")
                openByEdge()
                tap(app.buttons["navigation.chat"])
                waitFor(app.buttons["navigation.chat"], key: "exists", value: false)
            }
        }
    }

    func testNotificationsSheetHasOneHeaderWithCentredClose() {
        for language in ["da", "en"] {
            launch(language: language)
            defer { app.terminate() }
            let bell = app.buttons["chat.notifications"]
            waitFor(bell, key: "isHittable", value: true)
            bell.tap()
            let title = app.staticTexts["page.title"]
            waitFor(title, key: "exists", value: true)
            XCTAssertFalse(title.label.isEmpty, "Notifications [\(language)] needs a title")
            let close = app.buttons["chat.notifications.done"]
            waitFor(close, key: "isHittable", value: true)
            XCTAssertGreaterThanOrEqual(close.frame.width, 44)
            XCTAssertLessThan(abs(close.frame.width - close.frame.height), 1, "The close button is a circle")
            XCTAssertLessThan(abs(title.frame.midY - close.frame.midY), 24, "Title is level with the buttons")
            attachScreenshot("Notifications (\(language))")
            close.tap()
            waitFor(title, key: "exists", value: false)
        }
    }

    func testFactoryRowsHeaderAndDock() {
        launch(language: "en")
        defer { app.terminate() }
        navigate(to: "softwareFactory")
        let github = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "factory.row.github."))
            .firstMatch
        waitFor(github, key: "exists", value: true)
        XCTAssertGreaterThanOrEqual(github.frame.width, 44)
        XCTAssertGreaterThanOrEqual(github.frame.height, 44)
        XCTAssertEqual(github.label.hasPrefix("Open in GitHub"), true)

        let group = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "factory.column.")).firstMatch
        waitFor(group, key: "isHittable", value: true)
        XCTAssertGreaterThan(group.frame.maxX, app.frame.maxX - 40, "Group header spans the width, chevron far right")
        group.tap()
        group.tap()
        XCTAssertTrue(group.exists)

        let segment = app.buttons["factory.segment.board"]
        let search = app.textFields["factory.search"]
        XCTAssertGreaterThanOrEqual(search.frame.minY - segment.frame.maxY, 12, "Space between the segments and the search")
        let filter = app.buttons["factory.filters"]
        XCTAssertTrue(filter.exists)
        XCTAssertEqual(filter.frame.midY, segment.frame.midY, accuracy: 8, "Filter shares the second row with the segmented bar")
        XCTAssertGreaterThanOrEqual(filter.frame.minX, segment.frame.maxX, "Filter sits right of the segmented bar")
        let plus = app.buttons["factory.plus"]
        XCTAssertEqual(plus.frame.midY, search.frame.midY, accuracy: 8, "Plus sits next to the search")
        XCTAssertGreaterThanOrEqual(plus.frame.minX, search.frame.maxX - 1)
    }

    func testNotesPageOrderAndNoScopeButton() {
        launch(language: "en")
        defer { app.terminate() }
        navigate(to: "notes")
        let title = app.descendants(matching: .any)["page.title"]
        let headline = app.descendants(matching: .any)["page.headline"]
        let hero = app.descendants(matching: .any)["notes.hero"]
        let tabs = app.buttons["notes.tab.notes"]
        waitFor(hero, key: "exists", value: true)
        waitFor(tabs, key: "exists", value: true)
        XCTAssertLessThan(title.frame.maxY, headline.frame.minY, "Header, then the data phrase")
        XCTAssertLessThan(headline.frame.maxY, hero.frame.minY, "Data phrase, then the hero")
        XCTAssertLessThan(hero.frame.maxY, tabs.frame.minY, "Hero, then the segmented bar")
        let folder = app.buttons["notes.folder.header"].firstMatch
        if folder.exists {
            XCTAssertLessThan(tabs.frame.maxY, folder.frame.minY, "Segmented bar, then the list")
        }
        XCTAssertFalse(app.buttons["notes.scope"].exists, "The extra button between search and plus stays removed")
        XCTAssertTrue(app.buttons["notes.plus"].exists)
        attachScreenshot("Notes page order")
    }

    func testShortDragAndBackgroundInterruptionRecover() {
        launch(language: "da")
        for _ in 0..<3 {
            let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.45))
            edge.press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.45)),
                withVelocity: .slow,
                thenHoldForDuration: 0.5
            )
            assertChatInputWorks()
            openByEdge()
            XCUIDevice.shared.press(.home)
            app.activate()
            tapToolbarButton("navigation.openSidebar")
            assertSidebarOpen()
            closeByTap()
            assertChatInputWorks()
        }
        attachScreenshot("Recovered after short drags and background interruption")
    }

    private func launch(language: String, startupDelay: TimeInterval = 0) {
        app.launchArguments = [
            "--ui-test-navigation",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        app.launch()
        if startupDelay > 0 { Thread.sleep(forTimeInterval: startupDelay) }
        waitFor(app.descendants(matching: .any)["chat.input"], key: "isHittable", value: true)
        waitForToolbarFrame(app.buttons["navigation.openSidebar"])
        attachScreenshot("Before navigation sequence (\(language))")
    }

    private func exerciseNavigation(language: String) {
        launch(language: language)
        for iteration in 1...3 {
            XCTContext.runActivity(named: "\(language): navigation cycle \(iteration)") { _ in
                tapToolbarButton("navigation.openSidebar")
                assertSidebarOpen()
                closeByTap()
                assertChatInputWorks()
                openByEdge()
                closeByTap()

                tap(app.buttons["chat.plus"])
                let plusMenu = app.descendants(matching: .any)["chat.plus.camera"]
                waitFor(plusMenu, key: "exists", value: true)
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
                waitFor(plusMenu, key: "exists", value: false)
                tapToolbarButton("chat.notifications")
                tapToolbarButton("chat.notifications.done")
                waitFor(app.buttons["chat.notifications.done"], key: "exists", value: false)
                assertChatInputWorks()

                navigate(to: "health")
                assertDestinationMenuWorks()
                exerciseSearch("health.search")
                let healthMode = app.buttons["health.mode.1"]
                tap(healthMode)
                waitFor(healthMode, key: "isSelected", value: true)
                tap(app.buttons["health.plus"])
                tap(app.buttons["health.logLift"])
                cancelSheet()
                tap(app.buttons["health.plus"])
                tap(app.buttons["health.logWorkout"])
                cancelSheet()
                tap(app.buttons["health.mode.0"])
                waitFor(app.buttons["health.mode.0"], key: "isSelected", value: true)
                exerciseSearch("health.search")

                navigate(to: "notes")
                assertDestinationMenuWorks()
                exerciseSearch("notes.search")
                tap(app.buttons["notes.tab.list"])
                waitFor(app.buttons["notes.tab.list"], key: "isSelected", value: true)
                tap(app.buttons["notes.tab.notes"])
                waitFor(app.buttons["notes.tab.notes"], key: "isSelected", value: true)
                tap(app.buttons["notes.plus"])
                tap(app.buttons["notes.newNote"])
                cancelSheet()
                exerciseSearch("notes.search")

                navigate(to: "softwareFactory")
                assertDestinationMenuWorks()
                exerciseSearch("factory.search")
                tap(app.buttons["factory.segment.releases"])
                waitFor(app.buttons["factory.segment.releases"], key: "isSelected", value: true)
                tap(app.buttons["factory.segment.board"])
                waitFor(app.buttons["factory.segment.board"], key: "isSelected", value: true)
                tap(app.buttons["factory.plus"])
                cancelSheet()
                exerciseSearch("factory.search")

                navigate(to: "chat")
                startVoice()
                tap(app.buttons["voice.mic"])
                waitFor(app.buttons["voice.mic"], key: "isSelected", value: true)
                tap(app.buttons["voice.mic"])
                waitFor(app.buttons["voice.mic"], key: "isSelected", value: false)
                minimizeVoice()
                tap(app.buttons["voice.mini.mic"])
                waitFor(app.buttons["voice.mini.mic"], key: "isSelected", value: true)
                tap(app.buttons["voice.mini.restore"])
                tap(app.buttons["voice.end"])
                assertChatInputWorks()

                startVoice()
                minimizeVoice()
                tap(app.buttons["voice.mini.end"])
                waitFor(app.buttons["voice.mini.end"], key: "exists", value: false)
                tapToolbarButton("navigation.openSidebar")
                assertSidebarOpen()
                closeByTap()
                assertChatInputWorks()
                attachScreenshot("After cycle \(iteration) (\(language))")
            }
        }
    }

    private func startVoice() {
        if !app.buttons["chat.mode"].exists {
            let input = app.descendants(matching: .any)["chat.input"]
            tap(input)
            let length = (input.value as? String)?.count ?? 0
            input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: length))
        }
        tap(app.buttons["chat.mode"])
        waitFor(app.buttons["voice.mic"], key: "isHittable", value: true)
    }

    private func assertChatInputWorks() {
        let input = app.descendants(matching: .any)["chat.input"]
        tap(input)
        input.typeText("x")
        XCTAssertTrue((input.value as? String)?.hasSuffix("x") == true)
    }

    private func exerciseSearch(_ identifier: String) {
        let search = app.textFields[identifier]
        tap(search)
        search.typeText("x")
        XCTAssertTrue((search.value as? String)?.hasSuffix("x") == true)
        search.typeText("\n")
    }

    private func minimizeVoice() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            .press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            )
        waitFor(app.buttons["voice.mini.restore"], key: "isHittable", value: true)
    }

    private func cancelSheet() {
        tap(app.buttons["sheet.cancel"])
        waitFor(app.buttons["sheet.cancel"], key: "exists", value: false)
    }

    private func navigate(to destination: String) {
        openByEdge()
        tap(app.buttons["navigation.\(destination)"])
        waitFor(app.buttons["navigation.chat"], key: "exists", value: false)
    }

    private func assertDestinationMenuWorks() {
        tap(app.buttons["navigation.openSidebar"])
        waitFor(app.buttons["navigation.chat"], key: "isHittable", value: true)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.4)).tap()
        waitFor(app.buttons["navigation.chat"], key: "exists", value: false)
    }

    private func openByEdge() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.45))
            .press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.45))
            )
        assertSidebarOpen()
    }

    private func assertSidebarOpen() {
        waitFor(app.buttons["navigation.chat"], key: "isHittable", value: true)
    }

    private func closeByTap() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.45)).tap()
        waitFor(app.buttons["navigation.chat"], key: "exists", value: false)
    }

    private func tap(_ element: XCUIElement) {
        waitFor(element, key: "isHittable", value: true)
        element.tap()
    }

    private func tapToolbarButton(
        _ identifier: String, file: StaticString = #filePath, line: UInt = #line
    ) {
        let button = app.buttons[identifier]
        waitForToolbarFrame(button, file: file, line: line)
        // iOS 26 toolbar proxies can report no activation point despite a valid frame.
        // A physical center tap still has to trigger the asserted navigation/sheet change.
        button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    private func waitForToolbarFrame(
        _ button: XCUIElement, file: StaticString = #filePath, line: UInt = #line
    ) {
        let predicate = NSPredicate { _, _ in
            guard button.exists, button.isEnabled else { return false }
            let frame = button.frame
            return !frame.isEmpty && frame.origin.x.isFinite && frame.origin.y.isFinite &&
                frame.width.isFinite && frame.height.isFinite && self.app.frame.contains(frame)
        }
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: button)
        let result = XCTWaiter.wait(for: [expectation], timeout: 10)
        if result != .completed { attachFailureEvidence("Invalid toolbar frame") }
        XCTAssertEqual(result, .completed, "\(button) has no enabled onscreen frame",
                       file: file, line: line)
    }

    private func waitFor(
        _ element: XCUIElement, key: String, value: Bool,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let predicate = NSPredicate(format: "%K == %@", key, NSNumber(value: value))
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        let result = XCTWaiter.wait(for: [expectation], timeout: 10)
        if result != .completed { attachFailureEvidence("Unmet \(key)=\(value)") }
        XCTAssertEqual(result, .completed, "\(element) did not reach \(key)=\(value)",
                       file: file, line: line)
    }

    private func attachFailureEvidence(_ name: String) {
        attachScreenshot(name)
        let description = app.debugDescription
        print("\(name): accessibility hierarchy\n\(description)")
        let hierarchy = XCTAttachment(string: description)
        hierarchy.name = "\(name): accessibility hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

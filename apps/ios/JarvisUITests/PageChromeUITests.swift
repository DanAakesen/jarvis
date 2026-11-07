import XCTest

/// The content must actually move before a capture is called a scrolled-header check.
final class PageChromeUITests: XCTestCase {
    private let app = XCUIApplication()

    func testPrimaryPagesDark() { checkPrimaryPages(theme: "dark") }
    func testPrimaryPagesLight() { checkPrimaryPages(theme: "light") }
    func testFactoryDark() { checkFactory(theme: "dark") }
    func testFactoryLight() { checkFactory(theme: "light") }

    private func launch(theme: String) {
        app.launchArguments = ["--ui-test-navigation", "--ui-test-task-list-board", "--ui-test-page-chrome",
            "-jarvis.appLanguage", "en", "-jarvis.appTheme", theme, "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-AppleInterfaceStyle", theme == "dark" ? "Dark" : "Light"]
        app.launch()
        navigate("chat")
    }

    private func checkPrimaryPages(theme: String) {
        launch(theme: theme)
        defer { app.terminate() }
        for (page, marker) in [("notes", "notes.task.row." + String(repeating: "0", count: 63) + "1"),
                               ("health", "health.hero.training"), ("settings", "settings.row.language"),
                               ("usage", "usage.hero")] {
            navigate(page)
            if page == "notes" {
                let tasks = app.buttons["notes.tab.tasks"]
                XCTAssertTrue(tasks.waitForExistence(timeout: 10))
                tasks.tap()
            }
            let content = app.descendants(matching: .any).matching(identifier: marker).firstMatch
            XCTAssertTrue(content.waitForExistence(timeout: 10), marker)
            if page == "notes" {
                XCTAssertGreaterThan(content.frame.height, 70, "The long task title must wrap to two lines")
                let metadata = content.buttons["notes.task.open"].value as? String ?? ""
                XCTAssertFalse(metadata.contains("Tasks"))
                XCTAssertFalse(metadata.contains("Inbox"))
                let roadmapID = "notes.task.row." + String(repeating: "0", count: 63) + "3"
                let roadmap = app.descendants(matching: .any)[roadmapID].buttons["notes.task.open"]
                if roadmap.exists {
                    XCTAssertFalse((roadmap.value as? String ?? "").contains("Roadmap draft"), "No source labels remain, including meaningful note titles")
                }
            }
            capture("build79-\(page)-resting-\(theme)")
            scrollAndCapture(marker: content, name: "build79-\(page)-scrolled-\(theme)")
            if page == "notes" {
                XCTAssertTrue(app.buttons["notes.plus"].isHittable)
                let search = app.descendants(matching: .any)["notes.search"]
                XCTAssertTrue(search.isHittable)
                search.tap()
                search.typeText("plants")
                capture("build79-notes-search-keyboard-\(theme)")
            }
            if page == "health" {
                XCTAssertTrue(app.buttons["health.mode.0"].isHittable)
                XCTAssertTrue(app.buttons["health.mode.1"].isHittable)
            }
        }
    }

    private func checkFactory(theme: String) {
        launch(theme: theme)
        defer { app.terminate() }
        navigate("softwareFactory")
        let column = app.buttons["factory.column.in_progress"]
        XCTAssertTrue(column.waitForExistence(timeout: 10))
        column.tap()
        let first = app.staticTexts["Synthetic scrolling task 1"]
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        capture("build79-factory-resting-\(theme)")
        scrollAndCapture(marker: first, name: "build79-factory-scrolled-\(theme)")
        XCTAssertTrue(app.buttons["factory.segment.board"].isHittable)
        XCTAssertTrue(app.buttons["factory.segment.releases"].isHittable)
        XCTAssertTrue(app.buttons["factory.plus"].isHittable)
        app.buttons["factory.plus"].tap()
        XCTAssertTrue(app.buttons["sheet.cancel"].waitForExistence(timeout: 5))
        app.buttons["sheet.cancel"].tap()
        XCTAssertTrue(app.buttons["factory.plus"].waitForExistence(timeout: 5))
    }

    private func navigate(_ destination: String) {
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.tap()
        let target = app.buttons["navigation.\(destination)"]
        XCTAssertTrue(target.waitForExistence(timeout: 5))
        target.tap()
    }

    private func scrollAndCapture(marker: XCUIElement, name: String) {
        let title = app.staticTexts["page.title"]
        let top = title.frame.minY
        let original = marker.frame.minY
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.68))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.25))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(!marker.exists || marker.frame.minY < original - 20,
                      "Capture requires real content scrolling, not just a stationary title")
        XCTAssertTrue(title.isHittable)
        XCTAssertTrue(app.windows.firstMatch.frame.contains(title.frame), "The complete header stays on screen")
        XCTAssertEqual(title.frame.minY, top, accuracy: 1)
        XCTAssertTrue(app.buttons["navigation.openSidebar"].isHittable)
        capture(name)
    }

    private func capture(_ name: String) {
        let title = app.staticTexts["page.title"].frame
        let sidebar = app.buttons["navigation.openSidebar"].frame
        let geometry = XCTAttachment(string: "window=\(app.windows.firstMatch.frame); title=\(title); sidebar=\(sidebar)")
        geometry.name = "\(name)-geometry"
        geometry.lifetime = .keepAlways
        add(geometry)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

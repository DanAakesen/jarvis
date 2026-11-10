import XCTest

final class NotesRedesignUITests: XCTestCase {
    private let app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false }

    func testLibraryPinsFoldersRawAndEditingDark() { exercise(theme: "dark") }
    func testLibraryPinsFoldersRawAndEditingLight() { exercise(theme: "light") }

    func testStaticStructureAndTasksDoNotWaitForSlowGraph() {
        app.launchArguments = ["--ui-test-navigation", "--ui-test-notes-slow-graph",
                               "-jarvis.appLanguage", "en", "-AppleLanguages", "(en)"]
        app.launch()
        defer { app.terminate() }
        tap("navigation.openSidebar")
        tap("navigation.notes")
        XCTAssertTrue(app.buttons["notes.tab.tasks"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.descendants(matching: .any)["notes.hero"].exists)
        XCTAssertTrue(app.buttons["notes.plus"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["notes.search"].exists)
        capture("notes-static-structure-before-graph")
        app.buttons["notes.tab.tasks"].tap()
        let task = app.descendants(matching: .any)["notes.task.row." + String(repeating: "1", count: 64)]
        XCTAssertTrue(task.waitForExistence(timeout: 2), "Tasks must finish without waiting for the graph")
    }

    func testFailedRefreshRetainsLibraryAndOffersRetry() {
        app.launchArguments = ["--ui-test-navigation", "--ui-test-notes-refresh-failure",
                               "-jarvis.appLanguage", "en", "-AppleLanguages", "(en)"]
        app.launch()
        defer { app.terminate() }
        tap("navigation.openSidebar")
        tap("navigation.notes")
        let note = app.buttons["notes.note.welcome.md"]
        XCTAssertTrue(note.waitForExistence(timeout: 8))
        let scroll = app.scrollViews["notes.scroll"]
        scroll.swipeDown()
        let retry = app.buttons["notes.retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 8))
        XCTAssertTrue(note.exists, "A failed refresh must not remove the last library")
        XCTAssertTrue(app.buttons["notes.tab.notes"].isSelected)
        XCTAssertTrue(app.buttons["notes.plus"].exists)
        capture("notes-retained-library-refresh-failure")
        for _ in 0..<3 {
            if retry.isHittable { break }
            scroll.swipeDown()
        }
        XCTAssertTrue(retry.isHittable)
        retry.tap()
        let recovered = NSPredicate { _, _ in !retry.exists && note.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: recovered, object: nil)], timeout: 8), .completed)
    }

    func testLargeLibrarySidebarOpensAfterScrollingAndReturnsToChat() {
        app.launchArguments = ["--ui-test-navigation", "--ui-test-large-notes",
                               "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        tap("navigation.openSidebar")
        tap("navigation.notes")
        XCTAssertTrue(app.buttons["notes.tab.notes"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.descendants(matching: .any)["notes.hero"].exists)
        capture("notes-large-library-before-sidebar")

        for cycle in 0..<2 {
            let menu = app.buttons["navigation.openSidebar"]
            XCTAssertTrue(menu.isHittable)
            menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let sidebar = app.descendants(matching: .any).matching(identifier: "navigation.sidebar").firstMatch
            XCTAssertTrue(sidebar.waitForExistence(timeout: 2),
                          "The Notes sidebar must open within two seconds, including after scrolling")
            XCTAssertTrue(app.buttons["navigation.chat"].isHittable)
            capture("notes-large-library-sidebar-\(cycle)")
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.5)).tap()
            let closed = NSPredicate { _, _ in !sidebar.exists && menu.isHittable }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: closed, object: nil)],
                                         timeout: 5), .completed)
            app.swipeUp()
        }

        tap("navigation.openSidebar")
        tap("navigation.chat")
        XCTAssertTrue(app.descendants(matching: .any)["chat.input"].waitForExistence(timeout: 8))
        XCTAssertEqual(app.state, .runningForeground, "Notes navigation must not terminate the app")
    }

    private func exercise(theme: String) {
        app.launchArguments = ["--ui-test-navigation", "-jarvis.appLanguage", "en", "-jarvis.appTheme", theme,
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        tap("navigation.openSidebar")
        tap("navigation.notes")
        XCTAssertTrue(app.buttons["notes.tab.notes"].waitForExistence(timeout: 8))
        let browse = app.buttons["notes.browseFolders"]
        for _ in 0..<6 { if browse.isHittable { break }; app.swipeUp() }
        tap("notes.browseFolders")
        XCTAssertTrue(app.buttons["notes.browser.newFolder"].waitForExistence(timeout: 5))
        XCTAssertGreaterThan(app.buttons["notes.browser.newFolder"].frame.midX, app.windows.firstMatch.frame.midX)
        capture("notes-folders-\(theme)")
        tap("notes.browser.done")
        let note = app.buttons["notes.note.welcome.md"]
        // The restored Overview moves this row below the transparent dock.
        // AX may call a partially covered row hittable; require its full frame
        // above the dock before a real tap, without bypassing hit testing.
        let dock = app.buttons["notes.plus"]
        for _ in 0..<4 {
            if note.isHittable && note.frame.maxY < dock.frame.minY - 8 { break }
            app.scrollViews["notes.scroll"].swipeUp()
        }
        XCTAssertTrue(note.isHittable)
        XCTAssertLessThan(note.frame.maxY, dock.frame.minY - 8)
        capture("notes-editor-target-\(theme)")
        note.tap()
        XCTAssertTrue(app.buttons["note.raw"].waitForExistence(timeout: 8))
        capture("notes-editor-\(theme)")
        let pin = app.buttons["note.pin"]
        if pin.label == "Pin note" { pin.tap() }
        tap("note.raw")
        let raw = app.textViews["note.rawEditor"]
        XCTAssertTrue(raw.waitForExistence(timeout: 5))
        XCTAssertTrue((raw.value as? String ?? "").contains("# Welcome"))
        raw.tap()
        raw.typeText("\nNew synthetic text")
        tap("note.raw")
        capture("notes-formatted-edited-\(theme)")
        tap("note.done")
        XCTAssertTrue(app.buttons["notes.browseFolders"].waitForExistence(timeout: 10))
        for _ in 0..<4 { if app.buttons["notes.pinned.welcome.md"].isHittable { break }; app.swipeDown() }
        tap("notes.pinned.welcome.md")
        tap("note.raw")
        XCTAssertTrue((app.textViews["note.rawEditor"].value as? String ?? "").contains("New synthetic text"))
        tap("note.back")
        capture("notes-library-\(theme)")
    }

    private func tap(_ id: String) {
        let button = app.buttons[id]
        XCTAssertTrue(button.waitForExistence(timeout: 8), id)
        XCTAssertTrue(button.isHittable, id)
        button.tap()
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

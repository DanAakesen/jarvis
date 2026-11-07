import XCTest

final class NotesRedesignUITests: XCTestCase {
    private let app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false }

    func testLibraryPinsFoldersRawAndEditingDark() { exercise(theme: "dark") }
    func testLibraryPinsFoldersRawAndEditingLight() { exercise(theme: "light") }

    private func exercise(theme: String) {
        app.launchArguments = ["--ui-test-navigation", "-jarvis.appLanguage", "en", "-jarvis.appTheme", theme,
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        tap("navigation.openSidebar")
        tap("navigation.notes")
        XCTAssertTrue(app.buttons["notes.tab.notes"].waitForExistence(timeout: 8))
        tap("notes.browseFolders")
        XCTAssertTrue(app.buttons["notes.browser.newFolder"].waitForExistence(timeout: 5))
        XCTAssertGreaterThan(app.buttons["notes.browser.newFolder"].frame.midX, app.windows.firstMatch.frame.midX)
        capture("notes-folders-\(theme)")
        tap("notes.browser.done")
        let note = app.buttons["notes.note.welcome.md"]
        for _ in 0..<4 { if note.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(note.isHittable)
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

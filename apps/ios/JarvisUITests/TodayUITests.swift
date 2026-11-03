import XCTest

/// Home (Today) runs on fixed fixture data (`--ui-test-today`): 2 November 2026, 14:30, 6,300 steps so far.
final class TodayUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch(language: String = "en") {
        app.launchArguments = [
            "--ui-test-navigation",
            "--ui-test-today",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        app.launch()
    }

    private func screen(_ name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "screen.\(name)").firstMatch
    }

    func testTodayIsTheLaunchPageInDanishAndEnglish() {
        for language in ["da", "en"] {
            launch(language: language)
            XCTAssertTrue(screen("today").waitForExistence(timeout: 10), "Home must be the first screen (\(language))")
            XCTAssertTrue(app.descendants(matching: .any)["today.greeting"].waitForExistence(timeout: 5))
            XCTAssertFalse(screen("chat").exists)
            app.terminate()
        }
    }

    func testHomeIsTheActiveSidebarRowOnToday() {
        launch()
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.tap()
        let home = app.buttons["navigation.today"]
        XCTAssertTrue(home.waitForExistence(timeout: 3))
        XCTAssertTrue(home.isSelected, "Home is the active row on Today")
        XCTAssertFalse(app.buttons["navigation.chat"].isSelected, "Chat is not active on Today")
    }

    func testPlusMenuOpensTaskAndNoteSheets() {
        launch()
        let plus = app.buttons["today.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 10))
        for item in ["today.plus.task", "today.plus.note"] {
            plus.tap()
            let entry = app.buttons[item]
            XCTAssertTrue(entry.waitForExistence(timeout: 3), item)
            entry.tap()
            let close = app.buttons["sheet.cancel"]
            XCTAssertTrue(close.waitForExistence(timeout: 5), "\(item) must open its sheet")
            close.tap()
            XCTAssertTrue(plus.waitForExistence(timeout: 5))
        }
    }

    func testRangeToggleSwitchesBetweenHourlyAndDailyBars() {
        launch()
        let hourlyLast = app.buttons["today.bar.16"]
        XCTAssertTrue(hourlyLast.waitForExistence(timeout: 10), "Today shows hourly bars")
        let caption = app.staticTexts["today.steps.caption"]
        XCTAssertTrue(caption.waitForExistence(timeout: 3))
        let hourlyCaption = caption.label
        app.buttons["today.range.7"].tap()
        XCTAssertTrue(app.buttons["today.bar.6"].waitForExistence(timeout: 3), "7d shows seven daily bars")
        XCTAssertFalse(app.buttons["today.bar.7"].exists)
        XCTAssertNotEqual(caption.label, hourlyCaption)
        app.buttons["today.range.30"].tap()
        XCTAssertTrue(app.buttons["today.bar.29"].waitForExistence(timeout: 3), "30d shows thirty daily bars")
        app.buttons["today.range.1"].tap()
        XCTAssertTrue(app.buttons["today.bar.16"].waitForExistence(timeout: 3))
    }

    func testBarSelectionSetsTheRingAndResets() {
        launch()
        let ring = app.descendants(matching: .any)["today.steps.ring"]
        XCTAssertTrue(ring.waitForExistence(timeout: 10))
        XCTAssertEqual(ring.value as? String, "6300")
        let bar = app.buttons["today.bar.2"]
        XCTAssertTrue(bar.waitForExistence(timeout: 3))
        bar.tap()
        XCTAssertEqual(ring.value as? String, "1920", "A tapped bar sets the ring to its value")
        bar.tap()
        XCTAssertEqual(ring.value as? String, "6300", "Tapping the bar again resets the ring")
        bar.tap()
        XCTAssertEqual(ring.value as? String, "1920")
        app.buttons["today.range.7"].tap()
        XCTAssertEqual(ring.value as? String, "6300", "Changing the range resets the selection")
    }

    func testGymSheetOpensSavesAndCloses() {
        launch()
        let log = app.buttons["today.logWorkout"]
        XCTAssertTrue(log.waitForExistence(timeout: 10))
        log.tap()
        let chest = app.buttons["today.gym.session.chest"]
        XCTAssertTrue(chest.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["sheet.confirm"].isEnabled, "Saving needs a session type")
        chest.tap()
        let save = app.buttons["sheet.confirm"]
        XCTAssertTrue(save.isEnabled)
        save.tap()
        XCTAssertTrue(app.descendants(matching: .any)["today.gym.status"].waitForExistence(timeout: 5))
        app.buttons["sheet.cancel"].tap()
        XCTAssertTrue(log.waitForExistence(timeout: 5))
        XCTAssertTrue(log.isHittable)
    }

    func testTypingOpensChatAndHomeReturns() {
        launch()
        let input = app.textFields["today.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("H")
        XCTAssertTrue(screen("chat").waitForExistence(timeout: 10), "Typing on Home continues in Chat")
        XCTAssertTrue(app.textViews["chat.input"].waitForExistence(timeout: 5)
                      || app.textFields["chat.input"].waitForExistence(timeout: 5))
        let home = app.buttons["chat.backToToday"].firstMatch
        if !home.waitForExistence(timeout: 10) {
            XCTFail("chat.backToToday missing. \(String(app.debugDescription.prefix(6000)))")
            return
        }
        home.tap()
        XCTAssertTrue(screen("today").waitForExistence(timeout: 10), "Reversing returns to Home")
    }

    func testVoiceButtonOpensVoiceAndMinimizingReturnsHome() {
        launch()
        let voice = app.buttons["today.voice"]
        XCTAssertTrue(voice.waitForExistence(timeout: 10))
        voice.tap()
        XCTAssertTrue(screen("voice").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["voice.mic"].waitForExistence(timeout: 10))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            .press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            )
        XCTAssertTrue(screen("today").waitForExistence(timeout: 10), "Minimizing voice returns to Home")
    }
}

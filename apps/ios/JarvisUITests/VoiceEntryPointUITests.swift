import XCTest

/// Voice is not a sidebar item. It opens from the composer's voice button and, once minimized, from the mini bar.
final class VoiceEntryPointUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testComposerVoiceButtonOpensVoiceScreenInDanish() {
        assertComposerVoiceButtonOpensVoice(language: "da")
    }

    func testComposerVoiceButtonOpensVoiceScreenInEnglish() {
        assertComposerVoiceButtonOpensVoice(language: "en")
    }

    func testMiniBarRestoreReturnsToVoiceScreen() {
        launch(language: "en")
        openVoiceFromComposer()
        minimizeVoice()
        let restore = app.buttons["voice.mini.restore"]
        XCTAssertTrue(restore.waitForExistence(timeout: 10), "Minimizing voice must show the mini bar")
        restore.tap()
        assertVoiceScreenShown()
    }

    private func assertComposerVoiceButtonOpensVoice(language: String) {
        launch(language: language)
        openVoiceFromComposer()
    }

    private func launch(language: String) {
        app.launchArguments = [
            "--ui-test-navigation",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        app.launch()
    }

    private func openVoiceFromComposer() {
        let mode = app.buttons["chat.mode"]
        XCTAssertTrue(mode.waitForExistence(timeout: 10), "The composer voice button must exist")
        mode.tap()
        assertVoiceScreenShown()
    }

    private func assertVoiceScreenShown() {
        let screen = app.descendants(matching: .any).matching(identifier: "screen.voice").firstMatch
        XCTAssertTrue(screen.waitForExistence(timeout: 10), "Navigating to voice must show the voice screen")
        let mic = app.buttons["voice.mic"]
        XCTAssertTrue(mic.waitForExistence(timeout: 10), "The voice controls must be visible")
        XCTAssertTrue(mic.isHittable, "A started voice session must show a usable microphone control")
        XCTAssertFalse(app.buttons["chat.mode"].exists, "The voice screen must replace the chat composer")
    }

    private func minimizeVoice() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            .press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            )
    }
}

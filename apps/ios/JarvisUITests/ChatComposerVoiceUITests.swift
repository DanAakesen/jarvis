import XCTest

final class ChatComposerVoiceUITests: XCTestCase {
    func testVoiceActionOpensVoiceScreen() {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-chat-fixture"]
        app.launch()

        let dictateButton = app.buttons["chat.dictate"]
        XCTAssertTrue(dictateButton.waitForExistence(timeout: 10))

        let voiceAction = app.buttons["chat.voiceOrSend"]
        XCTAssertTrue(voiceAction.exists)
        voiceAction.tap()

        let voiceOrb = app.descendants(matching: .any)
            .matching(identifier: "voice.orb")
            .firstMatch
        XCTAssertTrue(voiceOrb.waitForExistence(timeout: 10))
    }

    func testVoiceActionBecomesSendForNonemptyDraft() {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-chat-fixture"]
        app.launch()

        let voiceAction = app.buttons["chat.voiceOrSend"]
        XCTAssertTrue(voiceAction.waitForExistence(timeout: 10))
        let emptyDraftAction = voiceAction.value as? String

        let input = app.descendants(matching: .any)
            .matching(identifier: "chat.input")
            .firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Hello")

        XCTAssertNotEqual(voiceAction.value as? String, emptyDraftAction)
    }
}

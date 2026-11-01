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
        XCTAssertTrue(voiceAction.isHittable, "Voice action must have a hittable button target")
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

    func testPlusMenuOpensBesideItsTrigger() {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-chat-fixture"]
        app.launch()

        let plusButton = app.buttons["chat.plus"]
        XCTAssertTrue(plusButton.waitForExistence(timeout: 10))
        XCTAssertTrue(plusButton.isHittable)
        plusButton.tap()

        let plusMenu = app.descendants(matching: .any)
            .matching(identifier: "chat.plusMenu")
            .firstMatch
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 10))

        let menuFrame = plusMenu.frame
        let triggerFrame = plusButton.frame
        let verticalGap = max(
            max(triggerFrame.minY - menuFrame.maxY, menuFrame.minY - triggerFrame.maxY),
            0
        )
        XCTAssertLessThan(verticalGap, 160, "Plus menu must stay anchored beside its trigger")
    }
}

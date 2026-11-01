import XCTest

final class ChatComposerUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testSentMessageBubbleIsVisibleAboveComposer() {
        for language in ["en", "da"] {
            let app = launch(language: language)
            let input = app.descendants(matching: .any)["chat.input"]
            XCTAssertTrue(input.waitForExistence(timeout: 10))
            input.tap()
            input.typeText("The fixture turn")
            let send = app.buttons["chat.send"]
            XCTAssertTrue(send.isEnabled)
            send.tap()

            let bubble = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label == %@", "You: The fixture turn"))
                .firstMatch
            XCTAssertTrue(bubble.waitForExistence(timeout: 5), "The sent message must appear immediately.")
            XCTAssertTrue(bubble.isHittable)
            XCTAssertLessThanOrEqual(bubble.frame.maxY, input.frame.minY)
            XCTAssertTrue(app.windows.firstMatch.frame.contains(bubble.frame))
            app.terminate()
        }
    }

    func testPlusMenuOpensNextToThePlusButton() {
        for language in ["en", "da"] {
            let app = launch(language: language)
            let plus = app.buttons["chat.plus"]
            XCTAssertTrue(plus.waitForExistence(timeout: 10))
            plus.tap()

            let item = cameraMenuItem(in: app, language: language)
            XCTAssertTrue(item.waitForExistence(timeout: 5))
            let window = app.windows.firstMatch.frame
            XCTAssertGreaterThan(item.frame.minY, window.height * 0.3, "The menu must not open at the top of the screen.")
            XCTAssertLessThanOrEqual(abs(item.frame.minX - plus.frame.minX), 160)
            XCTAssertLessThanOrEqual(abs(item.frame.maxY - plus.frame.minY), 400)
            app.terminate()
        }
    }

    func testCameraSheetOpensFromThePlusMenu() {
        for language in ["en", "da"] {
            let app = launch(language: language, extraArguments: ["--ui-test-camera-sheet"])
            let plus = app.buttons["chat.plus"]
            XCTAssertTrue(plus.waitForExistence(timeout: 10))
            plus.tap()
            let camera = cameraMenuItem(in: app, language: language)
            XCTAssertTrue(camera.waitForExistence(timeout: 10))
            XCTAssertTrue(camera.isEnabled)
            camera.tap()

            XCTAssertTrue(app.buttons["camera.shutter"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.buttons["camera.close"].exists)
            app.buttons["camera.close"].tap()
            XCTAssertTrue(app.buttons["camera.shutter"].waitForNonExistence(timeout: 5))
            app.terminate()
        }
    }

    /// Native menu items may not keep the SwiftUI identifier once enabled, so match the localized title too.
    private func cameraMenuItem(in app: XCUIApplication, language: String) -> XCUIElement {
        let title = language == "da" ? "Kamera" : "Camera"
        return app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@ OR label == %@", "chat.plus.camera", title))
            .firstMatch
    }

    private func launch(language: String, extraArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--screenshot-chat-fixture",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ] + extraArguments
        app.launch()
        return app
    }
}

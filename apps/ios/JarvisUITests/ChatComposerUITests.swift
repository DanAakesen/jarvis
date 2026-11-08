import XCTest

final class ChatComposerUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testRuntimeTestKeepsNormalDraftAndHistorySeparate() {
        let app = launch(language: "en")
        defer { app.terminate() }
        let input = app.descendants(matching: .any)["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Keep my normal draft")
        app.buttons["chat.plus"].tap()
        let entry = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ OR label == %@", "chat.plus.testRuntime", "Test agent runtime"
        )).firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 5))
        entry.tap()
        let current = app.buttons["runtimeTest.current"]
        XCTAssertTrue(current.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["runtimeTest.copilot"].isEnabled)
        XCTAssertTrue(app.staticTexts["Copilot testing has not been activated on the server."].waitForExistence(timeout: 10))
        app.buttons["runtimeTest.retry"].tap()
        let available = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: current)
        XCTAssertEqual(XCTWaiter.wait(for: [available], timeout: 10), .completed)
        current.tap()
        let selectorCapture = XCTAttachment(screenshot: app.screenshot())
        selectorCapture.name = "runtime-test-selector"
        selectorCapture.lifetime = .keepAlways
        add(selectorCapture)
        app.buttons["runtimeTest.open"].tap()
        let testInput = app.descendants(matching: .any)["runtimeTest.input"]
        XCTAssertTrue(testInput.waitForExistence(timeout: 10))
        testInput.tap()
        testInput.typeText("Synthetic test message")
        app.buttons["runtimeTest.send"].tap()
        XCTAssertTrue(app.staticTexts["runtimeTest.acknowledgment"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["runtimeTest.tool.00000000-0000-4000-8000-000000000001"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["runtimeTest.progress"].exists)
        let progressCapture = XCTAttachment(screenshot: app.screenshot())
        progressCapture.name = "runtime-test-live-progress"
        progressCapture.lifetime = .keepAlways
        add(progressCapture)
        XCTAssertTrue(app.descendants(matching: .any)["runtimeTest.message.991"].waitForExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "runtime-test-isolated-chat"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["sheet.cancel"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "Keep my normal draft")
        XCTAssertFalse(app.staticTexts["Synthetic isolated runtime reply"].exists)
    }

    func testVoiceAndChatShareHistoryAndTheNextTypedTurnUsesTheChatSession() {
        let app = launch(language: "en", extraArguments: ["--ui-test-voice-history"])
        let spokenReply = app.descendants(matching: .any)["chat.reply.421"]
        XCTAssertTrue(spokenReply.waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "You: Synthetic spoken question")
        ).firstMatch.exists)
        let input = app.descendants(matching: .any)["chat.input"]
        input.tap()
        input.typeText("The fixture turn")
        app.buttons["chat.send"].tap()
        // The fixture accepts turns only on chat session 12, never voice session 13.
        let typedReply = app.descendants(matching: .any)["chat.reply.431"]
        XCTAssertTrue(typedReply.waitForExistence(timeout: 10))
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "chat.reply.431").count, 1)
        app.terminate()
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

    /// The bell and the side menu are the reference buttons: two identical 48 pt glass circles.
    func testChatHeaderButtonsAreSquareCircles() {
        let app = launch(language: "en")
        defer { app.terminate() }
        let bell = app.buttons["chat.notifications"].firstMatch
        let menu = app.buttons["navigation.openSidebar"].firstMatch
        XCTAssertTrue(bell.waitForExistence(timeout: 10))
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        // Covers only the simple icon button component (JarvisIconButton/JarvisMenuButton); add new icon buttons to this list by hand, never sweep all buttons.
        for button in [bell, menu] {
            XCTAssertEqual(button.frame.width, button.frame.height, accuracy: 0.5, "\(button.identifier) must be square")
            XCTAssertEqual(button.frame.width, 48, accuracy: 0.5, "\(button.identifier) must be 48 pt")
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
        for language in ["en"] {
            let app = launch(language: language, extraArguments: ["--ui-test-camera-sheet"])
            let plus = app.buttons["chat.plus"]
            XCTAssertTrue(plus.waitForExistence(timeout: 10))
            plus.tap()
            let camera = cameraMenuItem(in: app, language: language)
            let cameraReady = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == true AND enabled == true AND hittable == true"),
                object: camera
            )
            let isCameraReady = XCTWaiter.wait(for: [cameraReady], timeout: 10) == .completed
            if !isCameraReady { attachCameraFailure(in: app, stage: "menu-not-ready") }
            XCTAssertTrue(isCameraReady, "The Camera menu item must be enabled and hittable before selection.")
            camera.tap()

            let menuDismissed = camera.waitForNonExistence(timeout: 5)
            if !menuDismissed { attachCameraFailure(in: app, stage: "menu-not-dismissed") }
            XCTAssertTrue(menuDismissed, "Selecting Camera once must dismiss the Plus menu.")

            let shutter = app.descendants(matching: .any)["camera.shutter"]
            let sheetOpened = shutter.waitForExistence(timeout: 10)
            if !sheetOpened { attachCameraFailure(in: app, stage: "sheet-not-presented") }
            XCTAssertTrue(
                sheetOpened,
                "The camera sheet must open. Hierarchy: \(app.debugDescription)"
            )
            XCTAssertTrue(
                app.descendants(matching: .any)["camera.lens.wide"].exists,
                "A lens button must be shown even without a capture device"
            )
            XCTAssertFalse(app.descendants(matching: .any)["camera.mode"].exists, "The camera is picture-only")
            let close = app.descendants(matching: .any)["camera.close"]
            XCTAssertTrue(close.exists)
            close.tap()
            XCTAssertTrue(shutter.waitForNonExistence(timeout: 5))
            app.terminate()
        }
    }

    private func attachCameraFailure(in app: XCUIApplication, stage: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "camera-\(stage)"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "camera-\(stage)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
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

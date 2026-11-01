import XCTest

final class JarvisSmokeUITests: XCTestCase {
    private var app: XCUIApplication!
    private var appearance = ""
    private var language = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testSmokeFlowAndCaptureEveryScreen() {
        for appearance in ["light", "dark"] {
            for language in ["da", "en"] {
                self.appearance = appearance
                self.language = language
                runSmokeFlow()
            }
        }
    }

    private func runSmokeFlow() {
        launchChat(captureSignIn: true)

        capture("chat")
        exerciseAttachmentMenu()
        exerciseNotifications()
        exerciseSidebar()

        let destinations: [(String, String)] = [
            ("proactive", localized("Proactive", "Proaktiv")),
            ("status", "Status"),
            ("usage", localized("Usage", "Forbrug")),
            ("softwareFactory", localized("Software Factory", "Softwarefabrik")),
            ("health", localized("Health", "Sundhed")),
            ("workspaces", localized("Workspaces", "Arbejdsområder")),
            ("notes", localized("Notes", "Noter")),
            ("chat", "Chat")
        ]
        for (destination, title) in destinations {
            dragOpenSidebar()
            let row = app.buttons["sidebar.\(destination)"]
            XCTAssertTrue(row.waitForExistence(timeout: 10))
            XCTAssertTrue(row.isEnabled)
            row.tap()
            assertScreen(title)
            capture("screen-\(destination)")
        }

        dragOpenSidebar()
        let settings = app.buttons["sidebar.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        assertScreen(localized("Settings", "Indstillinger"))
        capture("screen-settings")

        dragOpenSidebar()
        let chat = app.buttons["sidebar.chat"]
        XCTAssertTrue(chat.waitForExistence(timeout: 10))
        chat.tap()
        assertScreen("Chat")

        let voice = app.segmentedControls["chat.mode"].buttons["Voice"]
        XCTAssertTrue(voice.waitForExistence(timeout: 10))
        voice.tap()
        let endVoice = app.buttons["voice.end"]
        XCTAssertTrue(endVoice.waitForExistence(timeout: 10))
        XCTAssertTrue(endVoice.isEnabled)
        capture("screen-voice")
        endVoice.tap()
        assertScreen("Chat")
        app.terminate()
    }

    private func launchChat(captureSignIn: Bool = false) {
        app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing",
            "--ui-test-theme=\(appearance)",
            "--screenshot-theme=\(appearance)",
            "--ui-test-language=\(language)",
            "--screenshot-factory-fixture",
            "--screenshot-factory-state=board",
            "--screenshot-factory-language=\(language)"
        ]
        app.launch()

        let signIn = app.buttons["gate.primaryAction"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 10))
        if captureSignIn {
            capture("sign-in")
        }
        signIn.tap()

        assertScreen("Chat")
    }

    private func exerciseAttachmentMenu() {
        let addAttachment = app.buttons["chat.addAttachment"]
        XCTAssertTrue(addAttachment.waitForExistence(timeout: 10))
        XCTAssertTrue(addAttachment.isEnabled)
        addAttachment.tap()
        capture("plus-menu")

        let voiceLanguage = app.descendants(matching: .any)["chat.voiceLanguage"]
        let shareScreen = app.buttons[localized("Share screen", "Del skærm")]
        let enableVideo = app.buttons[localized("Enable video", "Slå video til")]
        let attach = app.buttons[localized("Attach file or photo", "Vedhæft fil eller foto")]
        let camera = app.buttons[localized("Camera", "Kamera")]
        XCTAssertTrue(voiceLanguage.waitForExistence(timeout: 10))
        XCTAssertTrue(shareScreen.exists)
        XCTAssertTrue(enableVideo.exists)
        XCTAssertTrue(attach.exists)
        XCTAssertTrue(camera.exists)
        XCTAssertFalse(voiceLanguage.isEnabled)
        XCTAssertFalse(shareScreen.isEnabled)
        XCTAssertFalse(enableVideo.isEnabled)
        XCTAssertTrue(attach.isEnabled)
        XCTAssertFalse(camera.isEnabled)

        attach.tap()
        let chooseFiles = app.buttons[localized("Choose files", "Vælg filer")]
        let photoLibrary = app.buttons[localized("Photo library", "Fotobibliotek")]
        XCTAssertTrue(chooseFiles.waitForExistence(timeout: 10))
        XCTAssertTrue(photoLibrary.exists)

        chooseFiles.tap()
        let filePickerFixture = app.alerts[localized("Choose files", "Vælg filer")]
        XCTAssertTrue(filePickerFixture.waitForExistence(timeout: 10))
        filePickerFixture.buttons[localized("Cancel", "Annuller")].tap()

        addAttachment.tap()
        XCTAssertTrue(attach.waitForExistence(timeout: 10))
        attach.tap()
        XCTAssertTrue(photoLibrary.waitForExistence(timeout: 10))
        photoLibrary.tap()
        let photoPickerFixture = app.alerts[localized("Photo library", "Fotobibliotek")]
        XCTAssertTrue(photoPickerFixture.waitForExistence(timeout: 10))
        photoPickerFixture.buttons[localized("Cancel", "Annuller")].tap()
    }

    private func exerciseNotifications() {
        let notifications = app.buttons["chat.notifications"]
        XCTAssertTrue(notifications.waitForExistence(timeout: 10))
        notifications.tap()
        let done = app.buttons["activity.done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10))
        capture("notifications")
        done.tap()
        XCTAssertFalse(done.waitForExistence(timeout: 2))
    }

    private func exerciseSidebar() {
        dragOpenSidebar()
        capture("sidebar")
        let banking = app.buttons["sidebar.banking"]
        XCTAssertTrue(banking.exists)
        XCTAssertFalse(banking.isEnabled)
        let chat = app.buttons["sidebar.chat"]
        XCTAssertTrue(chat.isHittable)
        chat.tap()

        let openButton = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(openButton.waitForExistence(timeout: 10))
        openButton.tap()
        XCTAssertTrue(chat.waitForExistence(timeout: 10))
        XCTAssertTrue(chat.isHittable)
        chat.tap()
    }

    private func dragOpenSidebar() {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.5))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertTrue(app.buttons["sidebar.chat"].waitForExistence(timeout: 10))
    }

    private func assertScreen(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(
            app.navigationBars.staticTexts[title].waitForExistence(timeout: 10),
            "Expected navigation title \(title)",
            file: file,
            line: line
        )
    }

    private func capture(_ screen: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "ios-\(screen)-\(appearance)-\(language)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func localized(_ english: String, _ danish: String) -> String {
        language == "da" ? danish : english
    }
}

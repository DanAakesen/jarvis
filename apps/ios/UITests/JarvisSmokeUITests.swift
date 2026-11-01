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
        capture("sign-in")
        signIn.tap()

        assertScreen("Chat")
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

    private func exerciseAttachmentMenu() {
        let addAttachment = app.buttons["chat.addAttachment"]
        XCTAssertTrue(addAttachment.waitForExistence(timeout: 10))
        XCTAssertTrue(addAttachment.isEnabled)
        addAttachment.tap()
        capture("plus-menu")

        let chooseFiles = app.buttons["Choose files"]
        let photoLibrary = app.buttons["Photo library"]
        let takePhoto = app.buttons["Take photo"]
        let shareScreen = app.buttons["Share screen unavailable"]
        let cancel = app.buttons["Cancel"]
        XCTAssertTrue(chooseFiles.waitForExistence(timeout: 10))
        XCTAssertTrue(photoLibrary.exists)
        XCTAssertTrue(takePhoto.exists)
        XCTAssertTrue(shareScreen.exists)
        XCTAssertTrue(cancel.exists)
        XCTAssertFalse(takePhoto.isEnabled)
        XCTAssertFalse(shareScreen.isEnabled)

        chooseFiles.tap()
        let filesCancel = app.buttons["Cancel"].firstMatch
        XCTAssertTrue(filesCancel.waitForExistence(timeout: 10))
        filesCancel.tap()

        addAttachment.tap()
        XCTAssertTrue(photoLibrary.waitForExistence(timeout: 10))
        photoLibrary.tap()
        let photosCancel = app.buttons["Cancel"].firstMatch
        XCTAssertTrue(photosCancel.waitForExistence(timeout: 10))
        photosCancel.tap()

        addAttachment.tap()
        XCTAssertTrue(cancel.waitForExistence(timeout: 10))
        cancel.tap()
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
        app.buttons["sidebar.chat"].tap()

        let openButton = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(openButton.waitForExistence(timeout: 10))
        openButton.tap()
        XCTAssertTrue(app.buttons["sidebar.chat"].waitForExistence(timeout: 10))
        app.buttons["sidebar.chat"].tap()
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

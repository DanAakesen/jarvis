import XCTest

final class NavigationReliabilityTests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testRepeatedNavigationInDanish() {
        exerciseNavigation(language: "da")
    }

    func testRepeatedNavigationInEnglish() {
        exerciseNavigation(language: "en")
    }

    func testShortDragAndBackgroundInterruptionRecover() {
        launch(language: "da")
        for _ in 0..<3 {
            let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.45))
            edge.press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.45)),
                withVelocity: .slow,
                thenHoldForDuration: 0.5
            )
            assertChatInputWorks()
            openByEdge()
            XCUIDevice.shared.press(.home)
            app.activate()
            tap(app.buttons["navigation.openSidebar"])
            assertSidebarOpen()
            closeByTap()
            assertChatInputWorks()
        }
        attachScreenshot("Recovered after short drags and background interruption")
    }

    private func launch(language: String) {
        app.launchArguments = [
            "--ui-test-navigation",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        app.launch()
        waitFor(app.buttons["navigation.openSidebar"], key: "isHittable", value: true)
        attachScreenshot("Before navigation sequence (\(language))")
    }

    private func exerciseNavigation(language: String) {
        launch(language: language)
        for iteration in 1...3 {
            XCTContext.runActivity(named: "\(language): navigation cycle \(iteration)") { _ in
                tap(app.buttons["navigation.openSidebar"])
                assertSidebarOpen()
                closeByTap()
                assertChatInputWorks()
                openByEdge()
                closeByTap()

                tap(app.buttons["chat.plus"])
                let plusMenu = app.otherElements["chat.plusMenu"]
                waitFor(plusMenu, key: "exists", value: true)
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
                waitFor(plusMenu, key: "exists", value: false)
                tap(app.buttons["chat.notifications"])
                tap(app.buttons["chat.notifications.done"])
                assertChatInputWorks()

                navigate(to: "health")
                exerciseSearch("health.search")
                let healthMode = app.segmentedControls["health.mode"]
                tap(healthMode.buttons.element(boundBy: 1))
                waitFor(healthMode.buttons.element(boundBy: 1), key: "isSelected", value: true)
                tap(app.buttons["health.plus"])
                cancelSheet()
                tap(healthMode.buttons.element(boundBy: 0))
                waitFor(healthMode.buttons.element(boundBy: 0), key: "isSelected", value: true)
                exerciseSearch("health.search")

                navigate(to: "notes")
                exerciseSearch("notes.search")
                tap(app.buttons["notes.tab.list"])
                waitFor(app.buttons["notes.tab.list"], key: "isSelected", value: true)
                tap(app.buttons["notes.tab.notes"])
                waitFor(app.buttons["notes.tab.notes"], key: "isSelected", value: true)
                tap(app.buttons["notes.plus"])
                tap(app.buttons["notes.newNote"])
                cancelSheet()
                exerciseSearch("notes.search")

                navigate(to: "softwareFactory")
                exerciseSearch("factory.search")
                tap(app.buttons["factory.segment.releases"])
                waitFor(app.buttons["factory.segment.releases"], key: "isSelected", value: true)
                tap(app.buttons["factory.segment.board"])
                waitFor(app.buttons["factory.segment.board"], key: "isSelected", value: true)
                tap(app.buttons["factory.plus"])
                cancelSheet()
                exerciseSearch("factory.search")

                navigate(to: "chat")
                startVoice()
                tap(app.buttons["voice.mic"])
                waitFor(app.buttons["voice.mic"], key: "isSelected", value: true)
                tap(app.buttons["voice.mic"])
                waitFor(app.buttons["voice.mic"], key: "isSelected", value: false)
                minimizeVoice()
                tap(app.buttons["voice.mini.mic"])
                waitFor(app.buttons["voice.mini.mic"], key: "isSelected", value: true)
                tap(app.buttons["voice.mini.restore"])
                tap(app.buttons["voice.end"])
                assertChatInputWorks()

                startVoice()
                minimizeVoice()
                tap(app.buttons["voice.mini.end"])
                waitFor(app.buttons["voice.mini.end"], key: "exists", value: false)
                tap(app.buttons["navigation.openSidebar"])
                assertSidebarOpen()
                closeByTap()
                assertChatInputWorks()
                attachScreenshot("After cycle \(iteration) (\(language))")
            }
        }
    }

    private func startVoice() {
        tap(app.segmentedControls["chat.mode"].buttons.element(boundBy: 1))
        waitFor(app.buttons["voice.mic"], key: "isHittable", value: true)
    }

    private func assertChatInputWorks() {
        let input = app.descendants(matching: .any)["chat.input"]
        tap(input)
        input.typeText("x")
        XCTAssertTrue((input.value as? String)?.hasSuffix("x") == true)
    }

    private func exerciseSearch(_ identifier: String) {
        let search = app.textFields[identifier]
        tap(search)
        search.typeText("x")
        XCTAssertTrue((search.value as? String)?.hasSuffix("x") == true)
        search.typeText("\n")
    }

    private func minimizeVoice() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            .press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            )
        waitFor(app.buttons["voice.mini.restore"], key: "isHittable", value: true)
    }

    private func cancelSheet() {
        tap(app.buttons["sheet.cancel"])
        waitFor(app.buttons["sheet.cancel"], key: "exists", value: false)
    }

    private func navigate(to destination: String) {
        openByEdge()
        tap(app.buttons["navigation.\(destination)"])
        waitFor(app.buttons["navigation.chat"], key: "exists", value: false)
    }

    private func openByEdge() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.45))
            .press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.45))
            )
        assertSidebarOpen()
    }

    private func assertSidebarOpen() {
        waitFor(app.buttons["navigation.chat"], key: "isHittable", value: true)
    }

    private func closeByTap() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.45)).tap()
        waitFor(app.buttons["navigation.chat"], key: "exists", value: false)
    }

    private func tap(_ element: XCUIElement) {
        waitFor(element, key: "isHittable", value: true)
        element.tap()
    }

    private func waitFor(_ element: XCUIElement, key: String, value: Bool) {
        let predicate = NSPredicate(format: "%K == %@", key, NSNumber(value: value))
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed,
                       "\(element) did not reach \(key)=\(value)")
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

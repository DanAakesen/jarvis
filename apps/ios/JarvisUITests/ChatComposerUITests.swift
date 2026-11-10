import XCTest
import CoreFoundation

final class ChatComposerUITests: XCTestCase {
    func testPhotoThumbnailsRemoveOnlyTheChosenItemAndPreserveDraft() {
        let app = launch(language: "en", extraArguments: ["--ui-test-chat-photos"])
        defer { app.terminate() }
        let input = app.textViews["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        let removePortrait = app.buttons["Remove Synthetic portrait.jpg"]
        let removeLandscape = app.buttons["Remove Synthetic landscape.jpg"]
        XCTAssertTrue(removeLandscape.waitForExistence(timeout: 5))
        XCTAssertTrue(app.images["Synthetic landscape.jpg"].waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(removeLandscape.frame.width, 44)
        XCTAssertGreaterThanOrEqual(removeLandscape.frame.height, 44)
        XCTAssertTrue(removeLandscape.isHittable)
        capturePhotos(app, name: "dark-photo-remove-before-removal-synthetic-fixtures")
        // Tap the invisible target, away from the small top-right visible X.
        removeLandscape.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.9)).tap()
        XCTAssertFalse(removeLandscape.exists)
        XCTAssertTrue(removePortrait.exists)
        XCTAssertTrue(app.buttons["Remove Synthetic notes.txt"].exists)
        XCTAssertEqual(input.value as? String, "Synthetic photo draft")
        removePortrait.tap()
        app.buttons["Remove Synthetic notes.txt"].tap()
        XCTAssertEqual(input.value as? String, "Synthetic photo draft")
        XCTAssertTrue(app.buttons["chat.send"].isEnabled)
        capturePhotos(app, name: "photo-removal-preserves-editable-draft")
    }

    func testPhotosRenderBelowSentTextAndReloadWithUnavailableHistoryFallback() {
        let app = launch(language: "en", extraArguments: ["--ui-test-chat-photos"])
        defer { app.terminate() }
        XCTAssertTrue(app.textViews["chat.input"].waitForExistence(timeout: 10))
        let retry = app.buttons["Retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 5), "Expired photo-only history must offer a fallback.")
        retry.tap()
        XCTAssertTrue(app.staticTexts["Photo unavailable"].waitForExistence(timeout: 5))
        capturePhotos(app, name: "photo-only-history-unavailable-and-pending-thumbnails")
        app.buttons["chat.send"].tap()
        XCTAssertTrue(app.textViews["chat.reply.45"].waitForExistence(timeout: 10))
        let image = app.images["Synthetic landscape.jpg"]
        XCTAssertTrue(image.waitForExistence(timeout: 5))
        let bubble = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "You: Synthetic photo draft")
        ).firstMatch
        let transcript = app.scrollViews["chat.transcript"]
        transcript.swipeDown()
        XCTAssertTrue(bubble.exists)
        XCTAssertGreaterThan(image.frame.minY, bubble.frame.maxY)
        XCTAssertLessThanOrEqual(image.frame.maxX, transcript.frame.maxX)
        XCTAssertTrue(app.staticTexts["Synthetic notes.txt"].exists)
        XCTAssertFalse(app.buttons["Remove Synthetic landscape.jpg"].exists)
        capturePhotos(app, name: "sent-text-multiple-photos-and-file")
        // A new launch loads saved fixture history, including an available portrait and an expired image.
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 10))
        app.scrollViews["chat.transcript"].swipeDown()
        XCTAssertTrue(app.images["Synthetic saved portrait.jpg"].waitForExistence(timeout: 5))
        capturePhotos(app, name: "reloaded-photo-only-history")
    }

    private func capturePhotos(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testPhotosAndToolOnlyUpdatesShareTheChangingDock() {
        let app = followApp(showsNow: true)
        app.launchArguments += ["--ui-test-chat-photos", "--ui-test-chat-follow-reduced-motion"]
        app.launch()
        defer { app.terminate() }
        let input = app.textViews["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        XCTAssertTrue(app.images["Synthetic saved portrait.jpg"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 5))
        assertAboveDock(app.images["Synthetic saved portrait.jpg"], app: app)
        assertAboveDock(app.buttons["Retry"], app: app)
        XCTAssertTrue(app.images["Synthetic landscape.jpg"].waitForExistence(timeout: 5))
        captureFollow(app, "integrated-photo-history-and-pending-thumbnails")
        app.buttons["Remove Synthetic landscape.jpg"].tap()
        XCTAssertTrue(app.buttons["Remove Synthetic portrait.jpg"].exists)
        XCTAssertTrue(app.buttons["Remove Synthetic notes.txt"].exists)
        XCTAssertEqual(input.value as? String, "Synthetic photo draft")
        app.buttons["chat.send"].tap()
        XCTAssertTrue(app.buttons["chat.turn.status"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.images["Synthetic portrait.jpg"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Synthetic notes.txt"].exists)
        XCTAssertFalse(app.buttons["Remove Synthetic portrait.jpg"].exists)
        XCTAssertFalse(app.textViews["chat.reply.45"].exists, "The combined fixture must hold the turn open")

        signalFollowFixture("tools")
        let group = app.buttons["chat.live.toolGroup.\(followToolID(7))"]
        assertAboveDock(group, app: app)
        XCTAssertFalse(app.textViews["chat.reply.streaming"].exists)
        input.tap()
        input.typeText("A retained draft that wraps while photo previews and tool-only updates share the composer dock.")
        assertAboveDock(group, app: app)
        captureFollow(app, "integrated-photos-tool-only-keyboard-multiline-reduced-motion")
        group.tap()
        let lastCall = app.descendants(matching: .any)["chat.live.toolCall.\(followToolID(9))"]
        signalFollowFixture("fail-tool")
        let failed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS 'Failed'"), object: lastCall)
        XCTAssertEqual(XCTWaiter.wait(for: [failed], timeout: 5), .completed)
        assertAboveDock(lastCall, app: app)
        signalFollowFixture("finish")
        XCTAssertTrue(app.textViews["chat.reply.45"].waitForExistence(timeout: 8))
        assertAboveDock(app.buttons["chat.tools.45"], app: app)
        XCTAssertTrue(app.images["Synthetic portrait.jpg"].exists)
        XCTAssertTrue(app.staticTexts["Synthetic notes.txt"].exists)
        captureFollow(app, "integrated-photos-final-reply")
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLiveToolContainerPreservesIndividualAccessibilityIdentifiers() {
        let app = followApp(showsNow: false)
        app.launch()
        defer { app.terminate() }
        let input = app.textViews["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Check tool accessibility")
        app.buttons["chat.send"].tap()
        XCTAssertTrue(app.buttons["chat.turn.status"].waitForExistence(timeout: 5))

        signalFollowFixture("tools")
        let container = app.descendants(matching: .any)["chat.tools.live"]
        XCTAssertTrue(container.waitForExistence(timeout: 5))
        let group = container.buttons["chat.live.toolGroup.\(followToolID(7))"]
        XCTAssertTrue(group.waitForExistence(timeout: 5))
        XCTAssertTrue(container.descendants(matching: .any)["chat.live.tool.\(followToolID(1))"].exists)
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "chat.tools.live").count, 1)
        assertAboveDock(group, app: app)
        group.tap()
        let lastCall = container.descendants(matching: .any)["chat.live.toolCall.\(followToolID(9))"]
        XCTAssertTrue(lastCall.waitForExistence(timeout: 5))
        assertAboveDock(lastCall, app: app)
        XCTAssertEqual(group.value as? String, "Expanded")
    }

    func testToolOnlyUpdatesFollowAboveDockWithAndWithoutNow() {
        for showsNow in [false, true] {
            let app = followApp(showsNow: showsNow)
            app.launch()
            let input = app.textViews["chat.input"]
            XCTAssertTrue(input.waitForExistence(timeout: 10))
            input.tap()
            input.typeText("?")
            app.buttons["chat.send"].tap()
            XCTAssertTrue(app.buttons["chat.turn.status"].waitForExistence(timeout: 5))
            let shortBubble = app.descendants(matching: .any).matching(NSPredicate(
                format: "identifier == %@ AND label == %@", "chat.message.user", "You: ?"
            )).firstMatch
            XCTAssertTrue(shortBubble.exists)
            XCTAssertLessThan(shortBubble.frame.width, 120, "Native selection must retain content-fit user bubbles")
            XCTAssertEqual(app.buttons["chat.now"].exists, showsNow)

            signalFollowFixture("tools")
            let group = app.buttons["chat.live.toolGroup.\(followToolID(7))"]
            assertAboveDock(group, app: app)
            XCTAssertTrue(group.label.contains("repo list ×3"))
            XCTAssertFalse(app.textViews["chat.reply.streaming"].exists, "Tools must follow without reply deltas")
            captureFollow(app, "tool-only-follow-now-\(showsNow)-keyboard")
            group.tap()
            let lastCall = app.descendants(matching: .any)["chat.live.toolCall.\(followToolID(9))"]
            assertAboveDock(lastCall, app: app)
            signalFollowFixture("fail-tool")
            let failed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS 'Failed'"), object: lastCall)
            XCTAssertEqual(XCTWaiter.wait(for: [failed], timeout: 5), .completed)
            assertAboveDock(lastCall, app: app)
            captureFollow(app, "expanded-tool-failure-now-\(showsNow)")
            group.tap()
            assertAboveDock(group, app: app)

            input.tap()
            input.typeText("Keep this draft as the composer grows over several wrapped lines without sending it. Keep typing a little more.")
            assertAboveDock(group, app: app)
            input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
            assertAboveDock(group, app: app)
            signalFollowFixture("tools")
            let nextGroup = app.buttons["chat.live.toolGroup.\(followToolID(16))"]
            assertAboveDock(nextGroup, app: app)
            captureFollow(app, "tool-only-follow-multiline-now-\(showsNow)")
            signalFollowFixture("finish")
            let reply = app.textViews["chat.reply.45"]
            XCTAssertTrue(reply.waitForExistence(timeout: 8))
            assertAboveDock(app.buttons["chat.tools.45"], app: app)
            XCTAssertTrue(reply.isHittable)
            captureFollow(app, "final-reply-follow-now-\(showsNow)")
            app.terminate()
        }
    }

    func testToolUpdatesDoNotPullHistoryReaderAndResumeAtBottom() {
        let app = followApp(showsNow: true)
        app.launchArguments += ["--ui-test-chat-follow-reduced-motion",
                                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityM"]
        app.launch()
        defer { app.terminate() }
        let input = app.textViews["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Run the synthetic tool checks")
        app.buttons["chat.send"].tap()
        XCTAssertTrue(app.buttons["chat.turn.status"].waitForExistence(timeout: 5))
        signalFollowFixture("tools")
        assertAboveDock(app.buttons["chat.live.toolGroup.\(followToolID(7))"], app: app)
        let transcript = app.scrollViews["chat.transcript"]
        transcript.swipeDown()
        transcript.swipeDown()
        let older = transcript.textViews.matching(NSPredicate(format: "identifier BEGINSWITH 'chat.reply.'")).allElementsBoundByIndex
            .first { $0.isHittable && $0.frame.minY > transcript.frame.minY }
        XCTAssertNotNil(older)
        guard let older else { return }
        let previousY = older.frame.minY
        signalFollowFixture("tools")
        let nextGroup = app.buttons["chat.live.toolGroup.\(followToolID(16))"]
        XCTAssertTrue(nextGroup.waitForExistence(timeout: 5))
        XCTAssertEqual(older.frame.minY, previousY, accuracy: 3, "Tool-only layout must not move an older-history reader")
        captureFollow(app, "reading-history-during-tool-only-updates-accessibility-reduced-motion")

        for _ in 0..<12 {
            if nextGroup.isHittable { break }
            transcript.swipeUp()
        }
        assertAboveDock(nextGroup, app: app)
        signalFollowFixture("tools")
        assertAboveDock(app.buttons["chat.live.toolGroup.\(followToolID(25))"], app: app)
        captureFollow(app, "follow-resumed-accessibility-reduced-motion")
    }

    func testReplySelectionSurvivesToolOnlyGrowthAtLatest() {
        let app = followApp(showsNow: true)
        app.launch()
        defer { app.terminate() }
        let input = app.textViews["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Run the synthetic tool checks")
        app.buttons["chat.send"].tap()
        XCTAssertTrue(app.buttons["chat.turn.status"].waitForExistence(timeout: 5))
        signalFollowFixture("stream")
        let reply = app.textViews["chat.reply.streaming"]
        assertAboveDock(reply, app: app)
        reply.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0))
            .withOffset(CGVector(dx: 0, dy: 12)).press(forDuration: 1.2)
        XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5))
        let previousY = reply.frame.minY
        signalFollowFixture("stream")
        signalFollowFixture("tools")
        XCTAssertTrue(app.buttons["chat.live.toolGroup.\(followToolID(7))"].waitForExistence(timeout: 5))
        XCTAssertEqual(reply.frame.minY, previousY, accuracy: 3, "Live work must not move selected text")
        XCTAssertTrue(app.menuItems["Copy"].exists)
        captureFollow(app, "selection-held-during-tool-only-growth")
    }

    private func followApp(showsNow: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--screenshot-chat-fixture", "--ui-test-chat-feedback", "--ui-test-chat-follow",
                               "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark"]
        if showsNow { app.launchArguments.append("--ui-test-chat-follow-now") }
        return app
    }

    private func followToolID(_ index: Int) -> String {
        String(format: "00000000-0000-4000-8000-%012d", index)
    }

    private func signalFollowFixture(_ action: String) {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(rawValue: "com.jarvis.uitests.\(action)-chat-feedback" as CFString), nil, nil, true)
    }

    private func assertAboveDock(_ element: XCUIElement, app: XCUIApplication,
                                 file: StaticString = #filePath, line: UInt = #line) {
        let dock = app.descendants(matching: .any)["chat.dock"]
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            element.exists && dock.exists && element.isHittable &&
                element.frame.maxY <= dock.frame.minY + 1 &&
                element.frame.minY >= app.scrollViews["chat.transcript"].frame.minY
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 8), .completed,
                       "Latest activity must be above the actual dock edge", file: file, line: line)
    }

    private func captureFollow(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "chat-follow-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testRuntimeTestKeepsNormalDraftAndHistorySeparate() {
        let app = launch(language: "en")
        defer { app.terminate() }
        let input = app.textViews["chat.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Keep my normal draft")
        app.buttons["chat.plus"].tap()
        let entry = app.buttons["chat.plus.testRuntime"]
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
        let testInput = app.textViews["runtimeTest.input"]
        XCTAssertTrue(testInput.waitForExistence(timeout: 10))
        testInput.tap()
        testInput.typeText("Synthetic test message")
        app.buttons["runtimeTest.send"].tap()
        XCTAssertTrue(app.textViews["runtimeTest.acknowledgment"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["runtimeTest.tool.00000000-0000-4000-8000-000000000001"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["runtimeTest.progress"].exists)
        let progressCapture = XCTAttachment(screenshot: app.screenshot())
        progressCapture.name = "runtime-test-live-progress"
        progressCapture.lifetime = .keepAlways
        add(progressCapture)
        XCTAssertTrue(app.descendants(matching: .any)["runtimeTest.message.991"].waitForExistence(timeout: 10))
        let tools = app.buttons["runtimeTest.tools"]
        XCTAssertTrue(tools.waitForExistence(timeout: 5))
        XCTAssertTrue(tools.label.contains("11"), "Replayed finishes must not inflate the call total.")
        tools.tap()
        let group = app.buttons["runtimeTest.toolGroup.00000000-0000-4000-8000-000000000002"]
        XCTAssertTrue(group.waitForExistence(timeout: 5))
        XCTAssertTrue(group.label.contains("repo list ×10"))
        XCTAssertTrue(group.label.contains("Not allowed 1"), "A later success must not hide the refusal.")
        XCTAssertTrue(group.label.contains("Done 9"))
        let refusedCall = app.descendants(matching: .any)["runtimeTest.toolCall.00000000-0000-4000-8000-000000000003"]
        XCTAssertFalse(refusedCall.exists)
        let groupedCapture = XCTAttachment(screenshot: app.screenshot())
        groupedCapture.name = "runtime-test-grouped-tools"
        groupedCapture.lifetime = .keepAlways
        add(groupedCapture)
        group.tap()
        XCTAssertTrue(refusedCall.waitForExistence(timeout: 5))
        XCTAssertTrue(refusedCall.label.contains("Call 2"))
        XCTAssertTrue(refusedCall.label.contains("Not allowed"))
        XCTAssertFalse(refusedCall.label.contains("repo list"))
        let expandedCapture = XCTAttachment(screenshot: app.screenshot())
        expandedCapture.name = "runtime-test-expanded-tool-attempts"
        expandedCapture.lifetime = .keepAlways
        add(expandedCapture)
        group.tap()
        XCTAssertFalse(refusedCall.exists)
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
        if extraArguments.contains("--ui-test-chat-photos") {
            app.launchArguments += ["-jarvis.appTheme", "dark"]
        }
        app.launch()
        return app
    }
}

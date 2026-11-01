import XCTest

final class JarvisChatVisibilityTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            attachFailureHierarchy("teardown")
        }
        try super.tearDownWithError()
    }

    private func attachFailureHierarchy(_ stage: String) {
        let hierarchy = XCUIApplication().debugDescription
        print("Chat UI failure hierarchy (\(stage)):\n\(hierarchy)")
        let attachment = XCTAttachment(string: hierarchy)
        attachment.name = "chat-failure-app-hierarchy"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testSentMessageIsVisibleBeforeDelayedReplyInEnglish() {
        assertSentMessageIsVisible(language: "en", reduceMotion: false)
    }

    func testSentMessageIsVisibleBeforeDelayedReplyInDanishWithReducedMotion() {
        assertSentMessageIsVisible(language: "da", reduceMotion: true)
    }

    func testUnacknowledgedFailureRestoresDraft() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--screenshot-chat-fixture", "--ui-test-chat-send",
            "--ui-test-chat-send-failure",
        ]
        app.launch()
        let composer = enterMessage(in: app)
        app.buttons["chat-send"].tap()

        let restored = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                composer.value as? String == "Hi Jarvis" &&
                    app.descendants(matching: .any).matching(identifier: "chat-user-message").count == 0
            },
            object: nil
        )
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 10), .completed)
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "chat-user-message").count, 0)
    }

    private func enterMessage(in app: XCUIApplication) -> XCUIElement {
        let transcript = app.scrollViews["chat-transcript"]
        let transcriptExists = transcript.waitForExistence(timeout: 10)
        if !transcriptExists {
            attachFailureHierarchy("transcript missing")
        }
        XCTAssertTrue(transcriptExists)
        let composer = app.textFields["chat-composer"]
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND enabled == true AND hittable == true"),
            object: composer
        )
        let readiness = XCTWaiter.wait(for: [ready], timeout: 10)
        if readiness != .completed {
            attachFailureHierarchy("composer readiness \(readiness)")
        }
        XCTAssertEqual(readiness, .completed)
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        composer.typeText("Hi Jarvis")
        let entered = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "Hi Jarvis"),
            object: composer
        )
        XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: 10), .completed)
        return composer
    }

    private func assertSentMessageIsVisible(language: String, reduceMotion: Bool) {
        let app = XCUIApplication()
        app.launchArguments = [
            "--screenshot-chat-fixture", "--ui-test-chat-send",
            "-jarvis.appLanguage", language,
        ]
        if reduceMotion { app.launchArguments.append("--ui-test-reduce-motion") }
        app.launch()

        let composer = enterMessage(in: app)
        let transcript = app.scrollViews["chat-transcript"]
        XCTAssertTrue(transcript.waitForExistence(timeout: 10))
        transcript.swipeDown()
        transcript.swipeDown()
        app.buttons["chat-send"].tap()

        let bubbles = app.descendants(matching: .any)
            .matching(identifier: "chat-user-message")
            .matching(NSPredicate(format: "label == %@", "You: Hi Jarvis"))
        let bubble = bubbles.firstMatch
        let replies = app.descendants(matching: .any)
            .matching(identifier: "chat-jarvis-message")
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Jarvis: This response is "))
        // The server's user event is delayed five seconds: this must be the local insert.
        let visible = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                bubble.exists && bubble.isHittable &&
                    bubble.frame.minY >= transcript.frame.minY &&
                    bubble.frame.maxY <= transcript.frame.maxY &&
                    bubble.frame.maxY <= composer.frame.minY
            },
            object: nil
        )
        let visibility = XCTWaiter.wait(for: [visible], timeout: 2)
        if visibility != .completed {
            if bubble.exists {
                print("Sent bubble geometry (\(language)): hittable=\(bubble.isHittable), bubble=\(bubble.frame), transcript=\(transcript.frame), composer=\(composer.frame)")
            } else {
                print("Sent bubble missing (\(language))")
            }
            attachFailureHierarchy("sent bubble visibility \(visibility)")
            let failureScreenshot = XCTAttachment(screenshot: app.screenshot())
            failureScreenshot.name = "chat-sent-failure-\(language)"
            failureScreenshot.lifetime = .keepAlways
            add(failureScreenshot)
        }
        XCTAssertEqual(visibility, .completed)
        XCTAssertTrue(bubble.isHittable)
        XCTAssertGreaterThanOrEqual(bubble.frame.minY, transcript.frame.minY)
        XCTAssertLessThanOrEqual(bubble.frame.maxY, transcript.frame.maxY)
        XCTAssertLessThanOrEqual(bubble.frame.maxY, composer.frame.minY)
        XCTAssertNotEqual(composer.value as? String, "Hi Jarvis")
        XCTAssertEqual(bubbles.count, 1)
        XCTAssertEqual(replies.count, 0, "The sent bubble must be visible before any delayed reply.")

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "chat-sent-\(language)"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let reply = replies
            .matching(NSPredicate(format: "label == %@", "Jarvis: This response is synthetic."))
            .firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 15))
        XCTAssertEqual(bubbles.count, 1, "Server acknowledgment must not duplicate the sent bubble.")
        XCTAssertTrue(bubble.isHittable)
    }
}

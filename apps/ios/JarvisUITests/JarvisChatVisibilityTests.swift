import XCTest

final class JarvisChatVisibilityTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
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
        let composer = app.descendants(matching: .any)["chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.tap()
        composer.typeText("Hi Jarvis")
        app.buttons["chat-send"].tap()

        let restored = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "Hi Jarvis"),
            object: composer
        )
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 10), .completed)
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "chat-user-message").count, 0)
    }

    private func assertSentMessageIsVisible(language: String, reduceMotion: Bool) {
        let app = XCUIApplication()
        app.launchArguments = [
            "--screenshot-chat-fixture", "--ui-test-chat-send",
            "-jarvis.appLanguage", language,
        ]
        if reduceMotion { app.launchArguments.append("--ui-test-reduce-motion") }
        app.launch()

        let composer = app.descendants(matching: .any)["chat-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.tap()
        composer.typeText("Hi Jarvis")
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
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 2), .completed)
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

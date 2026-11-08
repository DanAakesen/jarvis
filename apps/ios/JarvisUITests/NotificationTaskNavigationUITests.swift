import XCTest

final class NotificationTaskNavigationUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws { continueAfterFailure = false }

    func testAttentionAndRunningNotificationsOpenTaskHistory() {
        for identifier in ["activity.open.22", "activity.running.open.21"] {
            launch()
            openNotifications()
            let row = reveal(identifier)
            capture("notification-task-link-\(identifier)")
            row.tap()
            assertTaskDetail()
            XCTAssertFalse(app.buttons["chat.notifications.done"].exists)
            capture("notification-task-detail-\(identifier)")
            app.terminate()
        }
    }

    func testExpandedOlderTaskNotificationOpensItsTask() {
        launch()
        defer { app.terminate() }
        openNotifications()
        reveal("activity.older.alert").tap()
        let row = reveal("activity.open.26")
        let dismiss = app.buttons["activity.dismiss.26"]
        XCTAssertTrue(dismiss.exists, "Dismiss remains a separate action")
        XCTAssertLessThanOrEqual(row.frame.maxX, dismiss.frame.minX)
        capture("notification-older-task-link")
        row.tap()
        assertTaskDetail()
        capture("notification-older-task-detail")
    }

    func testBoardIssueOpensGitHubAndTaskOpensHistory() {
        launch()
        defer { app.terminate() }
        let menu = app.buttons["navigation.openSidebar"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let factory = app.buttons["navigation.softwareFactory"]
        XCTAssertTrue(factory.waitForExistence(timeout: 10))
        factory.tap()
        let column = app.buttons["factory.column.in_progress"]
        XCTAssertTrue(column.waitForExistence(timeout: 10))
        column.tap()
        let issue = app.buttons["factory.row.open.11"]
        XCTAssertTrue(issue.waitForExistence(timeout: 10))
        XCTAssertTrue(issue.isHittable)
        capture("factory-linked-and-unlinked-cards")
        issue.tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 15), "An issue-only card opens GitHub")
        app.activate()
        let task = app.buttons["factory.row.open.9"]
        XCTAssertTrue(task.waitForExistence(timeout: 10))
        task.tap()
        assertTaskDetail()
        capture("factory-task-history")
    }

    private func launch() {
        app.launchArguments = ["--ui-test-navigation", "--ui-test-notification-tasks",
                               "-jarvis.appLanguage", "en", "-jarvis.appTheme", "dark",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["chat.input"].waitForExistence(timeout: 10))
    }

    private func openNotifications() {
        let bell = app.buttons["chat.notifications"]
        XCTAssertTrue(bell.waitForExistence(timeout: 10))
        bell.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.scrollViews["activity.list"].waitForExistence(timeout: 10))
    }

    private func reveal(_ identifier: String) -> XCUIElement {
        let row = app.buttons[identifier]
        for _ in 0..<7 {
            if row.isHittable { return row }
            app.scrollViews["activity.list"].swipeUp()
        }
        capture("missing-\(identifier)")
        XCTFail("Notification control is not reachable: \(identifier)")
        return row
    }

    private func assertTaskDetail() {
        XCTAssertTrue(app.staticTexts["Review the synthetic release and report any blocking checks."]
            .waitForExistence(timeout: 10), "Task history without taskId must decode and display")
        XCTAssertFalse(app.buttons["Retry"].exists)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

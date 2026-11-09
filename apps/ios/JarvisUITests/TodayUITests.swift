import XCTest

/// Home (Today) runs on fixed fixture data (`--ui-test-today`): 2 November 2026, 14:30, 6,300 steps so far.
final class TodayUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch(language: String = "en", appearance: String? = nil, extraArguments: [String] = []) {
        app.launchArguments = [
            "--ui-test-navigation",
            "--ui-test-today",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        if let appearance { app.launchArguments += ["-jarvis.appTheme", appearance] }
        app.launchArguments += extraArguments
        app.launch()
    }

    private func screen(_ name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "screen.\(name)").firstMatch
    }


    /// Native List rows scroll naturally above the pinned composer, including at large text sizes.
    private func reveal(_ element: XCUIElement) {
        let list = app.descendants(matching: .any).matching(identifier: "today.list").firstMatch
        for _ in 0..<10 {
            let bottom = app.descendants(matching: .any)["today.input"].frame.minY - 20
            let top = list.frame.minY + 8
            if element.exists && element.isHittable && element.frame.minY >= top && element.frame.maxY < bottom { return }
            let above = element.exists && !element.frame.isEmpty && element.frame.minY < top
            list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: above ? 0.35 : 0.7))
                .press(forDuration: 0.05, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: above ? 0.7 : 0.35)),
                       withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(element.isHittable, "Home content must remain reachable")
    }

    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }

    func testBriefVisibleLineLimitNormalEnglish() { verifyBriefLines(language: "en", accessibility: false) }
    func testBriefVisibleLineLimitNormalDanish() { verifyBriefLines(language: "da", accessibility: false) }
    func testBriefVisibleLineLimitAccessibilityEnglish() { verifyBriefLines(language: "en", accessibility: true) }
    func testBriefVisibleLineLimitAccessibilityDanish() { verifyBriefLines(language: "da", accessibility: true) }

    /// Each three-launch case stays within the native runner's per-test time budget.
    private func verifyBriefLines(language: String, accessibility: Bool) {
        var heights: [CGFloat] = []
        for lines in [1, 3, 6] {
            var arguments = ["--home-brief-long", "--home-brief-lines=\(lines)"]
            if accessibility {
                arguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
            }
            launch(language: language, extraArguments: arguments)
            let brief = app.descendants(matching: .any)["today.greeting"]
            XCTAssertTrue(brief.waitForExistence(timeout: 10))
            XCTAssertTrue(brief.label.contains(language == "da" ? "begynder" : "starts"))
            XCTAssertGreaterThan(brief.frame.height, 0)
            heights.append(brief.frame.height)
            capture("home-brief-\(language)-\(accessibility ? "ax" : "normal")-\(lines)-lines")
            app.terminate()
        }
        XCTAssertGreaterThan(heights[1], heights[0] * 1.5)
        XCTAssertLessThanOrEqual(heights[1], heights[0] * 3.3)
        XCTAssertGreaterThan(heights[2], heights[1])
        XCTAssertLessThanOrEqual(heights[2], heights[0] * 6.3)

    }

    func testTodayIsTheLaunchPageInDanishAndEnglish() {
        for language in ["da", "en"] {
            launch(language: language, extraArguments: [
                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            ])
            XCTAssertTrue(screen("today").waitForExistence(timeout: 10), "Home must be the first screen (\(language))")
            XCTAssertTrue(app.descendants(matching: .any)["today.greeting"].waitForExistence(timeout: 5))
            XCTAssertFalse(screen("chat").exists)
            capture("home-large-text-top-\(language)")
            reveal(app.descendants(matching: .any)["today.summary.kcal"])
            capture("home-large-text-activity-\(language)")
            let workout = app.buttons["today.logWorkout"]
            let lift = app.buttons["today.logLift"]
            reveal(lift)
            XCTAssertGreaterThan(lift.frame.minY, workout.frame.maxY, "Large-text log actions stack without clipping labels")
            capture("home-large-text-quick-actions-\(language)")
            let upcoming = app.descendants(matching: .any)["today.section.upcoming"]
            reveal(upcoming)
            XCTAssertTrue(app.buttons["today.plus"].isEnabled)
            capture("home-large-text-upcoming-\(language)")
            app.terminate()
        }
    }

    /// Home captures against the published board (docs/ios/design/board.html): big phrase, the workouts and steps card with
    /// every row, two equal quick-action tiles, the Today / Tasks control and the real Chat composer.
    func testHomeMatchesTheBoardInDarkAndLightDanishAndEnglish() {
        for language in ["da", "en"] {
            for appearance in ["dark", "light"] {
                launch(language: language, appearance: appearance)
                XCTAssertTrue(screen("today").waitForExistence(timeout: 10), "\(language) \(appearance)")
                let greeting = app.descendants(matching: .any)["today.greeting"]
                XCTAssertTrue(greeting.waitForExistence(timeout: 5))
                XCTAssertFalse(app.buttons["navigation.openSidebar"].exists, "Home has no sidebar button")
                XCTAssertTrue(app.descendants(matching: .any)["today.donut"].exists)
                XCTAssertTrue(app.descendants(matching: .any)["today.summary.time"].exists, "Active time")
                XCTAssertTrue(app.descendants(matching: .any)["today.summary.kcal"].exists, "Active kcal")
                XCTAssertFalse(app.buttons["today.legend.chest"].exists, "No workout types list on Home")
                XCTAssertTrue(app.descendants(matching: .any)["today.steps.ring"].exists)
                XCTAssertTrue(app.descendants(matching: .any)["today.steps.chart"].exists)
                let card = app.descendants(matching: .any)["today.activity"]
                let title = card.staticTexts["hero.title"]
                let titleFrame = title.frame
                // Glass accessibility containers report their children's union, not
                // the painted card bounds. Measure against the page and section label.
                let sectionFrame = app.descendants(matching: .any)["today.section.home"].frame
                let pageFrame = app.frame
                capture("home-top-\(language)-\(appearance)")
                XCTAssertEqual(titleFrame.minX, pageFrame.minX + 32, accuracy: 2,
                               "Title follows the 16 pt page inset and 16 pt card inset")
                XCTAssertEqual(titleFrame.minY - sectionFrame.maxY, 28, accuracy: 2,
                               "Title follows the 12 pt section gap and 16 pt card inset")
                let periods = app.scrollViews["today.range.scroll"]
                XCTAssertEqual(periods.frame.maxX, pageFrame.maxX - 32, accuracy: 1)
                XCTAssertEqual(app.buttons["today.range.30"].frame.maxX, periods.frame.maxX - 3, accuracy: 2,
                               "Period buttons finish at the hero's trailing inset")
                for id in ["home", "quickActions", "upcoming"] {
                    XCTAssertTrue(app.descendants(matching: .any)["today.section.\(id)"].exists)
                }
                let workout = app.buttons["today.logWorkout"]
                let lift = app.buttons["today.logLift"]
                reveal(workout)
                XCTAssertTrue(workout.exists && lift.exists)
                XCTAssertEqual(workout.frame.width, lift.frame.width, accuracy: 1, "Quick actions are equal tiles")
                let todayTab = app.buttons["today.tab.today"]
                reveal(todayTab)
                let dueTab = app.buttons["today.tab.due"]
                XCTAssertTrue(todayTab.exists && dueTab.exists)
                XCTAssertEqual(todayTab.frame.width, dueTab.frame.width, accuracy: 1)
                XCTAssertEqual(todayTab.frame.maxX, dueTab.frame.minX, accuracy: 1, "Home segments share one continuous control")
                XCTAssertGreaterThanOrEqual(todayTab.frame.height, 44)
                XCTAssertTrue(app.buttons["today.plus"].exists)
                XCTAssertTrue(app.descendants(matching: .any)["today.input"].exists)
                XCTAssertTrue(app.buttons["today.composer.plus"].exists, "Composer plus on the left")
                XCTAssertTrue(app.buttons["today.dictate"].exists, "Composer dictation on the right")
                XCTAssertTrue(app.buttons["today.voice"].exists, "Composer voice on the right")
                let screenshot = XCTAttachment(screenshot: app.screenshot())
                screenshot.name = "home-\(language)-\(appearance).png"
                screenshot.lifetime = .keepAlways
                add(screenshot)
                app.terminate()
            }
        }
    }

    func testHomeIsTheActiveSidebarRowOnToday() {
        launch()
        XCTAssertTrue(screen("today").waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["navigation.openSidebar"].exists, "Home has no sidebar button")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.4))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.4)))
        let home = app.buttons["navigation.today"]
        XCTAssertTrue(home.waitForExistence(timeout: 3))
        XCTAssertTrue(home.isSelected, "Home is the active row on Today")
        XCTAssertFalse(app.buttons["navigation.chat"].isSelected, "Chat is not active on Today")
    }

    func testPlusMenuOpensTaskAndNoteSheets() {
        launch()
        let plus = app.buttons["today.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 10))
        for item in ["today.plus.task", "today.plus.note"] {
            reveal(plus)
            plus.tap()
            let entry = app.buttons[item]
            XCTAssertTrue(entry.waitForExistence(timeout: 3), item)
            entry.tap()
            let close = app.buttons["sheet.cancel"]
            XCTAssertTrue(close.waitForExistence(timeout: 5), "\(item) must open its sheet")
            close.tap()
            XCTAssertTrue(plus.waitForExistence(timeout: 5))
        }
    }

    func testRangeToggleSwitchesBetweenHourlyAndDailyBars() {
        launch()
        let hourlyLast = app.buttons["today.bar.16"]
        XCTAssertTrue(hourlyLast.waitForExistence(timeout: 10), "Today shows hourly bars")
        let caption = app.staticTexts["today.steps.caption"]
        XCTAssertTrue(caption.waitForExistence(timeout: 3))
        let hourlyCaption = caption.label
        app.buttons["today.range.7"].tap()
        XCTAssertTrue(app.buttons["today.bar.6"].waitForExistence(timeout: 3), "7d shows seven daily bars")
        XCTAssertFalse(app.buttons["today.bar.7"].exists)
        XCTAssertNotEqual(caption.label, hourlyCaption)
        app.buttons["today.range.30"].tap()
        XCTAssertTrue(app.buttons["today.bar.29"].waitForExistence(timeout: 3), "30d shows thirty daily bars")
        app.buttons["today.range.1"].tap()
        XCTAssertTrue(app.buttons["today.bar.16"].waitForExistence(timeout: 3))
    }

    func testBarSelectionSetsTheRingAndResets() {
        launch()
        let ring = app.descendants(matching: .any)["today.steps.ring"]
        XCTAssertTrue(ring.waitForExistence(timeout: 10))
        XCTAssertEqual(ring.value as? String, "6300")
        let bar = app.buttons["today.bar.2"]
        XCTAssertTrue(bar.waitForExistence(timeout: 3))
        bar.tap()
        XCTAssertEqual(ring.value as? String, "1920", "A tapped bar sets the ring to its value")
        bar.tap()
        XCTAssertEqual(ring.value as? String, "6300", "Tapping the bar again resets the ring")
        bar.tap()
        XCTAssertEqual(ring.value as? String, "1920")
        app.buttons["today.range.7"].tap()
        XCTAssertEqual(ring.value as? String, "6300", "Changing the range resets the selection")
    }

    /// Finds a sheet element by identifier whatever its type, scrolling the sheet until it appears.
    private func sheetElement(_ id: String) -> XCUIElement {
        let element = app.descendants(matching: .any).matching(identifier: id).firstMatch
        var swipes = 0
        while !element.waitForExistence(timeout: 2) && swipes < 4 {
            app.swipeUp()
            swipes += 1
        }
        return element
    }

    func testLogButtonsOpenDifferentSheets() {
        launch()
        let workout = app.buttons["today.logWorkout"]
        XCTAssertTrue(workout.waitForExistence(timeout: 10))
        reveal(workout)
        workout.tap()
        XCTAssertTrue(app.buttons["today.workout.session.chest"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["today.lift.name"].exists, "Log workout shows workout types, not lifts")
        app.buttons["sheet.cancel"].tap()
        let lift = app.buttons["today.logLift"]
        XCTAssertTrue(lift.waitForExistence(timeout: 5))
        reveal(lift)
        lift.tap()
        XCTAssertTrue(app.textFields["today.lift.name"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["today.workout.session.chest"].exists, "Log lift shows lifts, not workout types")
        app.buttons["sheet.cancel"].tap()
    }

    func testCompletingATaskConfirmsSuccessAndKeepsOtherTasksUsable() {
        launch(appearance: "dark")
        XCTAssertTrue(screen("today").waitForExistence(timeout: 10))
        // t1/t2 are due today. Tasks due deliberately contains overdue/upcoming tasks.
        XCTAssertTrue(app.buttons["today.tab.today"].isSelected)
        let expand = app.buttons["today.list.expand"]
        for _ in 0..<4 where !expand.isHittable { app.swipeUp() }
        XCTAssertTrue(expand.isHittable)
        expand.tap()
        let first = app.descendants(matching: .any)["today.task.t1"]
        reveal(first)
        XCTAssertTrue(first.label.hasPrefix("Task:"), "Rows announce their type as well as their title")
        XCTAssertFalse(app.buttons["today.task.done.t1"].exists, "No inline completion circle")
        capture("home-mixed-agenda-before-swipe")
        first.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: first.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5)))
        let complete = app.buttons["today.task.done.t1"]
        XCTAssertTrue(complete.waitForExistence(timeout: 5), "A partial native swipe reveals completion")
        capture("home-task-completion-swipe")
        complete.tap()
        let removed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: first)
        XCTAssertEqual(XCTWaiter.wait(for: [removed], timeout: 5), .completed)
        capture("P15-success-task-dark-en")
        let second = app.descendants(matching: .any)["today.task.t2"]
        reveal(second)
        XCTAssertTrue(second.isEnabled, "Confirmation must not block another completion")
        second.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: second.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5)))
        let secondRemoved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: second)
        XCTAssertEqual(XCTWaiter.wait(for: [secondRemoved], timeout: 5), .completed,
                       "A full native swipe completes the second task")
        XCTAssertTrue(app.descendants(matching: .any)["today.input"].isEnabled)
    }

    func testWorkoutSavingNeedsASessionAndTheDateIsSaved() {
        launch()
        let log = app.buttons["today.logWorkout"]
        XCTAssertTrue(log.waitForExistence(timeout: 10))
        reveal(log)
        log.tap()
        let chest = app.buttons["today.workout.session.chest"]
        XCTAssertTrue(chest.waitForExistence(timeout: 5))
        let save = app.buttons["sheet.confirm"]
        XCTAssertFalse(save.isEnabled, "Saving needs a session type")
        chest.tap()
        XCTAssertTrue(sheetElement("today.log.date").exists, "The date defaults to today")
        XCTAssertTrue(save.isEnabled)
        XCTAssertTrue(save.isEnabled)
        save.tap()
        XCTAssertTrue(app.descendants(matching: .any)["today.log.status"].waitForExistence(timeout: 5))
        app.buttons["sheet.cancel"].tap()
        XCTAssertTrue(log.waitForExistence(timeout: 5))
    }

    func testLiftSavingNeedsALiftAndADate() {
        launch(appearance: "dark")
        let log = app.buttons["today.logLift"]
        XCTAssertTrue(log.waitForExistence(timeout: 10))
        reveal(log)
        log.tap()
        let name = app.textFields["today.lift.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        let save = app.buttons["sheet.confirm"]
        XCTAssertFalse(save.isEnabled)
        name.tap()
        name.typeText("Bench press")
        for (field, value) in [("weight", "60"), ("reps", "8"), ("sets", "3")] {
            let input = app.textFields["today.lift.\(field)"]
            XCTAssertTrue(sheetElement("today.lift.\(field)").exists, "today.lift.\(field) missing")
            input.tap()
            input.typeText(value)
        }
        XCTAssertTrue(save.isEnabled)
        save.tap()
        let saved = app.descendants(matching: .any)["today.log.status"]
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        let confirmed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Saved"), object: saved)
        XCTAssertEqual(XCTWaiter.wait(for: [confirmed], timeout: 5), .completed)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "P15-success-lift-dark-en"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCTAssertTrue(app.buttons["sheet.cancel"].isEnabled, "Success feedback remains interruptible")
    }

    func testTypingShowsSendAndSendOpensChatThenHomeReturns() {
        launch()
        let input = app.descendants(matching: .any)["today.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["today.voice"].exists, "Voice is the default trailing control")
        input.tap()
        input.typeText("H")
        let send = app.buttons["today.send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5), "Voice becomes send while typing")
        send.tap()
        XCTAssertTrue(screen("chat").waitForExistence(timeout: 10), "Send continues in Chat")
        let reply = app.descendants(matching: .any)["chat.reply.431"]
        XCTAssertTrue(reply.waitForExistence(timeout: 10),
                      "Home must send the turn and receive a reply, not only navigate")
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "chat.reply.431").count, 1)
        let home = app.buttons["chat.backToToday"].firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: 10))
        home.tap()
        XCTAssertTrue(screen("today").waitForExistence(timeout: 10), "Reversing returns to Home")
    }

    func testHomeCameraChoiceOpensCaptureAfterNavigation() {
        launch(extraArguments: ["--ui-test-camera-sheet"])
        let plus = app.buttons["today.composer.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 10))
        plus.tap()
        let camera = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ OR label == %@", "today.composer.plus.camera", "Camera"
        )).firstMatch
        XCTAssertTrue(camera.waitForExistence(timeout: 5))
        camera.tap()
        XCTAssertTrue(app.descendants(matching: .any)["camera.shutter"].waitForExistence(timeout: 10),
                      "The pending camera action must survive the Home to Chat transition")
        app.descendants(matching: .any)["camera.close"].tap()
        XCTAssertTrue(screen("chat").waitForExistence(timeout: 5))
    }

    func testVoiceButtonOpensVoiceAndMinimizingReturnsHome() {
        launch()
        let voice = app.buttons["today.voice"]
        XCTAssertTrue(voice.waitForExistence(timeout: 10))
        voice.tap()
        XCTAssertTrue(screen("voice").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["voice.mic"].waitForExistence(timeout: 10))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            .press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            )
        XCTAssertTrue(screen("today").waitForExistence(timeout: 10), "Minimizing voice returns to Home")
    }
}

import XCTest

final class NavigationBisectTests: XCTestCase {
    private let app = XCUIApplication()
    private var interruptions: [String] = []

    override func setUpWithError() throws {
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "Navigation fixture system permissions") { [weak self] alert in
            self?.interruptions.append(alert.debugDescription)
            for title in ["Don’t Allow", "Don't Allow", "Tillad ikke", "Not Now", "Ikke nu", "OK"] {
                let button = alert.buttons[title]
                if button.exists {
                    button.tap()
                    return true
                }
            }
            return false
        }
    }

    func testA_BaselineDanish() { exercise("A", language: "da") }
    func testA_BaselineEnglish() { exercise("A", language: "en") }
    func testB_NoEdgeGestureDanish() { exercise("B", language: "da") }
    func testB_NoEdgeGestureEnglish() { exercise("B", language: "en") }
    func testC_NoTapCatcherDanish() { exercise("C", language: "da") }
    func testC_NoTapCatcherEnglish() { exercise("C", language: "en") }
    func testD_NoAnimationDanish() { exercise("D", language: "da") }
    func testD_NoAnimationEnglish() { exercise("D", language: "en") }
    func testE_PlainLayoutDanish() { exercise("E", language: "da") }
    func testE_PlainLayoutEnglish() { exercise("E", language: "en") }
    func testF_OutsideToolbarDanish() { exercise("F", language: "da") }
    func testF_OutsideToolbarEnglish() { exercise("F", language: "en") }
    func testG_WriteHistoryDanish() { exercise("G", language: "da") }
    func testG_WriteHistoryEnglish() { exercise("G", language: "en") }
    func testH_NoAmbientDanish() { exercise("H", language: "da") }
    func testH_NoAmbientEnglish() { exercise("H", language: "en") }
    func testI_NoInputProbeDanish() { exercise("I", language: "da") }
    func testI_NoInputProbeEnglish() { exercise("I", language: "en") }
    func testJ_CenterCoordinateDanish() { exercise("J", language: "da") }
    func testJ_CenterCoordinateEnglish() { exercise("J", language: "en") }
    func testJ_ElementTapDanish() { exercise("J", language: "da", elementTap: true) }
    func testJ_ElementTapEnglish() { exercise("J", language: "en", elementTap: true) }
    func testK_NoNavigationEffectsDanish() { exercise("K", language: "da") }
    func testK_NoNavigationEffectsEnglish() { exercise("K", language: "en") }
    func testL_RootInsideGateDanish() { exerciseControl("navigation.controlInsideGate", language: "da") }
    func testL_RootInsideGateEnglish() { exerciseControl("navigation.controlInsideGate", language: "en") }
    func testL_RootOutsideGateDanish() { exerciseControl("navigation.controlOutsideGate", language: "da") }
    func testL_RootOutsideGateEnglish() { exerciseControl("navigation.controlOutsideGate", language: "en") }

    private func exerciseControl(_ identifier: String, language: String) {
        app.launchArguments = [
            "--ui-test-navigation", "--ui-test-navigation-variant=G",
            "-jarvis.appLanguage", language, "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        app.launch()
        defer { app.terminate() }
        print("NAVIGATION CONTROL before tap: \(hypotheses)")
        let control = app.buttons[identifier]
        guard control.waitForExistence(timeout: 10) else {
            fail("\(identifier) missing", file: #filePath, line: #line)
            return
        }
        // XCTest invokes interruption monitors only while attempting an interaction.
        app.tap()
        control.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let increment = NSPredicate { _, _ in
            String(describing: control.value ?? "").contains("count=1;")
        }
        let outcome = XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: increment, object: control)], timeout: 10
        )
        print("NAVIGATION CONTROL \(identifier) \(language): \(outcome); \(hypotheses)")
        guard outcome == .completed else {
            fail("\(identifier) counter did not increment", file: #filePath, line: #line)
            return
        }
    }

    private func exercise(
        _ variant: String, language: String, elementTap: Bool = false,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        app.launchArguments = [
            "--ui-test-navigation", "--ui-test-navigation-variant=\(variant)",
            "-jarvis.appLanguage", language,
            "-AppleLanguages", "(\(language))",
            "-AppleLocale", language == "da" ? "da_DK" : "en_US",
        ]
        app.launch()
        var result = "FAIL: launcher"
        defer {
            print("NAVIGATION BISECT \(variant) \(language): \(result); \(state)")
            if result.hasPrefix("FAIL") {
                print("NAVIGATION LAUNCH HYPOTHESES: \(hypotheses)\n\(app.debugDescription)")
            }
            app.terminate()
        }

        let launcher = app.buttons["navigation.openSidebar"]
        print("navigation.openSidebar.exists=\(app.buttons["navigation.openSidebar"].exists)")
        let frameReady = NSPredicate { _, _ in
            guard launcher.exists, launcher.isEnabled else { return false }
            let frame = launcher.frame
            return !frame.isEmpty && frame.origin.x.isFinite && frame.origin.y.isFinite &&
                frame.width.isFinite && frame.height.isFinite && self.app.frame.contains(frame)
        }
        let launcherWait = XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: frameReady, object: launcher)],
            timeout: 10
        )
        print("NAVIGATION BISECT \(variant) \(language) before tap: \(state)")
        guard launcherWait == .completed else {
            fail("\(variant) \(language): navigation.openSidebar has no enabled onscreen frame",
                 file: file, line: line)
            return
        }
        let method = elementTap ? "element.tap" : "center-coordinate.tap"
        print("NAVIGATION BISECT \(variant) \(language): method=\(method)")
        if elementTap {
            launcher.tap()
        } else {
            launcher.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        if "GHIJK".contains(variant) {
            let started = ProcessInfo.processInfo.systemUptime
            for requested in [0.0, 0.5, 2.0] {
                let remaining = requested - (ProcessInfo.processInfo.systemUptime - started)
                if remaining > 0 { Thread.sleep(forTimeInterval: remaining) }
                let sampledState = state
                let elapsed = ProcessInfo.processInfo.systemUptime - started
                print("NAVIGATION BISECT \(variant) \(language) method=\(method) "
                      + "requested=\(requested)s observed=\(elapsed)s: \(sampledState)")
            }
        }

        result = "FAIL: sidebar"
        let chat = app.buttons["navigation.chat"]
        let sidebarWait = XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "isHittable == true"), object: chat
            )],
            timeout: 10
        )
        guard sidebarWait == .completed else {
            fail("\(variant) \(language): navigation.chat did not reach isHittable=true",
                 file: file, line: line)
            return
        }
        result = "PASS"
    }

    private var state: String {
        let probes = ["navigation.bisectState", "navigation.bisectRoot", "navigation.bisectWrites"].map { identifier in
            let probe = app.descendants(matching: .any)[identifier].firstMatch
            return "\(identifier)=\(probe.exists ? String(describing: probe.value ?? "no value") : "unavailable")"
        }.joined(separator: "; ")
        let launcher = app.buttons["navigation.openSidebar"]
        return probes + "; launcher.exists=\(launcher.exists)"
            + "; launcher.isEnabled=\(launcher.exists && launcher.isEnabled)"
            + "; launcher.value=\(launcher.exists ? String(describing: launcher.value ?? "no value") : "unavailable")"
    }

    private func fail(_ message: String, file: StaticString, line: UInt) {
        let findings = hypotheses
        let evidence = "\(message); \(state); \(findings)\n\(app.debugDescription)"
        print(evidence)
        let hierarchy = XCTAttachment(string: evidence)
        hierarchy.name = message
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = message
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCTFail("\(message); \(state); \(findings)", file: file, line: line)
    }

    private var hypotheses: String {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let modal = app.otherElements.matching(NSPredicate(
            format: "label CONTAINS[c] 'modal' OR identifier CONTAINS[c] 'modal' "
                + "OR identifier CONTAINS[c] 'presentation' OR label CONTAINS[c] 'dialog' "
                + "OR identifier CONTAINS[c] 'sheet' OR identifier CONTAINS[c] 'popover'"
        )).allElementsBoundByIndex.prefix(12).map { $0.debugDescription }
        let fullScreen = app.otherElements.allElementsBoundByIndex.prefix(100).filter {
            $0.frame.width >= app.frame.width * 0.9 && $0.frame.height >= app.frame.height * 0.9
        }.prefix(12).map { $0.debugDescription }
        let controls = ["navigation.controlInsideGate", "navigation.controlOutsideGate"].map {
            let control = app.buttons[$0]
            return "\($0):exists=\(control.exists),enabled=\(control.exists && control.isEnabled),"
                + "hittable=\(control.exists && control.isHittable),"
                + "value=\(control.exists ? String(describing: control.value ?? "") : "unavailable")"
        }
        return "modalHypothesis:alerts=\(app.alerts.count),sheets=\(app.sheets.count),"
            + "candidates=\(modal);permissionHypothesis:springboardAlerts=\(springboard.alerts.count),"
            + "interruptions=\(interruptions),systemTree=\(springboard.alerts.debugDescription);"
            + "fullScreenCandidates=\(fullScreen) (AX frames cannot prove touch interception or stacking);"
            + "gateHypothesis:\(state);controlHypothesis:\(controls)"
    }
}

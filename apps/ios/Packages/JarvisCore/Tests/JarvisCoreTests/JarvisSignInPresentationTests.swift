import XCTest
@testable import JarvisCore

final class JarvisSignInPresentationTests: XCTestCase {
    private struct Window: Equatable {
        var level = 0.0
        var isKey = false
        var isHidden = false
        var alpha = 1.0
        var isActive = true
        var isPrivacyCover = false
        var hasRoot = true

        var canPresent: Bool {
            JarvisSignInPresentation.canPresent(
                isHidden: isHidden,
                alpha: alpha,
                isForegroundActive: isActive,
                isPrivacyCover: isPrivacyCover,
                hasRootViewController: hasRoot
            )
        }
    }

    @MainActor
    private func select(_ windows: [Window]) -> Window? {
        JarvisSignInPresentation.window(
            from: windows,
            canPresent: { $0.canPresent },
            level: { $0.level },
            isKeyWindow: { $0.isKey }
        )
    }

    @MainActor
    func testGateAboveAlertLevelWinsOverKeyAppWindowInEitherOrder() async {
        let app = Window(isKey: true)
        let gate = Window(level: 2_001)
        XCTAssertEqual(select([app, gate]), gate)
        XCTAssertEqual(select([gate, app]), gate)
    }

    @MainActor
    func testHighestVisibleWindowWinsAndKeyWindowBreaksLevelTies() async {
        let app = Window()
        let keyApp = Window(isKey: true)
        let alert = Window(level: 2_000)
        let gate = Window(level: 2_001)
        XCTAssertEqual(select([app, keyApp]), keyApp)
        XCTAssertEqual(select([keyApp, app]), keyApp)
        XCTAssertEqual(select([gate, alert, keyApp]), gate)
        XCTAssertEqual(select([app]), app)
    }

    @MainActor
    func testHiddenTransparentInactivePrivacyAndRootlessWindowsAreExcluded() async {
        let app = Window(isKey: true)
        let excluded = [
            Window(level: 2_001, isHidden: true),
            Window(level: 2_001, alpha: 0),
            Window(level: 2_001, isActive: false),
            Window(level: 2_001, isPrivacyCover: true),
            Window(level: 2_001, hasRoot: false),
        ]
        for window in excluded {
            XCTAssertFalse(window.canPresent)
            XCTAssertEqual(select([window, app]), app)
            XCTAssertNil(select([window]))
        }
        XCTAssertNil(select([]))
    }

    @MainActor
    func testPresentedAndVisibleChildControllerChainSelectsTopController() async {
        let children = ["root": "navigation", "navigation": "selectedTab", "selectedTab": "sheet"]
        XCTAssertEqual(
            JarvisSignInPresentation.viewController(
                from: "root",
                next: { children[$0] },
                canPresent: { $0 == "sheet" }
            ),
            "sheet"
        )
        XCTAssertEqual(
            JarvisSignInPresentation.viewController(from: "gateHost", next: { _ in nil }, canPresent: { _ in true }),
            "gateHost"
        )
    }

    @MainActor
    func testDetachedOrDismissingTopControllerDoesNotFallBackBehindSheet() async {
        for unavailable in ["detached", "dismissing"] {
            XCTAssertNil(JarvisSignInPresentation.viewController(
                from: "root",
                next: { $0 == "root" ? unavailable : nil },
                canPresent: { $0 == "root" }
            ))
        }
    }
}

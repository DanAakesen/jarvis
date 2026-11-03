import XCTest

/// Opens the debug-only component gallery and attaches a screenshot so reviewers can compare it with the design board.
final class ComponentGalleryUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testGalleryShowsEverySharedComponentAndAttachesAScreenshot() {
        app.launchArguments = ["--component-gallery", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.descendants(matching: .any)["gallery.header.refresh"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["gallery.orbs"].exists)
        XCTAssertTrue(app.buttons["navigation.openSidebar"].exists)
        for id in ["gallery.icon", "gallery.menu", "gallery.label"] {
            XCTAssertTrue(app.descendants(matching: .any)[id].exists, id)
        }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Component gallery"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

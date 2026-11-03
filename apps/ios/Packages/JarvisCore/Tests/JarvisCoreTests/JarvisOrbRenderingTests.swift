import Foundation
import XCTest

/// Source-level guards for the single shared mini-core mark (the SwiftUI target cannot be built on Linux).
final class JarvisOrbRenderingTests: XCTestCase {
    private func repositoryRoot() throws -> URL {
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { repository.deleteLastPathComponent() }
        return repository
    }

    private func source(_ path: String) throws -> String {
        try String(contentsOf: repositoryRoot().appendingPathComponent(path), encoding: .utf8)
    }

    func testLockScreenNotificationFixtureUsesAnAppIconSizedMiniCore() throws {
        let source = try source("apps/ios/Jarvis/JarvisLockScreenTasksPreview.swift")
        XCTAssertTrue(source.contains("JarvisOrb(activity: .calm, size: 38)"))
        XCTAssertTrue(source.contains(".frame(width: 38, height: 38)"))
    }

    func testEveryOrbSurfaceUsesTheOneMiniCoreView() throws {
        let files = [
            "apps/ios/Jarvis/JarvisGateRootView.swift", "apps/ios/Jarvis/VoiceScreen.swift",
            "apps/ios/Jarvis/JarvisChatScreen.swift", "apps/ios/Jarvis/JarvisLockScreenTasksPreview.swift",
            "apps/ios/VoiceActivity/JarvisVoiceActivity.swift",
        ]
        for file in files {
            let text = try source(file)
            XCTAssertTrue(text.contains("JarvisOrb(") || text.contains("JarvisOrbButton("), file)
            XCTAssertFalse(text.contains("JarvisOrbCanvas("), file)
            XCTAssertFalse(text.contains("JarvisMiniCore"), file)
            XCTAssertFalse(text.contains("JarvisOrbView"), file)
            XCTAssertFalse(text.contains("VoiceOrbView"), file)
        }
        let home = try source("apps/ios/Jarvis/JarvisTodayScreen.swift")
        XCTAssertFalse(home.contains("JarvisOrb"), "The Home composer is the shared chat composer: no orb")
        XCTAssertTrue(home.contains("JarvisComposerBar("))
        let repository = URL(fileURLWithPath: #filePath)
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: repository.deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().appendingPathComponent("apps/ios/Jarvis/JarvisOrbView.swift").path
        ))
    }

    func testTheOrbIsTheWebOrbPortedIntoOneCanvasAndTheOldMiniCoreIsGone() throws {
        let canvas = try source("apps/ios/Jarvis/JarvisOrbCanvas.swift")
        XCTAssertTrue(canvas.contains("TimelineView(.animation"))
        XCTAssertTrue(canvas.contains("Canvas { context, size in"))
        XCTAssertTrue(canvas.contains("JarvisOrbAnimator"), "Motion comes from the shared web-orb motion model")
        XCTAssertTrue(canvas.contains("JarvisOrbGeometry.shell"), "Geometry is the web orb's seeded construction")
        XCTAssertTrue(canvas.contains("#52dcfa") || canvas.contains("0x52"), "Cyan rim colour")
        XCTAssertTrue(canvas.contains("0xff") && canvas.contains("0xb4"), "Amber core colour")
        XCTAssertTrue(canvas.contains("accessibilityReduceMotion"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: try repositoryRoot().appendingPathComponent("apps/ios/Jarvis/JarvisMiniCoreView.swift").path))
    }

    func testOrbIsAlwaysSquareAndCircularAndScaledBySizeOnly() throws {
        let controls = try source("apps/ios/Jarvis/JarvisControls.swift")
        let orb = try XCTUnwrap(controls.components(separatedBy: "struct JarvisOrb: View").last)
            .components(separatedBy: "\nextension ").first ?? ""
        XCTAssertTrue(orb.contains("JarvisOrbCanvas(activity: activity, isStatic: isStatic)"))
        XCTAssertTrue(orb.contains(".aspectRatio(1, contentMode: .fit)"))
        XCTAssertTrue(orb.contains(".frame(width: size, height: size)"))
        XCTAssertTrue(orb.contains(".clipShape(Circle())"))
    }
}

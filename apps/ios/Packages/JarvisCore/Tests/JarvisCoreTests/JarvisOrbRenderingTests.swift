import Foundation
import XCTest

/// Source-level guards for the single shared mini-core mark (the SwiftUI target cannot be built on Linux).
final class JarvisOrbRenderingTests: XCTestCase {
    private func source(_ path: String) throws -> String {
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { repository.deleteLastPathComponent() }
        return try String(contentsOf: repository.appendingPathComponent(path), encoding: .utf8)
    }

    func testLockScreenNotificationFixtureUsesAnAppIconSizedMiniCore() throws {
        let source = try source("apps/ios/Jarvis/JarvisLockScreenTasksPreview.swift")
        XCTAssertTrue(source.contains("JarvisMiniCoreView(activity: .calm, diameter: 38)"))
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
            XCTAssertTrue(text.contains("JarvisMiniCoreView("), file)
            XCTAssertFalse(text.contains("JarvisOrbView"), file)
        }
        let repository = URL(fileURLWithPath: #filePath)
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: repository.deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().appendingPathComponent("apps/ios/Jarvis/JarvisOrbView.swift").path
        ))
    }

    func testMiniCoreIsFilamentsOnTransparentCanvasWithoutRotationOrBending() throws {
        let core = try source("apps/ios/Jarvis/JarvisMiniCoreView.swift")
        XCTAssertTrue(core.contains("Canvas { context, size in"))
        XCTAssertTrue(core.contains(".scaleEffect(1 + CGFloat(wave) * amplitude)"))
        XCTAssertFalse(core.contains("rotationEffect"))
        XCTAssertFalse(core.contains("scaleEffect(x:"))
        XCTAssertFalse(core.contains(".brightness("), "Core animation must preserve transparent pixels")
        XCTAssertFalse(core.contains("orbGlass"), "The old glass sphere is gone")
    }
}

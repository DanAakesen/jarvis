import Foundation
import XCTest

/// Source-level guards for the shared composer look (the SwiftUI target cannot be built on Linux).
final class JarvisComposerControlsTests: XCTestCase {
    private func source(_ path: String) throws -> String {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        return try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
    }

    func testComposerIconsAreOrangeWithNoBackgroundAndLiveInTheSharedLayer() throws {
        let controls = try source("apps/ios/Jarvis/JarvisControls.swift")
        let button = try XCTUnwrap(controls.components(separatedBy: "struct JarvisComposerIconButton").last)
        XCTAssertTrue(button.contains("foregroundStyle(JarvisDesignTokens.primaryAccent)"))
        XCTAssertFalse(button.contains(".background("))
        XCTAssertFalse(button.contains("Circle()"))

        let chat = try source("apps/ios/Jarvis/JarvisChatScreen.swift")
        XCTAssertTrue(chat.contains(#"systemImage: "paperplane.fill""#))
        XCTAssertTrue(chat.contains(#"systemImage: "waveform""#))
        XCTAssertFalse(chat.contains("trailingDisc"))
        XCTAssertFalse(chat.contains("JarvisFilledCircleButton"))
    }

    func testComposerHasRimWithReducedMotionAndOneClearGlassStyle() throws {
        let controls = try source("apps/ios/Jarvis/JarvisControls.swift")
        XCTAssertTrue(controls.contains("accessibilityReduceMotion"))
        XCTAssertTrue(controls.contains("Double.random(in: 2.5...7)"))
        XCTAssertTrue(controls.contains(".clear.tint("))
        XCTAssertFalse(controls.contains(".mask"))

        let bar = try source("apps/ios/Jarvis/JarvisComposerBar.swift")
        XCTAssertTrue(bar.contains(".jarvisRim("))
        XCTAssertFalse(bar.contains(".glassEffect(.regular"))

        for screen in ["JarvisChatScreen.swift", "JarvisTodayScreen.swift"] {
            let text = try source("apps/ios/Jarvis/\(screen)")
            XCTAssertTrue(text.contains("JarvisComposerBar("), "\(screen) uses the shared composer")
            XCTAssertFalse(text.contains(".glassEffect(.regular"))
        }
    }
}

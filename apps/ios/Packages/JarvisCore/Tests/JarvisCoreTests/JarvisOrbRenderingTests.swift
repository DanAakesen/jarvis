import Foundation
import XCTest

final class JarvisOrbRenderingTests: XCTestCase {
    func testCoreGlowHasTransparentMarginAndFadesBeforeItsBounds() throws {
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { repository.deleteLastPathComponent() }
        let source = try String(
            contentsOf: repository.appendingPathComponent("apps/ios/Jarvis/JarvisOrbView.swift"),
            encoding: .utf8
        )
        let core = try XCTUnwrap(source.components(separatedBy: "Canvas { context, canvasSize in").last?
            .components(separatedBy: ".frame(width: size, height: size)").first)
        XCTAssertTrue(core.contains("CGSize(width: size * 0.42, height: size * 0.42)"))
        XCTAssertTrue(core.contains("(canvasSize.width - filamentSize.width) / 2"))
        XCTAssertTrue(core.contains("(canvasSize.height - filamentSize.height) / 2"))
        XCTAssertTrue(core.contains(".frame(width: size * 0.7, height: size * 0.7)"))
        XCTAssertTrue(core.contains(".init(color: .clear, location: 1)"))
        XCTAssertTrue(core.contains("endRadius: size * 0.35"))
        XCTAssertFalse(core.contains(".brightness("), "Core animation must preserve transparent pixels")
        let mask = try XCTUnwrap(core.range(of: ".mask {"))
        let scale = try XCTUnwrap(core.range(of: ".scaleEffect(x:"))
        XCTAssertLessThan(mask.lowerBound, scale.lowerBound, "The feathered core must animate as one layer")
    }
}

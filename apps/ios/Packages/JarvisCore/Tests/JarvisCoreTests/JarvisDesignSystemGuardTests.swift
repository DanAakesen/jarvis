import Foundation
import XCTest

/// Source-level guard for the design system (the SwiftUI target cannot be built on Linux). Screens must use the shared
/// components; to change the look, change the shared component.
///
/// Allowed exceptions, by file name:
/// - `JarvisControls.swift` and `JarvisDesignSystem.swift` own every glass surface, button style and orb component.
/// - `JarvisMiniCoreView.swift` is the orb drawing itself, which `JarvisOrb` wraps.
/// - `JarvisComponentGallery.swift` only shows the shared components and defines none of its own.
/// - `.buttonStyle(.plain)` and `JarvisPressableRowButtonStyle` stay allowed in screens: they only make a whole content
///   row (a note, a list item, a chart slice, a disclosure header) tappable and draw no chrome. Anything that looks like a
///   button (icon, label, menu, chip, tab) uses the shared components.
/// - The Live Activity's `Button(intent:)` is the WidgetKit API and cannot use SwiftUI button styles.
/// Any other file that needs a new look must add it to the shared layer instead of adding an exception here.
final class JarvisDesignSystemGuardTests: XCTestCase {
    private static let sharedLayer: Set<String> = ["JarvisControls.swift", "JarvisDesignSystem.swift"]
    private static let orbDrawing: Set<String> = ["JarvisMiniCoreView.swift"]

    private func swiftSources() throws -> [(name: String, text: String)] {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        let app = root.appendingPathComponent("apps/ios")
        var result: [(String, String)] = []
        for folder in ["Jarvis", "Shared", "VoiceActivity", "Widgets"] {
            let enumerator = FileManager.default.enumerator(at: app.appendingPathComponent(folder), includingPropertiesForKeys: nil)
            while let url = enumerator?.nextObject() as? URL {
                guard url.pathExtension == "swift" else { continue }
                result.append((url.lastPathComponent, try String(contentsOf: url, encoding: .utf8)))
            }
        }
        XCTAssertFalse(result.isEmpty)
        return result
    }

    private func code(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
            .joined(separator: "\n")
    }

    private func offenders(_ pattern: String, allowing: Set<String>) throws -> [String] {
        let expression = try NSRegularExpression(pattern: pattern)
        return try swiftSources().compactMap { name, text in
            guard !allowing.contains(name) else { return nil }
            let body = code(text)
            return expression.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)) == nil ? nil : name
        }
    }

    func testNoScreenCallsGlassEffect() throws {
        XCTAssertEqual(try offenders(#"\.glassEffect\("#, allowing: Self.sharedLayer), [])
    }

    func testNoScreenAppliesButtonChrome() throws {
        let chrome = #"\.buttonStyle\(\s*\.(?:glass|glassProminent|bordered|borderedProminent|borderless)\b"#
        XCTAssertEqual(try offenders(chrome, allowing: Self.sharedLayer), [])
    }

    func testNoScreenDefinesAButtonStyle() throws {
        XCTAssertEqual(try offenders(#":\s*(?:[A-Za-z]+,\s*)*ButtonStyle\b"#, allowing: Self.sharedLayer), [])
    }

    func testNoScreenDrawsItsOwnOrb() throws {
        let orbType = #"(?:struct|class|enum)\s+\w*Orb\w*\s*(?:<[^>]*>)?\s*:"#
        XCTAssertEqual(try offenders(orbType, allowing: Self.sharedLayer.union(Self.orbDrawing)), [])
        XCTAssertEqual(try offenders(#"\bVoiceOrbView\b|\bJarvisOrbView\b"#, allowing: []), [])
    }

    func testScreensCreateOrbsOnlyThroughJarvisOrb() throws {
        let allowing = Self.sharedLayer.union(Self.orbDrawing)
        XCTAssertEqual(try offenders(#"JarvisMiniCoreView\("#, allowing: allowing), [])
    }

    func testTheGuardDetectsButtonChrome() throws {
        let expression = try NSRegularExpression(pattern: #"\.buttonStyle\(\s*\.(?:glass|glassProminent|bordered|borderedProminent|borderless)\b"#)
        for sample in ["Button(\"x\") {}.buttonStyle(.glass)", "x.buttonStyle(.glassProminent)", "x.buttonStyle(.borderless)"] {
            XCTAssertNotNil(expression.firstMatch(in: sample, range: NSRange(sample.startIndex..., in: sample)))
        }
        let plain = "x.buttonStyle(.plain)"
        XCTAssertNil(expression.firstMatch(in: plain, range: NSRange(plain.startIndex..., in: plain)))
    }

    func testTheGuardDetectsAViolation() throws {
        let expression = try NSRegularExpression(pattern: #"\.glassEffect\("#)
        let sample = "Text(\"x\").glassEffect(.regular, in: .capsule)"
        XCTAssertNotNil(expression.firstMatch(in: sample, range: NSRange(sample.startIndex..., in: sample)))
    }
}

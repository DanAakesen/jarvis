import Foundation
import Observation
import XCTest
@testable import JarvisCore

final class JarvisPaletteTests: XCTestCase {
    func testPairIsObservedTogetherAndReloadedByOtherProcesses() throws {
        let suite = "palette-tests-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let phone = JarvisPalette(defaults: defaults), widget = JarvisPalette(defaults: defaults)
        XCTAssertEqual(phone.primaryHex, "FFB45C")
        XCTAssertEqual(phone.secondaryHex, "52DCFA")

        let changed = expectation(description: "SwiftUI reads invalidate on change")
        withObservationTracking {
            _ = phone.primaryHex
            _ = phone.secondaryHex
        } onChange: {
            changed.fulfill()
        }
        phone.set(primaryHex: "#aaccee", secondaryHex: "226644")
        wait(for: [changed], timeout: 0.5)
        widget.reloadFromDefaults()
        XCTAssertEqual(widget.selection, phone.selection)
        XCTAssertEqual(widget.primaryHex, "AACCEE")
        XCTAssertEqual(widget.secondaryHex, "226644")

        phone.set(primaryHex: "112233", secondaryHex: "not-a-color")
        XCTAssertEqual(phone.selection, widget.selection)
        XCTAssertEqual(JarvisPalette(defaults: defaults).selection, widget.selection)
    }

    func testDecodedPairValidatesBothColours() throws {
        let pair = try XCTUnwrap(JarvisPaletteSelection(primaryHex: "fe98ad", secondaryHex: "#776655"))
        XCTAssertEqual(try JSONDecoder().decode(JarvisPaletteSelection.self, from: JSONEncoder().encode(pair)), pair)
        let invalid = Data(#"{"primaryHex":"AABBCC","secondaryHex":"FFF"}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(JarvisPaletteSelection.self, from: invalid))
    }

    func testContrastingAccentsRetainTheOriginalChoice() throws {
        for hex in ["000000", "FFFFFF", "FFB45C", "52DCFA", "0800FF", "FFFF00", "564333"] {
            let tone = try XCTUnwrap(PaletteTone(hex: hex))
            XCTAssertEqual(tone.hex, hex)
            XCTAssertGreaterThanOrEqual(PaletteTone.luminance(tone.dark), 0.31)
            XCTAssertLessThanOrEqual(PaletteTone.luminance(tone.light), 0.145)
        }
    }

    func testLatticePreservesDefaultCoreAndRecoloursSecondaryIndependently() throws {
        let original = JarvisLatticeColors(selection: .standard)
        let selection = try XCTUnwrap(JarvisPaletteSelection(primaryHex: JarvisPalette.defaultPrimaryHex, secondaryHex: "FF0044"))
        let changed = JarvisLatticeColors(selection: selection)
        XCTAssertEqual(original.warm.g, JarvisOrbAppearance.warm.g)
        XCTAssertEqual(original.cool.g, JarvisOrbAppearance.cool.g)
        XCTAssertEqual(changed.warm.g, original.warm.g)
        XCTAssertEqual(changed.cool.g, selection.secondary.dark.g)
        XCTAssertNotEqual(changed.glassEdge.g, original.glassEdge.g)
    }
}

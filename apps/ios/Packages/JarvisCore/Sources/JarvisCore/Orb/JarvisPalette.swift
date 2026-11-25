import Foundation
import Observation

/// The phone and Watch each persist one complete pair in their local App Group.
public final class JarvisPalette: Observable, @unchecked Sendable {
    public static let defaultPrimaryHex = JarvisPaletteSelection.standard.primaryHex
    public static let defaultSecondaryHex = JarvisPaletteSelection.standard.secondaryHex
    public static let shared = JarvisPalette(defaults: UserDefaults(suiteName: JarvisWidgetSnapshot.appGroupIdentifier) ?? .standard)

    private static let key = "appearance.palette.v1"
    private let defaults: UserDefaults
    // Protect the cached pair and its write to defaults together. Observers track that pair as one value.
    private let lock = NSLock()
    private let observation = ObservationRegistrar()
    private var stored: JarvisPaletteSelection

    init(defaults: UserDefaults) {
        self.defaults = defaults
        stored = Self.read(defaults)
    }

    public var selection: JarvisPaletteSelection {
        observation.access(self, keyPath: \.selection)
        return lock.withLock { stored }
    }

    /// Reads the latest pair from the App Group for extension views that have no timeline provider.
    public var persistedSelection: JarvisPaletteSelection { Self.read(defaults) }

    public var primaryHex: String { selection.primary.hex }
    public var secondaryHex: String { selection.secondary.hex }

    public func set(primaryHex: String, secondaryHex: String) {
        guard let next = JarvisPaletteSelection(primaryHex: primaryHex, secondaryHex: secondaryHex), selection != next else { return }
        observation.withMutation(of: self, keyPath: \.selection) {
            lock.withLock {
                defaults.set(["primary": next.primary.hex, "secondary": next.secondary.hex], forKey: Self.key)
                stored = next
            }
        }
    }

    /// A widget process may stay alive while its containing app changes the selection.
    public func reloadFromDefaults() {
        guard Self.read(defaults) != selection else { return }
        observation.withMutation(of: self, keyPath: \.selection) {
            lock.withLock { stored = Self.read(defaults) }
        }
    }

    private static func read(_ defaults: UserDefaults) -> JarvisPaletteSelection {
        if let pair = defaults.dictionary(forKey: key),
           let primary = pair["primary"] as? String, let secondary = pair["secondary"] as? String,
           let valid = JarvisPaletteSelection(primaryHex: primary, secondaryHex: secondary) { return valid }
        return .standard
    }
}

public struct JarvisPaletteSelection: Hashable, Codable, Sendable {
    public var primaryHex: String { primary.hex }
    public var secondaryHex: String { secondary.hex }
    let primary: PaletteTone
    let secondary: PaletteTone

    public static let standard = Self(primary: PaletteTone(rgb: 0xFFB45C), secondary: PaletteTone(rgb: 0x52DCFA))

    private init(primary: PaletteTone, secondary: PaletteTone) {
        self.primary = primary
        self.secondary = secondary
    }

    public init?(primaryHex: String, secondaryHex: String) {
        guard let first = PaletteTone(hex: primaryHex), let second = PaletteTone(hex: secondaryHex) else { return nil }
        self.init(primary: first, secondary: second)
    }

    private enum CodingKeys: String, CodingKey { case primaryHex, secondaryHex }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let primary = try values.decode(String.self, forKey: .primaryHex)
        let secondary = try values.decode(String.self, forKey: .secondaryHex)
        guard let pair = Self(primaryHex: primary, secondaryHex: secondary) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid palette hex"))
        }
        self = pair
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(primaryHex, forKey: .primaryHex)
        try values.encode(secondaryHex, forKey: .secondaryHex)
    }
}

typealias PaletteRGB = (r: Double, g: Double, b: Double)

struct PaletteTone: Hashable, Sendable {
    let hex: String
    let dark: PaletteRGB
    let increasedContrastDark: PaletteRGB
    let light: PaletteRGB

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.hex == rhs.hex }
    func hash(into hasher: inout Hasher) { hasher.combine(hex) }

    init?(hex: String) {
        let digits = hex.hasPrefix("#") ? hex.dropFirst() : hex[...]
        guard digits.utf8.count == 6, digits.allSatisfy(\.isHexDigit), let rgb = UInt32(digits, radix: 16) else { return nil }
        self.init(rgb: rgb)
    }

    init(rgb: UInt32) {
        hex = String(format: "%06X", rgb)
        let raw: PaletteRGB = (Double(rgb >> 16) / 255, Double(rgb >> 8 & 255) / 255, Double(rgb & 255) / 255)
        // Standard red clears the dark surface contrast floor without any white mixed in.
        dark = Self.darkVariant(raw, minimumLuminance: 0.21)
        increasedContrastDark = Self.darkVariant(raw, minimumLuminance: 0.31)
        light = Self.adapt(raw, towards: (0, 0, 0), target: 0.145, brightening: false)
    }

    private static func darkVariant(_ raw: PaletteRGB, minimumLuminance: Double) -> PaletteRGB {
        guard luminance(raw) < minimumLuminance else { return raw }
        let peak = max(raw.r, raw.g, raw.b)
        let brightest: PaletteRGB = peak > 0 ? (raw.r / peak, raw.g / peak, raw.b / peak) : raw
        if luminance(brightest) >= minimumLuminance {
            return adapt(raw, towards: brightest, target: minimumLuminance, brightening: true)
        }
        return adapt(brightest, towards: (1, 1, 1), target: minimumLuminance, brightening: true)
    }

    private static func adapt(_ raw: PaletteRGB, towards end: PaletteRGB, target: Double, brightening: Bool) -> PaletteRGB {
        func sufficient(_ tone: PaletteRGB) -> Bool {
            let luminance = Self.luminance(tone)
            return brightening ? luminance >= target : luminance <= target
        }
        guard !sufficient(raw) else { return raw }
        var low = 0.0, high = 1.0
        for _ in 0..<12 {
            let middle = (low + high) / 2
            if sufficient(mix(raw, end, middle)) { high = middle } else { low = middle }
        }
        return mix(raw, end, high)
    }

    static func luminance(_ rgb: PaletteRGB) -> Double {
        func linear(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
    }

    static func mix(_ a: PaletteRGB, _ b: PaletteRGB, _ amount: Double) -> PaletteRGB {
        (a.r + (b.r - a.r) * amount, a.g + (b.g - a.g) * amount, a.b + (b.b - a.b) * amount)
    }
}

#if canImport(SwiftUI)
import SwiftUI
#if os(iOS)
import UIKit
#endif

public extension JarvisPaletteSelection {
    var primaryColor: Color { primary.adaptiveColor }
    var secondaryColor: Color { secondary.adaptiveColor }
    var primaryDarkColor: Color { primary.darkColor }
    var secondaryDarkColor: Color { secondary.darkColor }
}

public extension JarvisPalette {
    var primaryColor: Color { selection.primaryColor }
    var secondaryColor: Color { selection.secondaryColor }
    var primaryDarkColor: Color { selection.primaryDarkColor }
    var secondaryDarkColor: Color { selection.secondaryDarkColor }
    var onPrimaryColor: Color {
        // All light-mode fills are dark enough for white, and all dark-mode fills are light enough for black.
        PaletteTone.adaptive(light: (1, 1, 1), dark: (0, 0, 0))
    }
}

extension PaletteTone {
    var darkColor: Color { Color(red: dark.r, green: dark.g, blue: dark.b) }
    var adaptiveColor: Color { Self.adaptive(light: light, dark: dark, increasedContrastDark: increasedContrastDark) }

    fileprivate static func adaptive(light: PaletteRGB, dark: PaletteRGB, increasedContrastDark: PaletteRGB? = nil) -> Color {
#if os(iOS)
        Color(uiColor: UIColor { traits in
            let darkTone = traits.accessibilityContrast == .high ? (increasedContrastDark ?? dark) : dark
            let c = traits.userInterfaceStyle == .dark ? darkTone : light
            return UIColor(red: c.r, green: c.g, blue: c.b, alpha: 1)
        })
#else
        Color(red: dark.r, green: dark.g, blue: dark.b)
#endif
    }
}
#endif

import Foundation
import Observation

public enum JarvisMaterialControl: String, CaseIterable, Sendable {
    case gradient, frost, glass

    public var defaultPercent: Int {
        switch self {
        case .gradient: 50
        case .frost: 20
        case .glass: 65
        }
    }
}

public enum JarvisCardGlow: String, CaseIterable, Sendable {
    case primary, secondary, custom
}

/// One set of normalized intensities for every app-owned glass surface.
public struct JarvisMaterialSettings: Equatable, Sendable {
    public let percentages: [String: Int]

    public let glow: JarvisCardGlow
    public let customHex: String

    public init(_ saved: [String: Int] = [:], glow: JarvisCardGlow = .primary,
                customHex: String = JarvisPalette.defaultPrimaryHex) {
        self.glow = glow
        self.customHex = JarvisPaletteSelection(primaryHex: customHex, secondaryHex: JarvisPalette.defaultSecondaryHex)?.primaryHex
            ?? JarvisPalette.defaultPrimaryHex
        percentages = Dictionary(uniqueKeysWithValues: JarvisMaterialControl.allCases.map { control in
            let value = saved[control.rawValue].flatMap { (0...100).contains($0) ? $0 : nil }
            return (control.rawValue, value ?? control.defaultPercent)
        })
    }

    public subscript(_ control: JarvisMaterialControl) -> Double {
        Double(percentages[control.rawValue] ?? control.defaultPercent) / 100
    }
}

@MainActor @Observable public final class JarvisMaterialPreferences {
    public static let shared = JarvisMaterialPreferences()
    private let defaults: UserDefaults
    private static let key = "appearance.material.v1"
    public private(set) var current: JarvisMaterialSettings

    init(defaults: UserDefaults = UserDefaults(suiteName: JarvisWidgetSnapshot.appGroupIdentifier) ?? .standard) {
        self.defaults = defaults
        current = JarvisMaterialSettings(defaults.dictionary(forKey: Self.key) as? [String: Int] ?? [:],
            glow: JarvisCardGlow(rawValue: defaults.string(forKey: "appearance.cardGlow") ?? "") ?? .primary,
            customHex: defaults.string(forKey: "appearance.customGlow") ?? JarvisPalette.defaultPrimaryHex)
    }

    public func apply(_ settings: JarvisMaterialSettings) {
        guard current != settings else { return }
        current = settings
        defaults.set(settings.glow.rawValue, forKey: "appearance.cardGlow")
        defaults.set(settings.customHex, forKey: "appearance.customGlow")
        defaults.set(settings.percentages, forKey: Self.key)
    }
}

import JarvisCore
import SwiftUI

/// Only stored overrides participate. Removing an individual card colour restores its shared material.
@MainActor @Observable final class JarvisSurfacePalette {
    static let shared = JarvisSurfacePalette()
    private static let key = "jarvis.appearance.surfaceOverrides"
    private var overrides = UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:]

    func apply(_ response: JarvisSettingsResponse) {
        var saved: [String: String] = [:]
        for role in JarvisSurfaceSettings.roles + JarvisSurfaceSettings.cards {
            if let hex = response.string(area: "appearance", key: "surface-" + role) { saved[role] = hex }
        }
        guard saved != overrides else { return }
        overrides = saved
        UserDefaults.standard.set(saved, forKey: Self.key)
    }

    func color(_ role: String, inherit: String? = nil) -> Color? {
        guard let hex = overrides[role] ?? inherit.flatMap({ overrides[$0] }),
              let rgb = UInt32(hex.drop(while: { $0 == "#" }), radix: 16) else { return nil }
        return Color(.sRGB, red: Double(rgb >> 16) / 255, green: Double((rgb >> 8) & 255) / 255,
                     blue: Double(rgb & 255) / 255)
    }

    static func label(_ role: String) -> String {
        switch role {
        case "page": "Page backdrop"
        case "card": "Cards and sections"
        case "control": "Buttons and toggles"
        case "selected": "Selected controls"
        case "field": "Input fields"
        case "next": "Home · Up Next"
        case "activity": "Home · Activity"
        case "schedule": "Home · Schedule"
        case "calendar": "Calendar · Timeline"
        case "agenda": "Calendar · Agenda items"
        default: "Health · " + role.capitalized
        }
    }
}

private struct JarvisCardRoleKey: EnvironmentKey {
    static let defaultValue = "card"
}
extension EnvironmentValues {
    var jarvisCardRole: String {
        get { self[JarvisCardRoleKey.self] }
        set { self[JarvisCardRoleKey.self] = newValue }
    }
}


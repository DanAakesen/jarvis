import Foundation
import JarvisCore

enum JarvisUITestConfiguration {
    static var isEnabled: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--ui-testing")
        #else
        false
        #endif
    }

    static func configureDefaults() {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--ui-testing") {
            if let language = argument("--ui-test-language="), ["da", "en"].contains(language) {
                UserDefaults.standard.set(language, forKey: JarvisAppLanguage.preferenceKey)
            }
            if let theme = argument("--ui-test-theme="), ["dark", "light"].contains(theme) {
                UserDefaults.standard.set(theme, forKey: "jarvis.appTheme")
            }
        }
        if let theme = argument("--screenshot-theme="), ["dark", "light"].contains(theme) {
            UserDefaults.standard.set(theme, forKey: "jarvis.appTheme")
        }
        #endif
    }

    private static func argument(_ prefix: String) -> String? {
        ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(prefix) })
            .map { String($0.dropFirst(prefix.count)) }
    }
}

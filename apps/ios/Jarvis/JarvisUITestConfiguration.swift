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
        guard isEnabled else { return }
        let arguments = ProcessInfo.processInfo.arguments
        if let language = argument("--ui-test-language="), ["da", "en"].contains(language) {
            UserDefaults.standard.set(language, forKey: JarvisAppLanguage.preferenceKey)
        }
        if let theme = argument("--ui-test-theme="), ["dark", "light"].contains(theme) {
            UserDefaults.standard.set(theme, forKey: "jarvis.appTheme")
        }
    }

    private static func argument(_ prefix: String) -> String? {
        ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(prefix) })
            .map { String($0.dropFirst(prefix.count)) }
    }
}

import Foundation

/// Short, context-aware text shown inside the assistant's own bubble while its answer is on the way.
public enum ChatThinkingPhrase {
    public static func key(forRequest text: String, hasImage: Bool = false) -> JarvisChatLocalizationKey {
        let lowered = text.lowercased()
        func mentions(_ words: [String]) -> Bool { words.contains { lowered.contains($0) } }
        if hasImage { return .thinkingImage }
        if mentions(["vejr", "weather", "forecast", "regn", "rain", "temperatur"]) { return .thinkingWeather }
        if mentions(["kalender", "calendar", "møde", "meeting", "aftale", "appointment"]) { return .thinkingCalendar }
        if mentions(["mail", "email", "e-mail", "inbox", "indbakke"]) { return .thinkingMail }
        if mentions(["kode", "code", "bug", "pull request", "commit", "deploy"]) { return .thinkingCode }
        if mentions(["søg", "find", "search", "look up", "slå op"]) { return .thinkingSearch }
        return .thinkingGeneric
    }

    public static func phrase(
        forRequest text: String,
        hasImage: Bool = false,
        language: JarvisAppLanguage = .default
    ) -> String {
        JarvisChatLocalization.string(key(forRequest: text, hasImage: hasImage), language: language)
    }
}

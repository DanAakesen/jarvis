import Foundation

public enum JarvisCarPlayPresentation {
    public static func indicator(
        state: VoiceSessionState, connection: VoiceConnectionPresentationState,
        starting: Bool, muted: Bool, audioReady: Bool, signInRequired: Bool, microphoneDenied: Bool
    ) -> String {
        if microphoneDenied { return "Microphone unavailable" }
        if signInRequired { return "Sign-in required" }
        if state == .ended || state == .idle { return starting ? "Connecting" : "Ended" }
        if connection == .lost { return "Voice unavailable" }
        if connection == .retrying { return "Reconnecting" }
        switch state {
        case .connecting: return "Connecting"
        case .failed: return "Voice unavailable"
        case .reconnecting: return "Reconnecting"
        case .thinking, .listening, .speaking:
            if muted { return "Muted" }
            if state == .thinking { return "Thinking" }
            if state == .speaking { return "Speaking" }
            return audioReady ? "Listening" : "Connecting"
        case .idle, .ended: return "Ended"
        }
    }

    /// Show the body under its own note row, keeping the excerpt readable on narrow screens.
    public static func noteExcerpt(_ markdown: String) -> [String] {
        let body = JarvisNoteParts(markdown).body.trimmingCharacters(in: .whitespacesAndNewlines)
        var lines: [String] = []
        var line = ""
        for word in body.prefix(400).split(whereSeparator: { $0.isWhitespace }) {
            if !line.isEmpty, line.count + word.count + 1 > 42 {
                lines.append(line)
                line = ""
            }
            line += (line.isEmpty ? "" : " ") + String(word)
        }
        if !line.isEmpty { lines.append(line) }
        if body.count > 400, !lines.isEmpty { lines[lines.count - 1] += "…" }
        return lines.isEmpty ? ["Empty note"] : lines
    }
}

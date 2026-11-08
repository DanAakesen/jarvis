import Foundation

/// Presentation of observed work, without exposing model reasoning or inventing progress.
public enum ChatWorkProgress {
    public static func elapsed(from start: Date, to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        if seconds >= 3600 { return "\(seconds / 3600)h \(seconds % 3600 / 60)m \(seconds % 60)s" }
        if seconds >= 60 { return "\(seconds / 60)m \(seconds % 60)s" }
        return "\(seconds)s"
    }

    public static func startDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    /// Interim text was streamed before its boundary. Keep any later reply text intact.
    public static func removingUpdate(_ text: String, from partial: String) -> String {
        let value = partial.drop(while: { $0.isWhitespace })
        let update = text.drop(while: { $0.isWhitespace })
        guard value.hasPrefix(update) else { return partial }
        return String(value.dropFirst(update.count))
    }
}

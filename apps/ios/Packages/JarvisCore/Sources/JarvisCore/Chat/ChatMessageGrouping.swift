import Foundation

public enum ChatMessageGrouping {
    public static func showsTimestamp(
        role: ConversationRole,
        at: String,
        previousRole: ConversationRole?,
        previousAt: String?
    ) -> Bool {
        guard role == previousRole,
              let previousAt,
              let currentDate = date(from: at),
              let previousDate = date(from: previousAt) else {
            return true
        }
        return floor(currentDate.timeIntervalSince1970 / 60) != floor(previousDate.timeIntervalSince1970 / 60)
    }

    private static func date(from value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }
}

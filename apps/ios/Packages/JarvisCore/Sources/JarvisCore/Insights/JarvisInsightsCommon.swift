import Foundation

public enum JarvisInsightsError: Error, Equatable, Sendable {
    case invalidResponse
    case invalidRequest
}

/// Why a Usage, Status or Proactive read or write failed, reduced to what the screens can say.
public enum JarvisInsightsFailure: Equatable, Sendable {
    case signInRequired
    case notConfigured
    case unavailable
    case timedOut
    case offline
    case invalidResponse
    case conflict
    case failed

    public init(_ error: Error) {
        if let error = error as? JarvisClientError {
            switch error {
            case .signInRequired, .notOwner: self = .signInRequired
            case .invalidBaseURL, .tokenStoreFailure: self = .notConfigured
            case .timedOut: self = .timedOut
            case .networkFailure, .serviceUnavailable, .rateLimited: self = .offline
            case .responseDecodingFailure, .responseEncodingFailure: self = .invalidResponse
            case .httpStatus(404): self = .unavailable
            case .httpStatus(409): self = .conflict
            default: self = .failed
            }
        } else if error is JarvisInsightsError {
            self = .invalidResponse
        } else {
            self = .failed
        }
    }

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .signInRequired: .signInNeeded
        case .notConfigured: .notConfigured
        case .unavailable: .unavailable
        case .timedOut: .timedOut
        case .offline: .offline
        case .invalidResponse: .invalidResponse
        case .conflict, .failed: .loadFailed
        }
    }
}

/// Date helpers shared by the three pages. Dates are shown in Danish time, like the web app.
public enum JarvisInsightsDates {
    public static let timeZone = TimeZone(identifier: "Europe/Copenhagen") ?? TimeZone(secondsFromGMT: 0)!

    public static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.firstWeekday = 2
        calendar.minimumDaysInFirstWeek = 4
        return calendar
    }

    public static func parse(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }

    /// `yyyy-MM-dd` for the Danish calendar day containing the date.
    public static func dayKey(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    public static func date(fromDayKey key: String) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    public static func format(
        _ date: Date,
        language: JarvisAppLanguage,
        dateStyle: DateFormatter.Style = .none,
        timeStyle: DateFormatter.Style = .short
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.dateStyle = dateStyle
        formatter.timeStyle = timeStyle
        return formatter.string(from: date)
    }

    public static func template(_ date: Date, _ template: String, language: JarvisAppLanguage) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }

    /// "just now", "5 min ago", "3 h ago", "2 d ago".
    public static func elapsed(from date: Date, now: Date, language: JarvisAppLanguage) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(date) / 60))
        if minutes < 1 { return JarvisInsightsLocalization.string(.justNow, language: language) }
        if minutes < 60 { return JarvisInsightsLocalization.format(.minutesAgo, language: language, minutes) }
        if minutes < 1_440 { return JarvisInsightsLocalization.format(.hoursAgo, language: language, minutes / 60) }
        return JarvisInsightsLocalization.format(.daysAgo, language: language, minutes / 1_440)
    }
}

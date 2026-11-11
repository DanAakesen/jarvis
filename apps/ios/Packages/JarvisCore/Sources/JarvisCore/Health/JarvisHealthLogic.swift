import Foundation

public enum JarvisHealthPeriodPreset: String, CaseIterable, Identifiable, Sendable {
    case today
    case yesterday
    case sevenDays
    case fourteenDays
    case thirtyDays

    /// The published dashboard has exactly these four choices; yesterday remains a supported stored value.
    public static let dashboardPresets: [Self] = [.today, .sevenDays, .fourteenDays, .thirtyDays]
    public var id: String { rawValue }
    public var dayCount: Int {
        switch self {
        case .today, .yesterday: 1
        case .sevenDays: 7
        case .fourteenDays: 14
        case .thirtyDays: 30
        }
    }
}

public struct JarvisHealthPeriod: Equatable, Sendable {
    public let startDate: String
    public let endDate: String

    public init?(startDate: String, endDate: String) {
        guard Self.isDate(startDate), Self.isDate(endDate), startDate <= endDate else { return nil }
        self.startDate = startDate
        self.endDate = endDate
    }

    public var dayCount: Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let start = Self.parseDate(startDate),
              let end = Self.parseDate(endDate),
              let days = calendar.dateComponents([.day], from: start, to: end).day else {
            return 0
        }
        return days + 1
    }

    public static func make(
        _ preset: JarvisHealthPeriodPreset,
        now: Date = Date(),
        timeZone: TimeZone = TimeZone(identifier: "Europe/Copenhagen")!
    ) -> JarvisHealthPeriod {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let today = calendar.startOfDay(for: now)
        let end = preset == .yesterday
            ? calendar.date(byAdding: .day, value: -1, to: today)!
            : today
        let start = calendar.date(byAdding: .day, value: -(preset.dayCount - 1), to: end)!
        return JarvisHealthPeriod(
            startDate: dateString(start, calendar: calendar),
            endDate: dateString(end, calendar: calendar)
        )!
    }

    private static func isDate(_ value: String) -> Bool {
        parseDate(value) != nil
    }

    private static func parseDate(_ value: String) -> Date? {
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var components = DateComponents()
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        guard let date = calendar.date(from: components) else { return nil }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
        guard roundTrip.year == parts[0], roundTrip.month == parts[1], roundTrip.day == parts[2] else {
            return nil
        }
        return date
    }

    private static func dateString(_ date: Date, calendar: Calendar) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
    }
}

public enum JarvisHealthLogic {
    public static func ringProgress(value: Double?, target: Double?) -> Double? {
        guard let value, let target, value.isFinite, target.isFinite, value >= 0, target >= 0 else {
            return nil
        }
        guard target > 0 else { return value > 0 ? 1 : 0 }
        return min(max(value / target, 0), 1)
    }

    public static func scaledWeeklyTarget(_ target: Double?, days: Int) -> Double? {
        guard let target, target.isFinite, target >= 0, days > 0 else { return nil }
        return target * Double(days) / 7
    }

    public static func calorieBalance(eaten: Double?, restingKcal: Double?, deficitKcal: Double?) -> (amount: Double, isOver: Bool)? {
        guard let eaten, let restingKcal, let deficitKcal,
              eaten.isFinite, restingKcal.isFinite, deficitKcal.isFinite,
              eaten >= 0, restingKcal >= 0, deficitKcal >= 0 else {
            return nil
        }
        let difference = restingKcal - deficitKcal - eaten
        return (abs(difference), difference < 0)
    }

    public static func workoutKind(_ value: String?) -> WorkoutKind {
        // Older sync versions encoded the Objective-C enum's debug description instead of its activity name.
        let raw = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let numeric = raw.replacingOccurrences(of: #"^HKWorkoutActivityType\(rawValue: ([0-9]+)\)$"#,
                                               with: "$1", options: .regularExpression)
        if let code = UInt(numeric) {
            if [20, 50, 11, 59, 63].contains(code) { return .gym }
            if code == 37 { return .run }
        }
        let normalized = normalizedWorkoutType(value)
        if ["healthkit20", "healthkit50", "healthkit11", "healthkit59", "healthkit63"].contains(normalized) { return .gym }
        if normalized == "healthkit37" { return .run }
        if ["gym", "strengthtraining", "traditionalstrengthtraining", "functionalstrengthtraining",
            "highintensityintervaltraining", "hiit", "crosstraining", "coretraining"].contains(normalized) {
            return .gym
        }
        if ["run", "running"].contains(normalized) { return .run }
        return .other
    }

    public static func normalizedWorkoutType(_ value: String?) -> String {
        let raw = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let numeric = raw.replacingOccurrences(of: #"^HKWorkoutActivityType\(rawValue: ([0-9]+)\)$"#,
                                               with: "$1", options: [.regularExpression, .caseInsensitive])
        return numeric
            .replacingOccurrences(of: #"^HKWorkoutActivityType[._ -]*"#, with: "", options: [.regularExpression, .caseInsensitive])
            .filter { $0.isLetter || $0.isNumber }
            .lowercased()
            .replacingOccurrences(of: "strenght", with: "strength")
    }

    /// Date-only API fields are already local days. Timestamp fallbacks use the backend's Copenhagen day.
    public static func day(_ value: String?) -> String? {
        guard let value else { return nil }
        if value.count == 10, JarvisHealthPeriod(startDate: value, endDate: value) != nil { return value }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var instant = formatter.date(from: value)
        if instant == nil {
            formatter.formatOptions = [.withInternetDateTime]
            instant = formatter.date(from: value)
        }
        guard let instant else { return nil }
        return JarvisHealthPeriod.make(.today, now: instant).startDate
    }

    public static func bodyMetricName(_ value: String?, matching key: BodyMetric) -> Bool {
        guard let value else { return false }
        switch key {
        case .weight:
            return ["weight_body_mass", "body_mass", "weight"].contains(value.lowercased())
        case .fatPercent:
            return value.lowercased() == "body_fat_percentage"
        case .leanMass:
            return value.lowercased() == "lean_body_mass"
        }
    }

    public enum WorkoutKind: Equatable, Sendable {
        case gym
        case run
        case other
    }

    public enum BodyMetric: Sendable {
        case weight
        case fatPercent
        case leanMass
    }
}

/// Identifies the same HealthKit workout on the phone and in retained sync data.
/// A legacy manual gym log has no HealthKit id; it follows Home's two-hour gym-session match.
public struct JarvisHealthWorkoutIdentity: Sendable {
    public enum Source: Sendable { case healthKit, manual }
    public let source: Source
    public let id: String?
    public let start: Date
    public let kind: JarvisHealthLogic.WorkoutKind

    public init(id: String?, start: Date, kind: JarvisHealthLogic.WorkoutKind, source: Source = .healthKit) {
        self.source = source
        self.id = id; self.start = start; self.kind = kind
    }

    public func matches(_ other: Self) -> Bool {
        if source == other.source, let id, let otherID = other.id { return id.lowercased() == otherID.lowercased() }
        guard kind == other.kind else { return false }
        return abs(start.timeIntervalSince(other.start)) < (kind == .gym ? 7200 : 90)
    }
}

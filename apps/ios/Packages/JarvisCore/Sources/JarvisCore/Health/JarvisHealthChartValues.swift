import Foundation

public struct JarvisHealthChartDay: Equatable, Identifiable, Sendable {
    /// `yyyy-MM-dd`.
    public let date: String
    /// `nil` when nothing was recorded that day. Missing days are never filled in.
    public let value: Double?
    public var id: String { date }

    public init(date: String, value: Double?) {
        self.date = date
        self.value = value
    }
}

/// The numbers behind every Health chart: a headline (the average by default, or the tapped day) and the target.
public struct JarvisHealthChartValues: Equatable, Sendable {
    public let days: [JarvisHealthChartDay]
    public let target: Double?

    public init(days: [JarvisHealthChartDay], target: Double?) {
        self.days = days
        self.target = target
    }

    /// The last `count` days ending on `end`, oldest first, taking each value from `values` (keyed by `yyyy-MM-dd`).
    public init(values: [String: Double], endingOn end: String, count: Int, target: Double?) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        var days: [JarvisHealthChartDay] = []
        if let last = formatter.date(from: end), count > 0 {
            for offset in stride(from: count - 1, through: 0, by: -1) {
                guard let day = calendar.date(byAdding: .day, value: -offset, to: last) else { continue }
                let key = formatter.string(from: day)
                days.append(JarvisHealthChartDay(date: key, value: values[key]))
            }
        }
        self.init(days: days, target: target)
    }

    public var hasData: Bool { days.contains { $0.value != nil } }

    /// Mean over the days that have a value.
    public var average: Double? {
        let recorded = days.compactMap(\.value)
        guard !recorded.isEmpty else { return nil }
        return recorded.reduce(0, +) / Double(recorded.count)
    }

    /// The tapped day when it is part of the chart, otherwise the average.
    public func headline(selected: String?) -> Double? {
        guard let selected, let day = days.first(where: { $0.date == selected }) else { return average }
        return day.value
    }

    public func isShowingAverage(selected: String?) -> Bool {
        guard let selected else { return true }
        return !days.contains { $0.date == selected }
    }

    /// Tapping the selected bar again returns to the average.
    public static func toggled(selected: String?, tapped: String) -> String? {
        selected == tapped ? nil : tapped
    }
}

/// Goals shown as target chips and dashed target lines. Stored on the device; protein falls back to the server target.
public struct JarvisHealthGoals: Equatable, Sendable {
    public var sleepHours: Double
    public var kcal: Double
    public var proteinGrams: Double
    public var carbsGrams: Double
    public var fatGrams: Double

    public static let defaults = JarvisHealthGoals(
        sleepHours: 8, kcal: 2_200, proteinGrams: 130, carbsGrams: 250, fatGrams: 70
    )

    public enum Key: String, CaseIterable, Sendable {
        case sleepHours = "jarvis.health.goal.sleepHours"
        case kcal = "jarvis.health.goal.kcal"
        case proteinGrams = "jarvis.health.goal.proteinGrams"
        case carbsGrams = "jarvis.health.goal.carbsGrams"
        case fatGrams = "jarvis.health.goal.fatGrams"
    }

    public static func load(from store: UserDefaults = .standard) -> JarvisHealthGoals {
        func read(_ key: Key, _ fallback: Double) -> Double {
            guard store.object(forKey: key.rawValue) != nil else { return fallback }
            let value = store.double(forKey: key.rawValue)
            return value > 0 ? value : fallback
        }
        let base = defaults
        return JarvisHealthGoals(
            sleepHours: read(.sleepHours, base.sleepHours),
            kcal: read(.kcal, base.kcal),
            proteinGrams: read(.proteinGrams, base.proteinGrams),
            carbsGrams: read(.carbsGrams, base.carbsGrams),
            fatGrams: read(.fatGrams, base.fatGrams)
        )
    }

    public func save(to store: UserDefaults = .standard) {
        store.set(sleepHours, forKey: Key.sleepHours.rawValue)
        store.set(kcal, forKey: Key.kcal.rawValue)
        store.set(proteinGrams, forKey: Key.proteinGrams.rawValue)
        store.set(carbsGrams, forKey: Key.carbsGrams.rawValue)
        store.set(fatGrams, forKey: Key.fatGrams.rawValue)
    }
}

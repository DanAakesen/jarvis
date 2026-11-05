import Foundation

/// One night of sleep in hours. Stages the source did not record stay `nil`.
public struct JarvisHealthSleepNight: Equatable, Sendable {
    public let date: String
    public let total: Double?
    public let deep: Double?
    public let rem: Double?
    public let light: Double?
    public let awake: Double?

    public static func nights(from items: [[String: JSONValue]]) -> [String: JarvisHealthSleepNight] {
        var result: [String: JarvisHealthSleepNight] = [:]
        for row in items {
            guard let date = row["sleep_date"]?.dayString else { continue }
            let total = (row["total_sleep_hours"]?.number ?? row["asleep_hours"]?.number).flatMap { $0 > 0 ? $0 : nil }
            let night = JarvisHealthSleepNight(
                date: date,
                total: total,
                deep: row["deep_hours"]?.number,
                rem: row["rem_hours"]?.number,
                light: row["light_hours"]?.number ?? row["core_hours"]?.number,
                awake: row["awake_hours"]?.number
            )
            if let existing = result[date], (existing.total ?? 0) >= (night.total ?? 0) { continue }
            result[date] = night
        }
        return result
    }
}

public enum JarvisHealthNutrient: String, Sendable {
    case kcal = "energy_kcal"
    case protein = "protein_grams"
    case carbs = "carbohydrates_grams"
    case fat = "fat_grams"
}

public enum JarvisHealthNutritionDays {
    /// Per-day values of one nutrient for days with at least one logged meal, keyed by `yyyy-MM-dd`.
    public static func values(from items: [[String: JSONValue]], nutrient: JarvisHealthNutrient) -> [String: Double] {
        var result: [String: Double] = [:]
        for row in items {
            guard let date = row["meal_date"]?.dayString,
                  (row["meal_count"]?.number ?? 0) > 0,
                  let value = row[nutrient.rawValue]?.number else { continue }
            result[date] = value
        }
        return result
    }
}

/// Averages only recorded nights inside the selected period. A missing stage
/// stays unknown instead of treating an unrecorded stage as zero hours.
public struct JarvisHealthSleepSummary: Equatable, Sendable {
    public let nightCount: Int
    public let latestDate: String?
    public let total: Double?
    public let deep: Double?
    public let rem: Double?
    public let light: Double?
    public let awake: Double?

    public init(items: [[String: JSONValue]], period: JarvisHealthPeriod) {
        let nights = JarvisHealthSleepNight.nights(from: items).values.filter {
            $0.date >= period.startDate && $0.date <= period.endDate &&
                $0.total.map { $0.isFinite && $0 > 0 } == true
        }
        nightCount = nights.count
        latestDate = nights.map(\.date).max()
        func average(_ field: KeyPath<JarvisHealthSleepNight, Double?>) -> Double? {
            let values = nights.compactMap { $0[keyPath: field] }.filter { $0.isFinite && $0 >= 0 }
            guard !values.isEmpty, values.count == nights.count else { return nil }
            return values.reduce(0, +) / Double(values.count)
        }
        total = average(\.total)
        deep = average(\.deep)
        rem = average(\.rem)
        light = average(\.light)
        awake = average(\.awake)
    }
}

/// Daily means for the selected period, based on days with logged meals.
/// Missing nutrient values remain unknown; unlogged days are never zero-filled.
public struct JarvisHealthNutritionSummary: Equatable, Sendable {
    public let dayCount: Int
    public let mealCount: Int
    private let averages: [JarvisHealthNutrient: Double]

    public init(items: [[String: JSONValue]], period: JarvisHealthPeriod) {
        let rows = items.filter {
            guard let day = $0["meal_date"]?.dayString else { return false }
            return day >= period.startDate && day <= period.endDate && ($0["meal_count"]?.number ?? 0) > 0
        }
        let counts = rows.reduce(into: [String: Int]()) { result, row in
            guard let day = row["meal_date"]?.dayString,
                  let count = row["meal_count"]?.number.flatMap({ Int(exactly: $0) }) else { return }
            result[day] = count
        }
        dayCount = counts.count
        mealCount = counts.values.reduce(0, +)
        var means: [JarvisHealthNutrient: Double] = [:]
        for nutrient in [JarvisHealthNutrient.kcal, .protein, .carbs, .fat] {
            let values = JarvisHealthNutritionDays.values(from: rows, nutrient: nutrient).values
                .filter { $0.isFinite && $0 >= 0 }
            if !values.isEmpty, values.count == counts.count {
                means[nutrient] = values.reduce(0, +) / Double(values.count)
            }
        }
        averages = means
    }

    public func average(_ nutrient: JarvisHealthNutrient) -> Double? { averages[nutrient] }
}

private extension JSONValue {
    var number: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    var dayString: String? {
        if case .string(let value) = self, value.count >= 10 { return String(value.prefix(10)) }
        return nil
    }
}

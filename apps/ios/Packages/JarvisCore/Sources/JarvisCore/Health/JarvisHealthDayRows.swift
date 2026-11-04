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

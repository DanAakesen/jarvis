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

/// A single recording source supplies both the chart and the totals. Overlapping samples
/// from that source occupy each instant at most once.
public struct JarvisSleepTimeline: Sendable {
    public let segments: [JarvisHealthSleepSegment]
    public private(set) var asleepHours: Double

    public init(segments samples: [JarvisHealthSleepSegment]) {
        let ordered = samples.filter { $0.end > $0.start }.sorted {
            ($0.start, $0.end, $0.id) < ($1.start, $1.end, $1.id)
        }
        // HealthKit can provide a whole-night "asleep" envelope as well as detailed stages.
        // Give the stages precedence and use only the uncovered parts of the envelope.
        var staged: [JarvisHealthSleepSegment] = []
        for sample in ordered where ["awake", "rem", "core", "deep"].contains(sample.stage) {
            let start = max(staged.last?.end ?? sample.start, sample.start)
            if start < sample.end { staged.append(Self.part(sample, start, sample.end)) }
        }
        var unclassified: [JarvisHealthSleepSegment] = []
        var previousEnd = Date.distantPast
        for sample in ordered where sample.stage == "asleep" {
            var cursor = max(previousEnd, sample.start)
            for stage in staged where stage.end > cursor && stage.start < sample.end {
                if cursor < stage.start { unclassified.append(Self.part(sample, cursor, stage.start)) }
                cursor = max(cursor, stage.end)
            }
            if cursor < sample.end { unclassified.append(Self.part(sample, cursor, sample.end)) }
            previousEnd = max(previousEnd, sample.end)
        }
        segments = (staged + unclassified).sorted { $0.start < $1.start }
        asleepHours = segments.filter { $0.stage != "awake" }.reduce(0) { $0 + $1.end.timeIntervalSince($1.start) / 3600 }
    }

    private static func part(_ sample: JarvisHealthSleepSegment, _ start: Date, _ end: Date) -> JarvisHealthSleepSegment {
        .init(id: sample.id, stage: sample.stage, start: start, end: end, source: sample.source)
    }

    public var stagedHours: Double {
        segments.filter { ["deep", "rem", "core"].contains($0.stage) }
            .reduce(0) { $0 + $1.end.timeIntervalSince($1.start) / 3600 }
    }

    /// Separate daytime naps from a night's recording. Competing devices may cover
    /// the same night. Keep the longest sleep total and the most detailed overlapping recording.
    public static func overnight(_ samples: [JarvisHealthSleepSegment], wakingOn date: Date, calendar: Calendar) -> Self {
        var candidates: [Self] = []
        let sources = Dictionary(grouping: samples) { $0.source ?? "" }
        for source in sources.keys.sorted() {
            let ordered = Self(segments: sources[source] ?? []).segments
            var sessions: [[JarvisHealthSleepSegment]] = []
            for sample in ordered {
                if let end = sessions.last?.last?.end, sample.start.timeIntervalSince(end) <= 2 * 3600 {
                    sessions[sessions.count - 1].append(sample)
                } else { sessions.append([sample]) }
            }
            for session in sessions {
                guard let end = session.last?.end, calendar.isDate(end, inSameDayAs: date) else { continue }
                candidates.append(Self(segments: session))
            }
        }
        guard let longest = candidates.max(by: { $0.asleepHours < $1.asleepHours }),
              longest.asleepHours > 0, let start = longest.segments.first?.start,
              let end = longest.segments.last?.end else { return Self(segments: []) }
        let overlapping = candidates.filter { candidate in
            guard let first = candidate.segments.first, let last = candidate.segments.last else { return false }
            return first.start < end && last.end > start
        }
        var detailed = overlapping.max { ($0.stagedHours, $0.asleepHours) < ($1.stagedHours, $1.asleepHours) } ?? longest
        detailed.asleepHours = longest.asleepHours
        return detailed
    }

    public func dailyRow(date: String, retained: JarvisHealthSleepNight? = nil) -> [String: JSONValue]? {
        var hours: [String: Double] = [:]
        for segment in segments {
            hours[segment.stage, default: 0] += segment.end.timeIntervalSince(segment.start) / 3600
        }
        guard asleepHours > 0 else { return nil }
        var row: [String: JSONValue] = ["sleep_date": .string(date), "total_sleep_hours": .number(max(asleepHours, retained?.total ?? 0))]
        if stagedHours == 0, let retained {
            for (stage, value) in [("deep", retained.deep), ("rem", retained.rem), ("core", retained.light), ("awake", retained.awake)] {
                if let value { row[stage + "_hours"] = .number(value) }
            }
        }
        for (stage, value) in hours { row[stage + "_hours"] = .number(value) }
        return row
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

/// Local merged step totals replace only the Copenhagen days the phone actually read.
public enum JarvisHealthStepDays {
    public static func merging(retained: [[String: JSONValue]], local: [Date: Int]) -> [[String: JSONValue]] {
        var byDay: [String: [String: JSONValue]] = [:]
        for row in retained {
            guard case .string(let raw)? = row["metric_date"],
                  let day = JarvisHealthLogic.day(raw) else { continue }
            byDay[day] = row
        }
        for (date, value) in local where value >= 0 {
            let day = JarvisHealthPeriod.make(.today, now: date).startDate
            byDay[day] = ["metric_date": .string(day), "unit": .string("count"), "value": .number(Double(value))]
        }
        return byDay.keys.sorted().compactMap { byDay[$0] }
    }
}

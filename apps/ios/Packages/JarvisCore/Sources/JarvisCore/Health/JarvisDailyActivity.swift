import Foundation

public enum JarvisActivityAvailability: String, Codable, Equatable, Sendable {
    case available, partial, stale, unavailable
}

public struct JarvisDailyActivityDay: Codable, Equatable, Sendable {
    public let activeKilocalories: Double?
    public let exerciseMinutes: Double?
    public let observedAt: Date
    public let isStale: Bool
    public let isPartial: Bool

    public init(activeKilocalories: Double?, exerciseMinutes: Double?, observedAt: Date, isStale: Bool = false, isPartial: Bool = false) {
        self.activeKilocalories = Self.valid(activeKilocalories)
        self.exerciseMinutes = Self.valid(exerciseMinutes)
        self.observedAt = observedAt
        self.isStale = isStale
        self.isPartial = isPartial
    }
    private static func valid(_ value: Double?) -> Double? {
        value.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
    }
}

public struct JarvisActivityTotal: Equatable, Sendable {
    public let value: Double?
    public let availability: JarvisActivityAvailability
    public let observedDays: Int
    public let expectedDays: Int
}

public struct JarvisDailyActivitySnapshot: Codable, Equatable, Sendable {
    public var days: [String: JarvisDailyActivityDay]
    public let fetchedAt: Date
    public init(days: [String: JarvisDailyActivityDay], fetchedAt: Date) {
        self.days = days
        self.fetchedAt = fetchedAt
    }

    /// A local merged day replaces the same server day. Values are never added across sources.
    /// Missing local quantities do not establish zero; retained server quantities remain explicitly stale.
    public func merging(local: Self) -> Self {
        var merged = days.mapValues {
            JarvisDailyActivityDay(activeKilocalories: $0.activeKilocalories,
                exerciseMinutes: $0.exerciseMinutes, observedAt: $0.observedAt, isStale: true, isPartial: $0.isPartial)
        }
        for (day, value) in local.days {
            let prior = merged[day]
            merged[day] = JarvisDailyActivityDay(
                activeKilocalories: value.activeKilocalories ?? prior?.activeKilocalories,
                exerciseMinutes: value.exerciseMinutes ?? prior?.exerciseMinutes,
                observedAt: value.observedAt,
                isStale: value.isStale || (value.activeKilocalories == nil && prior?.activeKilocalories != nil)
                    || (value.exerciseMinutes == nil && prior?.exerciseMinutes != nil),
                isPartial: value.isPartial || ((value.activeKilocalories == nil || value.exerciseMinutes == nil) && prior?.isPartial == true)
            )
        }
        return Self(days: merged, fetchedAt: local.fetchedAt)
    }

    public func total(
        _ metric: KeyPath<JarvisDailyActivityDay, Double?>,
        period: JarvisHealthPeriod,
        now: Date,
        stale: Bool = false
    ) -> JarvisActivityTotal {
        let rows = days.filter { $0.key >= period.startDate && $0.key <= period.endDate }
        let measured = rows.compactMap { key, day -> (String, Double, Bool, Bool)? in
            guard let value = day[keyPath: metric] else { return nil }
            return (key, value, day.isStale, day.isPartial)
        }
        let old = stale || now.timeIntervalSince(fetchedAt) > 15 * 60 || fetchedAt > now.addingTimeInterval(60)
        let state: JarvisActivityAvailability = measured.isEmpty ? .unavailable
            : old || measured.contains(where: { $0.2 }) ? .stale
            : measured.count < period.dayCount || measured.contains(where: { $0.3 }) ? .partial : .available
        return JarvisActivityTotal(value: measured.isEmpty ? nil : measured.reduce(0) { $0 + $1.1 },
            availability: state, observedDays: measured.count, expectedDays: period.dayCount)
    }

    /// Only the explicit merged-daily provenance can establish all-day activity.
    /// Legacy raw-sample sums cannot safely resolve overlapping iPhone/Watch sources.
    public static func server(rows: [[String: JSONValue]], fetchedAt: Date) -> Self {
        func string(_ value: JSONValue?) -> String? {
            guard case .string(let text)? = value else { return nil }; return text
        }
        func number(_ value: JSONValue?) -> Double? {
            guard case .number(let number)? = value else { return nil }; return number
        }
        func instant(_ value: String?) -> Date? {
            guard let value else { return nil }
            let parser = ISO8601DateFormatter()
            parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = parser.date(from: value) { return date }
            parser.formatOptions = [.withInternetDateTime]
            return parser.date(from: value)
        }
        var energy: [String: (Double, Date, Int)] = [:]
        var exercise: [String: (Double, Date, Int)] = [:]
        var partialDays = Set<String>()
        for row in rows {
            guard case .object(let fields)? = row["fields"], fields["mergedDailyTotal"] == .bool(true),
                  let day = JarvisHealthLogic.day(string(row["metric_date"])),
                  let value = number(row["value"]), value.isFinite, value >= 0,
                  let metric = string(row["metric_name"]) else { continue }
            let observed = instant(string(row["updated_at"])) ?? fetchedAt
            if let end = instant(string(row["end_at"])),
               day != JarvisHealthPeriod.make(.today, now: fetchedAt).startDate,
               JarvisHealthPeriod.make(.today, now: end).startDate == day { partialDays.insert(day) }
            if ["active_energy_burned", "active_energy"].contains(metric), string(row["unit"]) == "kcal" {
                let rank = metric == "active_energy_burned" ? 2 : 1
                if energy[day] == nil || rank > energy[day]!.2 || (rank == energy[day]!.2 && observed >= energy[day]!.1) {
                    energy[day] = (value, observed, rank)
                }
            } else if ["apple_exercise_time", "exercise_time"].contains(metric), string(row["unit"]) == "min" {
                let rank = metric == "apple_exercise_time" ? 2 : 1
                if exercise[day] == nil || rank > exercise[day]!.2 || (rank == exercise[day]!.2 && observed >= exercise[day]!.1) {
                    exercise[day] = (value, observed, rank)
                }
            }
        }
        let keys = Set(energy.keys).union(exercise.keys)
        return Self(days: Dictionary(uniqueKeysWithValues: keys.map { day in
            (day, JarvisDailyActivityDay(activeKilocalories: energy[day]?.0,
                exerciseMinutes: exercise[day]?.0, observedAt: min(energy[day]?.1 ?? .distantFuture,
                    exercise[day]?.1 ?? .distantFuture),
                isStale: day == JarvisHealthPeriod.make(.today, now: fetchedAt).startDate
                    && [energy[day]?.1, exercise[day]?.1].compactMap { $0 }.contains {
                        fetchedAt.timeIntervalSince($0) > 15 * 60 || $0 > fetchedAt.addingTimeInterval(60)
                    },
                isPartial: partialDays.contains(day)))
        }), fetchedAt: fetchedAt)
    }
}

public protocol JarvisDailyActivitySource: Sendable {
    func activity(now: Date, days: Int) async throws -> JarvisDailyActivitySnapshot
}

public struct JarvisUnavailableDailyActivitySource: JarvisDailyActivitySource {
    public init() {}
    public func activity(now: Date, days: Int) async throws -> JarvisDailyActivitySnapshot {
        throw JarvisTodayDataError.unavailable
    }
}

// Reuses the existing authenticated Health query contract. These are alternative day totals, never additions.
extension JarvisHealthClient {
    public func dailyActivity(now: Date, days: Int = 30) async throws -> JarvisDailyActivitySnapshot {
        let calendar = JarvisHealthSyncWindow.calendar
        let start = calendar.date(byAdding: .day, value: -(max(1, min(days, 30)) - 1), to: now) ?? now
        let period = JarvisHealthPeriod(
            startDate: JarvisHealthPeriod.make(.today, now: start).startDate,
            endDate: JarvisHealthPeriod.make(.today, now: now).endDate
        )!
        async let energy = try? queryAll(JarvisHealthQuery(
            source: .metrics, period: period, metric: "active_energy_burned", limit: 100
        ))
        async let exercise = try? queryAll(JarvisHealthQuery(
            source: .metrics, period: period, metric: "apple_exercise_time", limit: 100
        ))
        let (energyResult, exerciseResult) = await (energy, exercise)
        guard energyResult != nil || exerciseResult != nil else { throw JarvisTodayDataError.failed }
        return .server(rows: (energyResult?.items ?? []) + (exerciseResult?.items ?? []), fetchedAt: now)
    }
}

import Foundation
import HealthKit
import JarvisCore

/// The same merged Apple Health day totals feed Home, Health and server sync.
/// HealthKit resolves overlapping Watch/iPhone sources; absent quantities remain absent.
struct JarvisHealthKitActivitySource: JarvisDailyActivitySource {
    func activity(now: Date, days: Int) async throws -> JarvisDailyActivitySnapshot {
        let store = HKHealthStore()
        try await JarvisHealthKitAccess.requestReadAccess(store)
        let start = JarvisHealthSyncWindow.recentStart(now: now, days: days)
        async let energy = try? Self.dailySamples(store: store, identifier: .activeEnergyBurned,
            metric: "active_energy_burned", unit: .kilocalorie(), unitName: "kcal", from: start, to: now)
        async let exercise = try? Self.dailySamples(store: store, identifier: .appleExerciseTime,
            metric: "apple_exercise_time", unit: .minute(), unitName: "min", from: start, to: now)
        let (energyDays, exerciseDays) = await (energy, exercise)
        guard energyDays != nil || exerciseDays != nil else { throw JarvisTodayDataError.failed }
        var values: [String: JarvisDailyActivityDay] = [:]
        for sample in energyDays ?? [] {
            let day = JarvisHealthPeriod.make(.today, now: sample.start).startDate
            values[day] = JarvisDailyActivityDay(activeKilocalories: sample.value,
                exerciseMinutes: nil, observedAt: now)
        }
        for sample in exerciseDays ?? [] {
            let day = JarvisHealthPeriod.make(.today, now: sample.start).startDate
            values[day] = JarvisDailyActivityDay(activeKilocalories: values[day]?.activeKilocalories,
                exerciseMinutes: sample.value, observedAt: now)
        }
        return JarvisDailyActivitySnapshot(days: values, fetchedAt: now)
    }

    static func dailySamples(
        store: HKHealthStore, identifier: HKQuantityTypeIdentifier,
        metric: String, unit: HKUnit, unitName: String, from start: Date, to end: Date
    ) async throws -> [JarvisHealthSample] {
        try Task.checkCancellation()
        return try await withCheckedThrowingContinuation { continuation in
            let calendar = JarvisHealthSyncWindow.calendar
            let query = HKStatisticsCollectionQuery(
                quantityType: HKQuantityType(identifier),
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end, options: []),
                options: .cumulativeSum, anchorDate: calendar.startOfDay(for: start),
                intervalComponents: DateComponents(calendar: calendar, timeZone: calendar.timeZone, day: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                if let error { continuation.resume(throwing: error); return }
                guard let collection else {
                    continuation.resume(throwing: JarvisTodayDataError.failed); return
                }
                var result: [JarvisHealthSample] = []
                collection.enumerateStatistics(from: start, to: end) { statistic, _ in
                    guard statistic.startDate < end, let quantity = statistic.sumQuantity() else { return }
                    let value = quantity.doubleValue(for: unit)
                    guard value.isFinite, value >= 0 else { return }
                    result.append(JarvisHealthSample(
                        id: "\(metric)-\(Int(statistic.startDate.timeIntervalSince1970))",
                        metric: metric, unit: unitName, start: statistic.startDate,
                        end: min(statistic.endDate, end), value: value,
                        source: "Apple Health merged statistics", aggregation: .dailyTotal
                    ))
                }
                continuation.resume(returning: result)
            }
            store.execute(query)
        }
    }
}

import HealthKit
import JarvisCore

/// Today's steps from HealthKit, where the owner has allowed it. Read-only: nothing is written or uploaded.
/// The first request asks for every readable Health type (`JarvisHealthKitAccess`).
struct JarvisHealthKitStepsSource: JarvisTodayStepsSource {
    func steps(now: Date, days: Int) async throws -> JarvisStepsSnapshot {
        guard let type = HKObjectType.quantityType(forIdentifier: .stepCount) else {
            throw JarvisTodayDataError.unavailable
        }
        let store = HKHealthStore()
        try await JarvisHealthKitAccess.requestReadAccess(store)
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        let start = calendar.date(byAdding: .day, value: -(max(days, 1) - 1), to: today) ?? today
        let hourly = try await collect(
            store: store, type: type, anchor: today, from: today,
            to: now, interval: DateComponents(hour: 1)
        )
        let daily = try await collect(
            store: store, type: type, anchor: today, from: start,
            to: now, interval: DateComponents(day: 1)
        )
        var hours = [Int](repeating: 0, count: 24)
        for (date, value) in hourly {
            let hour = calendar.component(.hour, from: date)
            if hours.indices.contains(hour) { hours[hour] = value }
        }
        var perDay: [Date: Int] = [:]
        for (date, value) in daily { perDay[calendar.startOfDay(for: date)] = value }
        return JarvisStepsSnapshot(hourly: hours, daily: perDay)
    }

    private func collect(
        store: HKHealthStore,
        type: HKQuantityType,
        anchor: Date,
        from start: Date,
        to end: Date,
        interval: DateComponents
    ) async throws -> [(Date, Int)] {
        try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum,
                anchorDate: anchor,
                intervalComponents: interval
            )
            query.initialResultsHandler = { _, collection, error in
                if error != nil {
                    continuation.resume(throwing: JarvisTodayDataError.failed)
                    return
                }
                var values: [(Date, Int)] = []
                collection?.enumerateStatistics(from: start, to: end) { statistics, _ in
                    let count = statistics.sumQuantity()?.doubleValue(for: .count()) ?? 0
                    values.append((statistics.startDate, Int(count.rounded())))
                }
                continuation.resume(returning: values)
            }
            store.execute(query)
        }
    }
}

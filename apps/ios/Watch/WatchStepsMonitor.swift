import HealthKit
import JarvisCore

/// Reads today's steps from this Watch's HealthKit and hands them to `WatchConnection`, which saves them for the
/// complication and reloads it. HealthKit background delivery wakes the app when new steps arrive; the 15-minute
/// background refresh and the foreground loop cover the gaps. Read-only: nothing is written to Health.
@MainActor
final class WatchStepsMonitor {
    static let shared = WatchStepsMonitor()
    private let store = HKHealthStore()
    private let type = HKQuantityType.quantityType(forIdentifier: .stepCount)
    private var observer: HKObserverQuery?
    private var inFlight: Task<Void, Never>?

    private var enabled: Bool {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") { return false }
        #endif
        return type != nil && HKHealthStore.isHealthDataAvailable()
    }

    /// Call on every launch, including background launches: an observer query lives only as long as the process.
    func start() {
        guard enabled, observer == nil, let type else { return }
        let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, error in
            Task { @MainActor in
                if error == nil { await self?.refresh() }
                completion()
            }
        }
        store.execute(query)
        observer = query
        // The system may coalesce stepCount deliveries to hourly; the periodic refreshes fill the gaps.
        store.enableBackgroundDelivery(for: type, frequency: .hourly) { _, _ in }
    }

    /// The prompt can only appear in the foreground, so background launches never ask.
    func requestAccessIfNeeded() async {
        guard enabled, let type else { return }
        let status = try? await store.statusForAuthorizationRequest(toShare: [], read: [type])
        guard status == .shouldRequest else { return }
        try? await store.requestAuthorization(toShare: [], read: [type])
    }

    func refresh() async {
        if let inFlight { return await inFlight.value }
        let task = Task { await read() }
        inFlight = task
        await task.value
        inFlight = nil
    }

    private func read() async {
        guard enabled, let type else { return }
        // Zero before the user has been asked would be a made-up number, not a measurement.
        if let status = try? await store.statusForAuthorizationRequest(toShare: [], read: [type]),
           status == .shouldRequest { return }
        let now = Date()
        let start = Calendar.current.startOfDay(for: now)
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: now)),
            options: .cumulativeSum, anchorDate: start, intervalComponents: DateComponents(hour: 1))
        // A locked Watch or a transient database error keeps the last value; the complication shows its age.
        guard let collection = try? await descriptor.result(for: store) else { return }
        var hourly: [Int] = []
        collection.enumerateStatistics(from: start, to: now) { statistics, _ in
            hourly.append(Int((statistics.sumQuantity()?.doubleValue(for: .count()) ?? 0).rounded()))
        }
        WatchConnection.shared.applyStepsReading(.init(measuredAt: now, hourly: hourly))
    }
}

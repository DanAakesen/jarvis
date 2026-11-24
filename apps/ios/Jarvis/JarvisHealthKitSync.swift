import HealthKit
import JarvisCore
import SwiftUI

/// Reads permitted HealthKit data since the sync anchor (a week on the first sync) into one batch. Read-only.
/// iOS never says which read types the user denied, so a type that fails to read is reported as unread,
/// and the batch is only ever called complete when every query succeeded.
struct JarvisHealthKitReader {
    private typealias Quantity = (HKQuantityTypeIdentifier, String, HKUnit, String)
    private static let scaleQuantities: [Quantity] = [
        (.bodyMass, "body_mass", .gramUnit(with: .kilo), "kg"),
        (.bodyFatPercentage, "body_fat_percentage", .percent(), "fraction"),
        (.leanBodyMass, "lean_body_mass", .gramUnit(with: .kilo), "kg"),
    ]
    private static let quantities: [Quantity] = [
        (.distanceWalkingRunning, "walking_running_distance", .meterUnit(with: .kilo), "km"),
        (.distanceCycling, "cycling_distance", .meterUnit(with: .kilo), "km"),
        (.flightsClimbed, "flights_climbed", .count(), "count"),
        (.basalEnergyBurned, "basal_energy_burned", .kilocalorie(), "kcal"),
        (.heartRate, "heart_rate", HKUnit.count().unitDivided(by: .minute()), "count/min"),
        (.restingHeartRate, "resting_heart_rate", HKUnit.count().unitDivided(by: .minute()), "count/min"),
        (.heartRateVariabilitySDNN, "heart_rate_variability", .secondUnit(with: .milli), "ms"),
        (.oxygenSaturation, "blood_oxygen_saturation", .percent(), "%"),
        (.respiratoryRate, "respiratory_rate", HKUnit.count().unitDivided(by: .minute()), "count/min"),
        (.vo2Max, "vo2_max", HKUnit(from: "ml/kg*min"), "ml/(kg·min)"),
        (.bodyMassIndex, "body_mass_index", .count(), "count"),
        (.height, "height", .meterUnit(with: .centi), "cm"),
        (.waistCircumference, "waist_circumference", .meterUnit(with: .centi), "cm"),
        (.dietaryEnergyConsumed, "dietary_energy", .kilocalorie(), "kcal"),
        (.dietaryProtein, "protein", .gram(), "g"),
        (.dietaryCarbohydrates, "carbohydrates", .gram(), "g"),
        (.dietaryFatTotal, "total_fat", .gram(), "g"),
        (.dietaryWater, "dietary_water", .literUnit(with: .milli), "mL"),
    ]

    func read(anchor: Date?, now: Date = Date()) async throws -> JarvisHealthSyncBatch {
        let store = HKHealthStore()
        try await JarvisHealthKitAccess.requestReadAccess(store)
        let start = JarvisHealthSyncWindow.start(anchor: anchor, now: now)
        let window = HKQuery.predicateForSamples(withStart: start, end: now, options: [])
        var samples: [JarvisHealthSample] = []
        var read: [String] = []
        var unread: [String] = []
        // Re-read the visible 30-day range: late Watch uploads and corrected totals must replace old days.
        let recentStart = JarvisHealthSyncWindow.recentStart(now: now)
        do {
            samples += try await dailySteps(store: store, from: recentStart, to: now)
            read.append("step_count")
        } catch {
            unread.append("step_count")
        }

        for (identifier, name, unit, label) in [
            (HKQuantityTypeIdentifier.activeEnergyBurned, "active_energy_burned", HKUnit.kilocalorie(), "kcal"),
            (.appleExerciseTime, "apple_exercise_time", .minute(), "min"),
        ] {
            do {
                samples += try await JarvisHealthKitActivitySource.dailySamples(store: store,
                    identifier: identifier, metric: name, unit: unit, unitName: label, from: recentStart, to: now)
                read.append(name)
            } catch { unread.append(name) }
        }

        for quantity in Self.quantities + Self.scaleQuantities {
            let (identifier, name, _, _) = quantity
            do {
                let isBody = Self.scaleQuantities.contains { $0.0 == identifier }
                let quantityWindow = isBody
                    ? HKQuery.predicateForSamples(withStart: recentStart, end: now, options: []) : window
                samples += try await readQuantity(quantity, store: store, window: quantityWindow)
                read.append(name)
            } catch {
                unread.append(name)
            }
        }

        var sleep: [JarvisHealthSleepSegment] = []
        if let type = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
            do {
                let results = try await readSamples(store: store, predicate: .categorySample(type: type, predicate: window))
                sleep = results.map {
                    JarvisHealthSleepSegment(
                        id: $0.uuid.uuidString, stage: Self.stage($0.value), start: $0.startDate, end: $0.endDate,
                        source: $0.sourceRevision.source.name
                    )
                }
                read.append("sleep_analysis")
            } catch { unread.append("sleep_analysis") }
        }

        var workouts: [JarvisHealthWorkoutSample] = []
        do {
            let workoutWindow = HKQuery.predicateForSamples(withStart: recentStart, end: now, options: .strictStartDate)
            let results = try await readSamples(store: store, predicate: .workout(workoutWindow))
            workouts = results.map {
                JarvisHealthWorkoutSample(
                    id: $0.uuid.uuidString, activity: Self.activityName($0.workoutActivityType),
                    start: $0.startDate, end: $0.endDate,
                    activeEnergyKcal: $0.statistics(for: HKQuantityType(.activeEnergyBurned))?
                        .sumQuantity()?.doubleValue(for: .kilocalorie()),
                    distanceMetres: $0.statistics(for: HKQuantityType(.distanceWalkingRunning))?
                        .sumQuantity()?.doubleValue(for: .meter())
                )
            }
            read.append("workout")
        } catch { unread.append("workout") }

        return JarvisHealthSyncBatch(
            samples: samples, sleep: sleep, workouts: workouts, readTypes: read,
            deniedOrUnreadTypes: unread, windowStart: min(start, recentStart), windowEnd: now
        )
    }

    /// An ordinary Health visit reads only already-permitted scale samples for this Copenhagen day.
    /// Reading the full day preserves the server's per-day replacement and latest-measurement rules.
    func todaysScaleSamples(now: Date = Date()) async throws -> [JarvisHealthSample] {
        guard HKHealthStore.isHealthDataAvailable() else { return [] }
        let store = HKHealthStore()
        let window = HKQuery.predicateForSamples(withStart: JarvisHealthSyncWindow.calendar.startOfDay(for: now),
                                                 end: now, options: .strictStartDate)
        var samples: [JarvisHealthSample] = []
        for quantity in Self.scaleQuantities {
            do {
                samples += try await readQuantity(quantity, store: store, window: window)
            } catch let error as HKError where error.code == .errorAuthorizationNotDetermined || error.code == .errorAuthorizationDenied {
                continue
            }
        }
        return samples
    }

    private func readQuantity(_ quantity: Quantity, store: HKHealthStore, window: NSPredicate) async throws -> [JarvisHealthSample] {
        let (identifier, name, unit, label) = quantity
        let results = try await readSamples(store: store, predicate: .quantitySample(type: HKQuantityType(identifier), predicate: window))
        return results.map {
            JarvisHealthSample(id: $0.uuid.uuidString, metric: name, unit: label, start: $0.startDate, end: $0.endDate,
                               value: $0.quantity.doubleValue(for: unit), source: $0.sourceRevision.source.name)
        }
    }

    /// Resume each bounded query with HealthKit's cursor, including deletion-only pages.
    /// The server receives complete Copenhagen days, never an arbitrary page of a cumulative day.
    /// The page budget bounds work for a corrupt/unreasonably large store; failure cannot advance the sync anchor.
    private func readSamples<Sample: HKSample>(
        store: HKHealthStore, predicate: HKSamplePredicate<Sample>
    ) async throws -> [Sample] {
        var anchor: HKQueryAnchor?
        var samples: [UUID: Sample] = [:]
        let pageSize = 2_000
        for _ in 0..<500 {
            try Task.checkCancellation()
            let page = try await HKAnchoredObjectQueryDescriptor(
                predicates: [predicate], anchor: anchor, limit: pageSize
            ).result(for: store)
            for sample in page.addedSamples { samples[sample.uuid] = sample }
            for deleted in page.deletedObjects { samples.removeValue(forKey: deleted.uuid) }
            anchor = page.newAnchor
            if page.addedSamples.count + page.deletedObjects.count < pageSize {
                return samples.values.sorted { $0.startDate < $1.startDate }
            }
        }
        throw JarvisHealthSyncError.unavailable
    }

    /// HealthKit resolves overlapping iPhone/Watch sources. Never add per-source sample sums ourselves.
    private func dailySteps(store: HKHealthStore, from start: Date, to end: Date) async throws -> [JarvisHealthSample] {
        let type = HKQuantityType(.stepCount)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end, options: []),
                options: .cumulativeSum,
                anchorDate: start,
                intervalComponents: DateComponents(calendar: JarvisHealthSyncWindow.calendar,
                                                  timeZone: JarvisHealthSyncWindow.calendar.timeZone, day: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                if let error { continuation.resume(throwing: error); return }
                guard let collection else {
                    continuation.resume(throwing: JarvisTodayDataError.failed)
                    return
                }
                var days: [JarvisHealthSample] = []
                collection.enumerateStatistics(from: start, to: end) { statistic, _ in
                    // Missing or denied readings are not zero-step days.
                    guard let quantity = statistic.sumQuantity() else { return }
                    days.append(JarvisHealthSample(
                        id: "steps-\(Int(statistic.startDate.timeIntervalSince1970))",
                        metric: "step_count", unit: "count", start: statistic.startDate,
                        end: min(statistic.endDate, end), value: quantity.doubleValue(for: .count()),
                        source: "Apple Health merged statistics", aggregation: .dailyTotal
                    ))
                }
                continuation.resume(returning: days)
            }
            store.execute(query)
        }
    }

    static func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .traditionalStrengthTraining: "traditional_strength_training"
        case .functionalStrengthTraining: "functional_strength_training"
        case .coreTraining: "core_training"
        case .crossTraining: "cross_training"
        case .highIntensityIntervalTraining: "high_intensity_interval_training"
        case .running: "running"
        case .walking: "walking"
        case .cycling: "cycling"
        case .swimming: "swimming"
        case .hiking: "hiking"
        case .yoga: "yoga"
        default: "healthkit_\(type.rawValue)"
        }
    }

    func lastNightStages(now: Date) async throws -> [JarvisHealthSleepSegment] {
        let calendar = JarvisHealthSyncWindow.calendar
        let midnight = calendar.startOfDay(for: now)
        let start = calendar.date(byAdding: .hour, value: -12, to: midnight)!
        let end = min(now, calendar.date(byAdding: .hour, value: 12, to: midnight)!)
        let store = HKHealthStore()
        try await JarvisHealthKitAccess.requestReadAccess(store)
        guard let type = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else { return [] }
        let window = HKQuery.predicateForSamples(withStart: start, end: end)
        let samples = try await readSamples(store: store, predicate: .categorySample(type: type, predicate: window))
        let segments = samples.compactMap { sample -> JarvisHealthSleepSegment? in
            let stage = Self.stage(sample.value)
            guard ["core", "deep", "rem", "awake", "asleep"].contains(stage) else { return nil }
            return JarvisHealthSleepSegment(id: sample.uuid.uuidString, stage: stage,
                start: max(start, sample.startDate), end: min(end, sample.endDate),
                source: sample.sourceRevision.source.bundleIdentifier)
        }
        return JarvisSleepTimeline.overnight(segments, wakingOn: now, calendar: calendar).segments
    }

    private static func stage(_ value: Int) -> String {
        switch HKCategoryValueSleepAnalysis(rawValue: value) {
        case .asleepCore: "core"
        case .asleepDeep: "deep"
        case .asleepREM: "rem"
        case .awake: "awake"
        case .inBed: "in_bed"
        default: "asleep"
        }
    }
}

/// Runs a sync and publishes the honest state. The anchor and last-sync time persist between launches.
@MainActor
final class JarvisHealthSyncModel: ObservableObject {
    @Published private(set) var state: JarvisHealthSyncState = .neverSynced
    @Published private(set) var isSyncing = false
    @Published private(set) var lastSync: Date?
    private let store: JarvisHealthSyncAnchorStore
    private var inFlight: Task<JarvisHealthSyncState, Never>?
    private var scaleSync: Task<Bool, Error>?
    private var uploadedScaleIDs: Set<String> = []

    init(store: JarvisHealthSyncAnchorStore = JarvisHealthUserDefaultsAnchorStore()) {
        self.store = store
        lastSync = store.lastSync
        if let lastSync { state = .complete(at: lastSync) }
    }

    deinit {
        inFlight?.cancel()
        scaleSync?.cancel()
    }

    /// A foreground scale check never moves the full Health sync anchor.
    func syncTodaysScale(client: JarvisHealthClient) async throws -> Bool {
        if let inFlight { _ = await inFlight.value }
        if let scaleSync { return try await scaleSync.value }
        let operation = Task {
            let samples = try await JarvisHealthKitReader().todaysScaleSamples()
            let ids = Set(samples.map(\.id))
            guard !ids.isEmpty, ids != uploadedScaleIDs else { return false }
            try Task.checkCancellation()
            try await client.send(JarvisHealthSyncRequest(anchor: nil, samples: samples))
            uploadedScaleIDs = ids
            return true
        }
        scaleSync = operation
        defer { scaleSync = nil }
        return try await operation.value
    }

    /// Home and Health share this operation. Another pull awaits the active read/upload.
    func sync(client: JarvisHealthClient) async -> JarvisHealthSyncState {
        if let scaleSync { _ = try? await scaleSync.value }
        if let inFlight { return await inFlight.value }
        isSyncing = true
        let operation = Task { [store] in
            do {
                let batch = try await JarvisHealthKitReader().read(anchor: store.anchor)
                try Task.checkCancellation()
                return await JarvisHealthSyncRunner(sender: client, store: store).sync(batch)
            } catch {
                return JarvisHealthSyncState.failed
            }
        }
        inFlight = operation
        let result = await operation.value
        inFlight = nil
        state = result
        lastSync = store.lastSync
        isSyncing = false
        return result
    }
}

/// Pull-to-refresh owns progress. Only a failed or partial refresh needs persistent page feedback.
struct JarvisHealthSyncIssue: View {
    let state: JarvisHealthSyncState?
    let language: JarvisAppLanguage

    @ViewBuilder
    var body: some View {
        if let key = issueKey {
            Label(JarvisHealthLocalization.string(key, language: language), systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("health.sync.issue")
        }
    }

    private var issueKey: JarvisHealthLocalizationKey? {
        guard let state else { return nil }
        switch state {
        case .failed: return .syncPullFailed
        case .partial: return .syncPullPartial
        default: return nil
        }
    }
}

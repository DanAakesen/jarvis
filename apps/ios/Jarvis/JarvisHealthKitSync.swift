import HealthKit
import JarvisCore
import SwiftUI

/// Reads permitted HealthKit data since the sync anchor (a week on the first sync) into one batch. Read-only.
/// iOS never says which read types the user denied, so a type that fails to read is reported as unread,
/// and the batch is only ever called complete when every query succeeded.
struct JarvisHealthKitReader {
    private static let quantities: [(HKQuantityTypeIdentifier, String, HKUnit, String)] = [
        (.distanceWalkingRunning, "walking_running_distance", .meterUnit(with: .kilo), "km"),
        (.distanceCycling, "cycling_distance", .meterUnit(with: .kilo), "km"),
        (.flightsClimbed, "flights_climbed", .count(), "count"),
        (.activeEnergyBurned, "active_energy", .kilocalorie(), "kcal"),
        (.basalEnergyBurned, "basal_energy_burned", .kilocalorie(), "kcal"),
        (.appleExerciseTime, "apple_exercise_time", .minute(), "min"),
        (.heartRate, "heart_rate", HKUnit.count().unitDivided(by: .minute()), "count/min"),
        (.restingHeartRate, "resting_heart_rate", HKUnit.count().unitDivided(by: .minute()), "count/min"),
        (.heartRateVariabilitySDNN, "heart_rate_variability", .secondUnit(with: .milli), "ms"),
        (.oxygenSaturation, "blood_oxygen_saturation", .percent(), "%"),
        (.respiratoryRate, "respiratory_rate", HKUnit.count().unitDivided(by: .minute()), "count/min"),
        (.vo2Max, "vo2_max", HKUnit(from: "ml/kg*min"), "ml/(kg·min)"),
        (.bodyMass, "body_mass", .gramUnit(with: .kilo), "kg"),
        (.bodyMassIndex, "body_mass_index", .count(), "count"),
        (.height, "height", .meterUnit(with: .centi), "cm"),
        (.waistCircumference, "waist_circumference", .meterUnit(with: .centi), "cm"),
        (.bodyFatPercentage, "body_fat_percentage", .percent(), "fraction"),
        (.leanBodyMass, "lean_body_mass", .gramUnit(with: .kilo), "kg"),
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

        for (identifier, name, unit, label) in Self.quantities {
            guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else { continue }
            do {
                let isBody = ["body_mass", "body_fat_percentage", "lean_body_mass"].contains(name)
                let quantityWindow = isBody
                    ? HKQuery.predicateForSamples(withStart: recentStart, end: now, options: []) : window
                let results = try await readSamples(
                    store: store, predicate: .quantitySample(type: type, predicate: quantityWindow)
                )
                samples += results.map {
                    JarvisHealthSample(
                        id: $0.uuid.uuidString, metric: name, unit: label, start: $0.startDate, end: $0.endDate,
                        value: $0.quantity.doubleValue(for: unit), source: $0.sourceRevision.source.name
                    )
                }
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
                        source: "Apple Health merged statistics"
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
    private let client: JarvisHealthClient
    private let store: JarvisHealthSyncAnchorStore

    init(client: JarvisHealthClient, store: JarvisHealthSyncAnchorStore = JarvisHealthUserDefaultsAnchorStore()) {
        self.client = client
        self.store = store
        lastSync = store.lastSync
        if let lastSync { state = .complete(at: lastSync) }
    }

    func sync() async {
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            let batch = try await JarvisHealthKitReader().read(anchor: store.anchor)
            state = await JarvisHealthSyncRunner(sender: client, store: store).sync(batch)
        } catch {
            state = .failed
        }
        lastSync = store.lastSync
    }
}

/// Sync control for the Health page. HIG: Loading (one shared loader while it runs), Feedback (visible success and
/// error, with a retry), Buttons (shared glass button), Accessibility (status is a labelled element).
struct JarvisHealthSyncSection: View {
    @StateObject private var model: JarvisHealthSyncModel
    let language: JarvisAppLanguage

    init(client: JarvisHealthClient, language: JarvisAppLanguage) {
        _model = StateObject(wrappedValue: JarvisHealthSyncModel(client: client))
        self.language = language
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
            if model.isSyncing {
                JarvisLoadingView(title: text(.syncing))
                    .accessibilityIdentifier("health.sync.loading")
            } else {
                JarvisLabelledButton(
                    title: text(.sync),
                    systemImage: "arrow.triangle.2.circlepath",
                    identifier: "health.sync"
                ) { Task { await model.sync() } }
                status
            }
            if let lastSync = model.lastSync {
                Text("\(text(.lastSync)) · \(time(lastSync))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("health.sync.lastTime")
            }
        }
        .animation(.default, value: model.isSyncing)
    }

    @ViewBuilder
    private var status: some View {
        switch model.state {
        case .neverSynced:
            Text(text(.syncNever)).font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("health.sync.status")
        case let .complete(at):
            Label(String(format: text(.syncComplete), time(at)), systemImage: "checkmark.circle.fill")
                .font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("health.sync.status")
        case let .partial(at, missing):
            Label(String(format: text(.syncPartial), time(at), missing.joined(separator: ", ")), systemImage: "exclamationmark.circle")
                .font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("health.sync.status")
        case .failed:
            Label(text(.syncFailed), systemImage: "exclamationmark.triangle.fill")
                .font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("health.sync.status")
            JarvisLabelledButton(
                title: text(.syncRetry),
                systemImage: "arrow.clockwise",
                identifier: "health.sync.retry"
            ) { Task { await model.sync() } }
        }
    }

    private func text(_ key: JarvisHealthLocalizationKey) -> String {
        JarvisHealthLocalization.string(key, language: language)
    }

    private func time(_ date: Date) -> String {
        date.formatted(.dateTime.locale(language.locale).day().month().hour().minute())
    }
}

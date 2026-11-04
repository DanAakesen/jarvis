import HealthKit
import JarvisCore
import SwiftUI

/// Reads the last week of permitted HealthKit data into one batch. Read-only.
/// iOS never says which read types the user denied, so a type that fails to read is reported as unread,
/// and the batch is only ever called complete when every query succeeded.
struct JarvisHealthKitReader {
    private static let quantities: [(HKQuantityTypeIdentifier, String, HKUnit, String)] = [
        (.stepCount, "step_count", .count(), "count"),
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
        (.bodyFatPercentage, "body_fat_percentage", .percent(), "%"),
        (.leanBodyMass, "lean_body_mass", .gramUnit(with: .kilo), "kg"),
        (.dietaryEnergyConsumed, "dietary_energy", .kilocalorie(), "kcal"),
        (.dietaryProtein, "protein", .gram(), "g"),
        (.dietaryCarbohydrates, "carbohydrates", .gram(), "g"),
        (.dietaryFatTotal, "total_fat", .gram(), "g"),
        (.dietaryWater, "dietary_water", .literUnit(with: .milli), "mL"),
    ]

    func read(days: Int = 7, now: Date = Date()) async throws -> JarvisHealthSyncBatch {
        let store = HKHealthStore()
        try await JarvisHealthKitAccess.requestReadAccess(store)
        let start = Calendar.current.date(byAdding: .day, value: -days, to: now) ?? now
        let window = HKQuery.predicateForSamples(withStart: start, end: now, options: [])
        var samples: [JarvisHealthSample] = []
        var read: [String] = []
        var unread: [String] = []

        for (identifier, name, unit, label) in Self.quantities {
            guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else { continue }
            do {
                let descriptor = HKSampleQueryDescriptor(
                    predicates: [.quantitySample(type: type, predicate: window)],
                    sortDescriptors: [SortDescriptor(\.startDate)], limit: 20_000
                )
                let results = try await descriptor.result(for: store)
                samples += results.map {
                    JarvisHealthSample(
                        metric: name, unit: label, start: $0.startDate, end: $0.endDate,
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
                let descriptor = HKSampleQueryDescriptor(
                    predicates: [.categorySample(type: type, predicate: window)],
                    sortDescriptors: [SortDescriptor(\.startDate)], limit: 20_000
                )
                sleep = try await descriptor.result(for: store).map {
                    JarvisHealthSleepSegment(
                        stage: Self.stage($0.value), start: $0.startDate, end: $0.endDate,
                        source: $0.sourceRevision.source.name
                    )
                }
                read.append("sleep_analysis")
            } catch { unread.append("sleep_analysis") }
        }

        var workouts: [JarvisHealthWorkoutSample] = []
        do {
            let descriptor = HKSampleQueryDescriptor(
                predicates: [.workout(window)], sortDescriptors: [SortDescriptor(\.startDate)], limit: 2_000
            )
            workouts = try await descriptor.result(for: store).map {
                JarvisHealthWorkoutSample(
                    id: $0.uuid.uuidString, activity: String(describing: $0.workoutActivityType),
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
            deniedOrUnreadTypes: unread, windowStart: start, windowEnd: now
        )
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

/// Runs a sync and publishes the honest state. Used by the Sync button and by background delivery.
@MainActor
final class JarvisHealthSyncModel: ObservableObject {
    @Published private(set) var state: JarvisHealthSyncState = .neverSynced
    @Published private(set) var isSyncing = false
    private let client: JarvisHealthClient
    private let tokens = try? KeychainTokenStore(account: "health-upload")

    init(client: JarvisHealthClient) { self.client = client }

    func sync() async {
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            let batch = try await JarvisHealthKitReader().read()
            let client = client
            let tokens = tokens
            let sender = client.syncSender {
                if let saved = try await tokens?.read() { return saved }
                let issued = try await client.uploadCredential()
                try await tokens?.write(issued)
                return issued
            }
            state = await JarvisHealthSyncRunner(sender: sender).sync(batch)
        } catch {
            state = .failed
        }
    }
}

struct JarvisHealthSyncSection: View {
    @StateObject private var model: JarvisHealthSyncModel
    let language: JarvisAppLanguage

    init(client: JarvisHealthClient, language: JarvisAppLanguage) {
        _model = StateObject(wrappedValue: JarvisHealthSyncModel(client: client))
        self.language = language
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesInlineSpacing) {
            JarvisLabelledButton(
                title: text(model.isSyncing ? .syncing : .sync),
                systemImage: "arrow.triangle.2.circlepath",
                identifier: "health.sync",
                isBusy: model.isSyncing,
                isDisabled: model.isSyncing
            ) { Task { await model.sync() } }
            Text(status)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("health.sync.status")
        }
    }

    private func text(_ key: JarvisHealthLocalizationKey) -> String {
        JarvisHealthLocalization.string(key, language: language)
    }

    private var status: String {
        switch model.state {
        case .neverSynced: text(.syncNever)
        case .failed: text(.syncFailed)
        case let .complete(at): String(format: text(.syncComplete), time(at))
        case let .partial(at, missing):
            String(format: text(.syncPartial), time(at), missing.joined(separator: ", "))
        }
    }

    private func time(_ date: Date) -> String {
        date.formatted(.dateTime.locale(language.locale).hour().minute())
    }
}

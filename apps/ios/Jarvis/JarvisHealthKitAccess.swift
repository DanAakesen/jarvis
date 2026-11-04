import HealthKit
import JarvisCore

/// Every HealthKit type Jarvis can read. Read-only: nothing is written to Health.
enum JarvisHealthKitAccess {
    private static let quantityIdentifiers: [HKQuantityTypeIdentifier] = [
        .stepCount, .distanceWalkingRunning, .distanceCycling, .distanceSwimming, .flightsClimbed,
        .activeEnergyBurned, .basalEnergyBurned, .appleExerciseTime, .appleStandTime, .timeInDaylight,
        .heartRate, .restingHeartRate, .walkingHeartRateAverage, .heartRateVariabilitySDNN,
        .oxygenSaturation, .respiratoryRate, .vo2Max, .bloodPressureSystolic, .bloodPressureDiastolic,
        .bloodGlucose, .bodyTemperature, .appleSleepingWristTemperature,
        .bodyMass, .bodyMassIndex, .bodyFatPercentage, .leanBodyMass, .height,
        .walkingSpeed, .walkingStepLength, .runningSpeed,
        .dietaryEnergyConsumed, .dietaryProtein, .dietaryCarbohydrates, .dietaryFatTotal,
        .dietarySugar, .dietaryFiber, .dietaryWater, .dietaryCaffeine,
        .environmentalAudioExposure, .headphoneAudioExposure,
    ]

    private static let categoryIdentifiers: [HKCategoryTypeIdentifier] = [
        .sleepAnalysis, .appleStandHour, .mindfulSession,
    ]

    static var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        for identifier in quantityIdentifiers {
            if let type = HKObjectType.quantityType(forIdentifier: identifier) { types.insert(type) }
        }
        for identifier in categoryIdentifiers {
            if let type = HKObjectType.categoryType(forIdentifier: identifier) { types.insert(type) }
        }
        types.insert(HKObjectType.workoutType())
        types.insert(HKObjectType.activitySummaryType())
        return types
    }

    /// Asks for read access to everything above. Types already decided are not asked again.
    static func requestReadAccess(_ store: HKHealthStore) async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw JarvisTodayDataError.unavailable }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
        } catch {
            throw JarvisTodayDataError.notAuthorized
        }
    }
}

/// Every workout recorded in Health (strength, runs, rides, walks and the rest), shown with the vault gym logs on Home.
/// Strength workouts carry no muscle group in Health, so they show as strength training; the combined store drops one
/// only when a real vault log exists within two hours.
struct JarvisHealthKitWorkoutSource: JarvisGymLogStore {
    func save(_ entry: JarvisGymLogEntry) async throws { throw JarvisGymLogError.unavailable }

    func entries(since: Date) async throws -> [JarvisGymLogEntry] {
        let store = HKHealthStore()
        try await JarvisHealthKitAccess.requestReadAccess(store)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate))],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)],
            limit: 500
        )
        let workouts = try await descriptor.result(for: store)
        return workouts.map { workout in
            let energy = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()
            return JarvisGymLogEntry(
                performedAt: workout.startDate,
                session: Self.session(workout.workoutActivityType),
                durationMinutes: workout.duration / 60,
                activeKilocalories: energy?.doubleValue(for: .kilocalorie()) ?? 0
            )
        }
    }

    static func session(_ type: HKWorkoutActivityType) -> JarvisGymSessionType {
        switch type {
        case .traditionalStrengthTraining, .functionalStrengthTraining, .coreTraining, .flexibility:
            .strength
        case .running, .walking, .hiking, .cycling, .swimming, .rowing, .elliptical, .stairClimbing,
             .highIntensityIntervalTraining, .mixedCardio, .jumpRope, .crossTraining, .cardioDance,
             .handCycling, .wheelchairWalkPace, .wheelchairRunPace, .stairs, .stepTraining:
            .cardio
        default:
            .other
        }
    }
}

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
        .bodyMass, .bodyMassIndex, .bodyFatPercentage, .leanBodyMass, .height, .waistCircumference,
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

/// Runs, rides, swims and other cardio workouts recorded in Health, shown with the vault gym logs on Home.
/// Strength workouts carry no muscle group in Health, so those still come from the vault log.
struct JarvisHealthKitWorkoutSource: JarvisGymLogStore {
    func save(_ entry: JarvisGymLogEntry) async throws { throw JarvisGymLogError.unavailable }

    func entries(since: Date) async throws -> [JarvisGymLogEntry] {
        let store = HKHealthStore()
        try await JarvisHealthKitAccess.requestReadAccess(store)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate))],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)],
            limit: 200
        )
        let workouts = try await descriptor.result(for: store)
        return workouts.compactMap { workout in
            Self.isCardio(workout.workoutActivityType)
                ? JarvisGymLogEntry(performedAt: workout.startDate, session: .cardio)
                : nil
        }
    }

    private static func isCardio(_ type: HKWorkoutActivityType) -> Bool {
        switch type {
        case .running, .walking, .hiking, .cycling, .swimming, .rowing, .elliptical, .stairClimbing,
             .highIntensityIntervalTraining, .mixedCardio, .jumpRope, .crossTraining, .cardioDance:
            true
        default:
            false
        }
    }
}

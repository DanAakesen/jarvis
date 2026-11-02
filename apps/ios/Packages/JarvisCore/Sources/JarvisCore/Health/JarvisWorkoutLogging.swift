import Foundation

/// Where a workout is saved. `JarvisHealthClient` conforms and calls the workout log endpoint.
public protocol JarvisWorkoutLogging: Sendable {
    func logWorkout(_ draft: JarvisWorkoutDraft) async throws
}

extension JarvisHealthClient: JarvisWorkoutLogging {
    public func logWorkout(_ draft: JarvisWorkoutDraft) async throws {
        _ = try await createWorkout(draft)
    }
}

extension JarvisWorkoutSessionType: Identifiable {
    public var id: String { rawValue }

    public var localizationKey: JarvisHealthLocalizationKey {
        switch self {
        case .chestTricepsCore: .workoutChestTricepsCore
        case .backBicepsCore: .workoutBackBicepsCore
        case .armsShoulders: .workoutArmsShoulders
        case .legsCore: .workoutLegsCore
        case .cardio: .workoutCardio
        case .other: .workoutOther
        }
    }
}

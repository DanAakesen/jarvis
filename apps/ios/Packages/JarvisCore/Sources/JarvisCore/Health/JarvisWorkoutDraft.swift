import Foundation

/// The workout types from the training plan (issue 1529).
public enum JarvisWorkoutType: String, CaseIterable, Identifiable, Sendable {
    case chestTricepsCore = "chest_triceps_core"
    case backBicepsCore = "back_biceps_core"
    case armsShoulders = "arms_shoulders"
    case legsCore = "legs_core"
    case cardio
    case other

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

public struct JarvisWorkoutDraft: Equatable, Sendable {
    public let idempotencyKey: UUID
    public let type: JarvisWorkoutType
    public let durationMinutes: Int?

    public init(idempotencyKey: UUID, type: JarvisWorkoutType, durationMinutes: Int?) {
        self.idempotencyKey = idempotencyKey
        self.type = type
        self.durationMinutes = durationMinutes
    }

    public var isValid: Bool {
        durationMinutes.map { (1...1440).contains($0) } ?? true
    }
}

/// Where a workout is saved. The workout endpoint from issue 1529 is not on main yet, so the app passes no
/// logger and the sheet says so; wiring the endpoint means conforming a client to this protocol and passing it in.
public protocol JarvisWorkoutLogging: Sendable {
    func logWorkout(_ draft: JarvisWorkoutDraft) async throws
}

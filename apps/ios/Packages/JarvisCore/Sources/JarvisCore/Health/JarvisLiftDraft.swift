import Foundation

public struct JarvisLiftDraft: Encodable, Equatable, Sendable {
    public let idempotencyKey: UUID
    public let exerciseName: String
    public let weightKg: Double
    public let reps: Int
    public let sets: Int

    public init(
        idempotencyKey: UUID,
        exerciseName: String,
        weightKg: Double,
        reps: Int,
        sets: Int
    ) {
        self.idempotencyKey = idempotencyKey
        self.exerciseName = exerciseName.trimmingCharacters(in: .whitespacesAndNewlines)
        self.weightKg = weightKg
        self.reps = reps
        self.sets = sets
    }

    public var isValid: Bool {
        !exerciseName.isEmpty && exerciseName.utf16.count <= 80 &&
            !exerciseName.unicodeScalars.contains { $0.value <= 0x1f || $0.value == 0x7f } &&
            weightKg.isFinite && (0...1000).contains(weightKg) &&
            abs(weightKg * 100 - (weightKg * 100).rounded()) < 1e-7 &&
            (1...1000).contains(reps) && (1...100).contains(sets)
    }
}

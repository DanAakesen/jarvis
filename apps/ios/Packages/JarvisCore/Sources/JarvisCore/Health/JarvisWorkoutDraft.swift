import Foundation

/// Whether the vault Gym log copy of a saved entry is finished. The saved entry is kept either way.
public enum JarvisVaultState: String, Codable, Equatable, Sendable {
    case synced
    case pending
}

public enum JarvisWorkoutSessionType: String, Codable, CaseIterable, Equatable, Sendable {
    case chestTricepsCore = "chest_triceps_core"
    case backBicepsCore = "back_biceps_core"
    case armsShoulders = "arms_shoulders"
    case legsCore = "legs_core"
    case cardio
    case other
}

public struct JarvisWorkoutDraft: Encodable, Equatable, Sendable {
    public let idempotencyKey: UUID
    public let sessionType: JarvisWorkoutSessionType
    public let title: String?
    public let startedAt: Date
    public let durationMinutes: Int?
    public let note: String?

    public init(
        idempotencyKey: UUID,
        sessionType: JarvisWorkoutSessionType,
        title: String? = nil,
        startedAt: Date,
        durationMinutes: Int? = nil,
        note: String? = nil
    ) {
        self.idempotencyKey = idempotencyKey
        self.sessionType = sessionType
        self.title = Self.trimmed(title)
        self.startedAt = startedAt
        self.durationMinutes = durationMinutes
        self.note = Self.trimmed(note)
    }

    private static func trimmed(_ value: String?) -> String? {
        guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    private static func isSingleLine(_ text: String) -> Bool {
        !text.unicodeScalars.contains { $0.value <= 0x1f || $0.value == 0x7f }
    }

    public var isValid: Bool {
        (title == nil || sessionType == .other && title!.utf16.count <= 80 && Self.isSingleLine(title!)) &&
            (note == nil || note!.utf16.count <= 500 && Self.isSingleLine(note!)) &&
            (durationMinutes.map { (1...1440).contains($0) } ?? true)
    }

    private enum CodingKeys: String, CodingKey {
        case idempotencyKey, sessionType, title, startedAt, durationMinutes, note
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(idempotencyKey, forKey: .idempotencyKey)
        try container.encode(sessionType, forKey: .sessionType)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encode(JarvisWorkoutDraft.timestamp(startedAt), forKey: .startedAt)
        try container.encodeIfPresent(durationMinutes, forKey: .durationMinutes)
        try container.encodeIfPresent(note, forKey: .note)
    }

    static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

public struct JarvisWorkoutEntry: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let sessionType: JarvisWorkoutSessionType
    public let title: String?
    public let startedAt: String
    public let durationMinutes: Int?
    public let note: String?
    public let vault: JarvisVaultState

    var isValid: Bool {
        UUID(uuidString: id) != nil && !startedAt.isEmpty &&
            (durationMinutes.map { (1...1440).contains($0) } ?? true)
    }

    public var startedAtDate: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: startedAt)
    }
}

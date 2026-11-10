import Foundation

public struct JarvisLiftCaptureRequest: Codable, Equatable, Sendable {
    public static let maximumTextUTF16Count = 2_000
    public static let maximumTextBytes = 8_000
    public let idempotencyKey: UUID
    public let text: String

    public init(idempotencyKey: UUID, text: String) {
        self.idempotencyKey = idempotencyKey
        self.text = text
    }

    public var isValid: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        text.utf16.count <= Self.maximumTextUTF16Count && text.utf8.count <= Self.maximumTextBytes &&
        !Self.containsUnsupportedCharacters(in: text)
    }

    public static func containsUnsupportedCharacters(in text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            switch scalar.properties.generalCategory {
            case .control, .format: ![9, 10, 13].contains(scalar.value)
            default: false
            }
        }
    }
}

/// Only values returned by the saved record are used for the capture receipt.
public struct JarvisCapturedLift: Codable, Equatable, Sendable {
    public let id: String
    public let exerciseName: String
    public let weightKg: Double
    public let reps: Int
    public let sets: Int
    public let performedAt: String
    public let deletedAt: String?

    public var isValid: Bool {
        UUID(uuidString: id) != nil && !performedAt.isEmpty && deletedAt == nil &&
        JarvisLiftEdit(exerciseName: exerciseName, weightKg: weightKg, reps: reps, sets: sets).isValid
    }
}

public enum JarvisLiftCaptureResult: Codable, Equatable, Sendable {
    case saved(entry: JarvisCapturedLift, replayed: Bool)
    case needsDetails(question: String)
    case deleted

    private enum CodingKeys: String, CodingKey { case status, entry, replayed, question }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .status) {
        case "saved":
            let entry = try container.decode(JarvisCapturedLift.self, forKey: .entry)
            guard entry.isValid else { throw JarvisHealthClientError.invalidResponse }
            self = .saved(entry: entry, replayed: try container.decode(Bool.self, forKey: .replayed))
        case "needsDetails":
            let question = try container.decode(String.self, forKey: .question)
            guard !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  question.utf8.count <= 8_000 else { throw JarvisHealthClientError.invalidResponse }
            self = .needsDetails(question: question)
        case "deleted": self = .deleted
        default: throw JarvisHealthClientError.invalidResponse
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .saved(let entry, let replayed):
            try container.encode("saved", forKey: .status)
            try container.encode(entry, forKey: .entry)
            try container.encode(replayed, forKey: .replayed)
        case .needsDetails(let question):
            try container.encode("needsDetails", forKey: .status)
            try container.encode(question, forKey: .question)
        case .deleted:
            try container.encode("deleted", forKey: .status)
        }
    }
}

extension WatchRequest {
    public var liftCapture: JarvisLiftCaptureRequest? {
        guard action == .captureLift, itemID == nil, text == nil, flag == nil,
              let data, let value = try? JSONDecoder().decode(JarvisLiftCaptureRequest.self, from: data),
              value.isValid else { return nil }
        return value
    }
}

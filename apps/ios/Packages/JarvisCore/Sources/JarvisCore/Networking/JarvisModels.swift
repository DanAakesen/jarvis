import Foundation

public enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.typeMismatch(
                JSONValue.self,
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Unsupported JSON value")
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

public struct JarvisToolDescriptor: Codable, Equatable, Sendable {
    public let name: String
    public let description: String
    public let inputSchema: JSONValue
    public let execution: JSONValue?
}

public enum ToolOutcome: String, Codable, Sendable {
    case ok
    case refused
    case error
}

public struct ToolCallResponse<Result: Codable & Sendable>: Codable, Sendable {
    public let tool: String
    public let outcome: ToolOutcome
    public let result: Result
    public let confirmation: String
}

public struct OwnerSession: Codable, Equatable, Sendable {
    public let sessionId: String
    public let token: String
    public let idleExpiresAt: String
    public let absoluteExpiresAt: String
}

public struct RevokedSessions: Codable, Equatable, Sendable {
    public let revoked: Int
}

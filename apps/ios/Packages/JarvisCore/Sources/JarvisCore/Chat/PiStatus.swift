import Foundation

/// TEST-ONLY. Live state of the PI chat engine from `GET /pi/status`.
public struct PiStatus: Decodable, Equatable, Sendable {
    public struct Agent: Decodable, Equatable, Sendable {
        public let name: String?
        public let model: String
        public let effort: String
    }

    public struct Month: Decodable, Equatable, Sendable {
        public let spentDkk: Double
        public let capDkk: Double
        public let turns: Int
    }

    public struct Warm: Decodable, Equatable, Sendable {
        public let state: String
        public let warmedAt: String?

        public var isWarm: Bool { state == "warm" }
    }

    public struct LastTurn: Decodable, Equatable, Sendable {
        public let at: String
        public let firstTextMs: Int?
        public let totalMs: Int
        public let inputTokens: Int
        public let cachedTokens: Int
        public let outputTokens: Int
        public let costDkk: Double
    }

    public let enabled: Bool
    /// `not_configured` or `budget_exhausted` when `enabled` is false.
    public let reason: String?
    public let agent: Agent
    public let month: Month
    public let warm: Warm
    public let lastTurn: LastTurn?
}

/// TEST-ONLY. Result of `POST /pi/warm`.
public struct PiWarmResult: Decodable, Equatable, Sendable {
    public let state: String
    public let alreadyWarm: Bool
    public let ms: Int
}

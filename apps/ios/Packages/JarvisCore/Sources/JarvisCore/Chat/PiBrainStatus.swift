import Foundation

/// TEST-ONLY. State of the PI brain from `GET /pi/brain`: the owner's switch and what the brain has used.
/// Delete with the chat engine switch at cutover.
public struct PiBrainStatus: Decodable, Equatable, Sendable {
    public struct Budget: Decodable, Equatable, Sendable {
        public let limitDkk: Double
        public let spentDkk: Double
        /// `ok`, `warn` or `exhausted`.
        public let state: String
    }

    public struct Month: Decodable, Equatable, Sendable {
        public let wakes: Int
        public let costDkk: Double
    }

    public struct Today: Decodable, Equatable, Sendable {
        public let messages: Int
    }

    public struct LastWake: Decodable, Equatable, Sendable {
        public let at: String
        public let totalMs: Int
        public let inputTokens: Int
        public let cachedTokens: Int
        public let outputTokens: Int
        public let costDkk: Double
        public let outcome: String
    }

    /// False when the backend has no PI brain wired (PI not configured, or no vault for its decision log).
    public let available: Bool
    public let enabled: Bool
    public let paused: Bool
    public let budget: Budget
    public let month: Month
    public let today: Today
    public let lastWake: LastWake?
    /// Decision-log entries that are not in the vault yet.
    public let logPending: Int
}

struct PiBrainSwitchBody: Encodable {
    let enabled: Bool
}

import Foundation

/// State of Background PI from `GET /pi/brain`: the owner's switch, combined slots, spend and situation freshness.
public struct PiBrainStatus: Codable, Equatable, Sendable {
    public struct Budget: Codable, Equatable, Sendable {
        public let limitDkk: Double
        public let spentDkk: Double
        /// `ok`, `warn` or `exhausted`.
        public let state: String
    }

    public struct Month: Codable, Equatable, Sendable {
        public let wakes: Int
        public let costDkk: Double
    }

    public struct Today: Codable, Equatable, Sendable {
        public let messages: Int
        public let usedTurns: Int
        public let allowedTurns: Int
    }

    public struct LastWake: Codable, Equatable, Sendable {
        public let at: String
        public let totalMs: Int
        public let inputTokens: Int
        public let cachedTokens: Int
        public let outputTokens: Int
        public let costDkk: Double
        public let outcome: String
    }

    public struct Queue: Codable, Equatable, Sendable {
        public let pending: Int
        public let leased: Int
        public let retrying: Int
    }

    public struct Slots: Codable, Equatable, Sendable {
        public let used: Int
        public let allowed: Int
        public let remaining: Int
        public let lastAt: String?
        public let nextAllowedAt: String?
        public let quiet: Bool
        public let queue: Queue
    }

    public struct Situation: Codable, Equatable, Sendable {
        public let revision: Int
        public let asOf: String?
        public let updatedAt: String?
        public let staleSources: [String]
        public let missingSources: [String]
        public let disabledSources: [String]
    }

    public struct Cost: Codable, Equatable, Sendable {
        public let coldSweepMinDkk: Double
        public let coldSweepMaxDkk: Double
        public let representativeToolTurnDkk: Double
        public let preflightWorstCaseDkk: Double
        public let estimatedDayMinDkk: Double
        public let estimatedDayMaxDkk: Double
        public let estimatedThirtyDayMinDkk: Double
        public let estimatedThirtyDayMaxDkk: Double
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
    public let slots: Slots
    public let situation: Situation
    public let cost: Cost

    /// Other scheduling checks still apply (budget, sources, quiet hours).
    public var allowsProactiveWakes: Bool { available && enabled && !paused }
}

struct PiBrainSwitchBody: Encodable {
    let enabled: Bool
}

import Foundation

public enum ChatRuntimeTest: String, Codable, CaseIterable, Sendable {
    case current
    case copilot
}

public struct ChatRuntimeAvailability: Codable, Equatable, Sendable {
    public struct Option: Codable, Equatable, Sendable {
        public let available: Bool
        public let reason: String?
    }

    public let current: Option
    public let copilot: Option

    public subscript(runtime: ChatRuntimeTest) -> Option {
        runtime == .current ? current : copilot
    }
}

/// Reading history cannot release an uncertain managed claim or replay an accepted message.
public struct ChatRuntimeRecovery: Equatable, Sendable {
    public private(set) var requiresHistoryReview = false
    public private(set) var sessionBlocked = false

    public init() {}

    public mutating func failed(code: String?) {
        requiresHistoryReview = true
        if let code, [
            "managed_session_busy", "managed_source_already_claimed", "managed_turn_already_claimed",
            "managed_target_mismatch", "managed_unavailable", "managed_policy_turn_failed",
        ].contains(code) {
            sessionBlocked = true
        }
    }

    public mutating func historyReviewed() {
        requiresHistoryReview = false
    }
}

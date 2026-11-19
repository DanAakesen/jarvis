import Foundation

/// Result of `POST /pi/warm`. A warm-up is optional preparation, never a fallback engine.
public struct PiWarmResult: Decodable, Equatable, Sendable {
    public let state: String
    public let alreadyWarm: Bool
    public let ms: Int
    /// Set when the backend declined to spend.
    public let skipped: String?
}

/// Client-side limit for the paid PI warm-up: at most one attempt per interval per app run.
public struct PiWarmThrottle: Sendable {
    public let interval: TimeInterval
    private var lastAttempt: Date?

    public init(interval: TimeInterval = 300) {
        self.interval = interval
    }

    public mutating func shouldWarm(now: Date = Date()) -> Bool {
        if let lastAttempt, now.timeIntervalSince(lastAttempt) < interval { return false }
        lastAttempt = now
        return true
    }
}
